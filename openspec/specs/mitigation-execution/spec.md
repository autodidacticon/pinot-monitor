# mitigation-execution Specification

## Purpose

Mitigation execution turns detected incidents into safe, bounded remediation actions. The Operator deterministically triages each incident against a fixed runbook catalog and dispatches matched work to the Mitigator, the only agent in the system with write-capable tools. Layered safety controls (circuit breakers, blast-radius limits, pre-dispatch verification, dry-run simulation, and rollback logging) bound the damage any single remediation can cause and keep every action auditable.

## Requirements

### Requirement: Match incidents to runbooks deterministically
The system SHALL match incidents to runbooks without LLM involvement by evaluating the ordered catalog of 8 runbooks (pod_crashloop, segment_offline, broker_unreachable, controller_down, high_restart_count, query_overload, ingestion_lag, storage_pressure) and selecting the first runbook whose severity filter, component regex, and evidence regex all match. A runbook predicate is only applied when defined; the evidence regex is tested against the space-joined evidence array.

#### Scenario: First matching runbook wins in catalog order
- **GIVEN** a CRITICAL incident with component "pinot-broker-0" and evidence "connection refused"
- **WHEN** the Operator triages the incident
- **THEN** pod_crashloop is skipped because its evidence pattern (crashloop or restart) does not match
- **AND** broker_unreachable is selected as the first runbook whose severity, component pattern (/broker/i), and evidence pattern (/unreachable|timeout|connection refused|FAIL/i) all match

#### Scenario: No matching runbook triggers a human alert
- **GIVEN** a WARNING or CRITICAL incident that matches no runbook
- **WHEN** the Operator triages the incident
- **THEN** the incident is recorded as novel, an alert is sent (console plus optional webhook), and an audit entry with action "alert_no_runbook" is logged
- **AND** the triage result action is "alerted"

#### Scenario: INFO incidents are logged only
- **GIVEN** an incident with severity INFO
- **WHEN** the Operator triages the incident
- **THEN** an audit entry with action "log_info" is written and no runbook is dispatched

### Requirement: Limit retries with a per-runbook circuit breaker
The system SHALL track remediation attempts per runbook id and component pair, and SHALL refuse dispatch once attempts reach the runbook's maxRetries within its cooldown window. The attempt record MUST be reset (deleted) when more than cooldownMs has elapsed since the last attempt, allowing dispatch again.

#### Scenario: Circuit breaker opens after max retries
- **GIVEN** the pod_crashloop runbook (maxRetries 2, cooldownMs 300000) has already been attempted 2 times for the same component within the cooldown window
- **WHEN** another matching incident for that component arrives
- **THEN** the triage result action is "circuit_broken" and no dispatch occurs
- **AND** because escalateAfterRetries is true for pod_crashloop, an alert is sent and an audit entry with action "circuit_broken" is persisted

#### Scenario: Cooldown expiry resets the breaker
- **GIVEN** an attempt record whose last attempt is older than the runbook's cooldownMs
- **WHEN** a new matching incident for the same runbook and component arrives
- **THEN** the attempt record is deleted and dispatch is permitted, restarting the attempt count at 1

### Requirement: Bound blast radius of concurrent remediations
The system SHALL allow at most one active remediation per component and at most MAX_CONCURRENT_REMEDIATIONS active remediations cluster-wide (environment variable, default 2). Incidents that exceed either limit MUST be logged and skipped, not queued.

#### Scenario: Second incident on a component with an active remediation is skipped
- **GIVEN** an active remediation is registered for component "pinot-server-1"
- **WHEN** another incident for "pinot-server-1" matches a runbook and passes the circuit breaker
- **THEN** the Operator skips dispatch, logs an audit entry with action "skipped_active_remediation", and returns triage action "logged"

#### Scenario: Global concurrency cap rejects further dispatches
- **GIVEN** 2 remediations are active (the default MAX_CONCURRENT_REMEDIATIONS)
- **WHEN** an incident for a third component matches a runbook
- **THEN** the Operator skips dispatch and logs an audit entry with action "skipped_max_concurrent"

#### Scenario: Failed dispatch releases the component lock
- **GIVEN** the Operator registered an active remediation and the POST to the Mitigator fails with a network error (not a timeout)
- **WHEN** the dispatch result is recorded
- **THEN** the component is removed from the active remediation map so later incidents can be dispatched

### Requirement: Verify incidents before dispatch and fail open
When VERIFY_BEFORE_DISPATCH is enabled (default true) and the incident severity is WARNING or CRITICAL, the system SHALL ask the Monitor /chat endpoint whether the component is still experiencing issues before dispatching, with a VERIFY_TIMEOUT_MS timeout (default 15000 ms). Verification MUST fail open: a non-OK response, unparseable or missing JSON, timeout, or network error is treated as confirmed and dispatch proceeds. Only an explicit "confirmed": false skips dispatch.

#### Scenario: Stale incident is not dispatched
- **GIVEN** the Monitor /chat response contains JSON with "confirmed": false
- **WHEN** the Operator runs pre-dispatch verification
- **THEN** dispatch is skipped, an audit entry with action "stale_incident" is persisted, and the triage result action is "stale"

#### Scenario: Unreachable Monitor does not block remediation
- **GIVEN** the Monitor is unreachable or its response contains no parseable JSON with a "confirmed" field
- **WHEN** the Operator runs pre-dispatch verification
- **THEN** the incident is treated as confirmed and dispatch proceeds

### Requirement: Dispatch fire-and-forget and report completion
The system SHALL dispatch runbooks asynchronously: the Operator POSTs to the Mitigator /dispatch endpoint with a 5000 ms timeout and treats a timeout (AbortError) as accepted, because the Mitigator executes remediations via an LLM tool loop that can take minutes (up to AGENT_MAX_TURNS, default 10 turns, within DISPATCH_TIMEOUT_MS, default 600000 ms). On completion the Mitigator MUST POST an audit message back to the Operator /incident endpoint, and the Mitigator verifies fixes during execution via the request_monitor_verify tool, which posts a verification prompt to the Monitor /chat endpoint.

#### Scenario: Dispatch timeout is treated as accepted
- **GIVEN** the Mitigator is still processing after 5000 ms
- **WHEN** the Operator's dispatch request aborts
- **THEN** the dispatch is recorded as successful with message "Dispatch accepted (mitigator processing async)" and the active remediation lock is retained

#### Scenario: Audit callback clears the active-remediation lock
- **GIVEN** the Operator holds an active remediation for a component with runbook id R
- **WHEN** the Operator receives POST /incident with from "mitigator", type "audit", and payload.runbookId R
- **THEN** the matching active remediation is deleted and the Operator responds 200 with { received: true, type: "audit" }

#### Scenario: Mitigator verifies the fix through the Monitor
- **GIVEN** the Mitigator has executed a remediation action
- **WHEN** the agent loop calls request_monitor_verify with a verification prompt
- **THEN** the prompt is POSTed to the Monitor /chat endpoint and the Monitor's response text is returned to the loop, or an error string is returned if the Monitor is unreachable

### Requirement: Confine write capability to the Mitigator
Only the Mitigator SHALL register write-capable tools (kubectl_delete, kubectl_exec, pinot_rebalance, pinot_reload_segment, pinot_update_config); Monitor tools are read-only. kubectl_delete MUST delete exactly one named resource: it rejects label selectors and wildcard names, and its namespace argument is restricted to the configured allowlist (pinot).

#### Scenario: Label selector deletion is refused
- **GIVEN** a kubectl_delete call that includes a selector argument
- **WHEN** the tool handler runs
- **THEN** it returns an error string stating it refuses to delete by label selector, without executing kubectl

#### Scenario: Wildcard names are refused
- **GIVEN** a kubectl_delete call whose name contains "*" or "?"
- **WHEN** the tool handler runs
- **THEN** it returns an error string stating it refuses wildcard names, without executing kubectl

### Requirement: Simulate writes by default with dry run
The system SHALL default to dry-run mode (DRY_RUN environment variable, default true). In dry-run mode every write tool MUST log the intended action and return a JSON result with dryRun true, without executing any kubectl command or Pinot API call.

#### Scenario: Dry-run write returns a simulated result
- **GIVEN** DRY_RUN is unset (defaulting to true)
- **WHEN** kubectl_delete is invoked with a valid resource, name, and namespace
- **THEN** no kubectl process is spawned and the tool returns JSON containing "dryRun": true, the action name, the arguments, and a timestamp

### Requirement: Capture before-state and log rollback entries
For every executed (non-dry-run) mutation, the mutating tools kubectl_delete, pinot_reload_segment, and pinot_update_config SHALL capture the target's before-state and append an entry to an in-memory rollback log capped at 50 entries and exposed at GET /rollback. Entries MUST include an undo action when the mutation is reversible; irreversible or idempotent actions record undoAction null.

#### Scenario: Pod deletion records before-state YAML
- **GIVEN** dry-run mode is disabled
- **WHEN** kubectl_delete deletes a pod successfully
- **THEN** the pod's YAML is captured via kubectl get before deletion and a rollback entry is recorded with that before-state and undoAction null
- **AND** the entry is retrievable from GET /rollback

#### Scenario: Config update records an undo action
- **GIVEN** dry-run mode is disabled and the current table config was fetched successfully
- **WHEN** pinot_update_config applies a new table config
- **THEN** the rollback entry's undoAction is a pinot_update_config call carrying the previous config so the change can be reversed
