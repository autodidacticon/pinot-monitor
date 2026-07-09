# audit-observability Specification

## Purpose
Records every autonomous decision and remediation action the agent system takes so that humans can reconstruct what happened, why, and in what order. Provides an in-memory audit trail with structured log persistence, correlation IDs that tie a triage decision to its downstream mitigation and verification, Prometheus metrics on all three agents, and a rollback log of write actions with captured before-state.

## Requirements

### Requirement: Audit every operator triage decision
The system SHALL record an audit entry for every triage decision the Operator makes, covering all outcomes: `log_info`, `alert_no_runbook`, `circuit_broken`, `observe`, `suggest`, `pending_approval`, `skipped_active_remediation`, `skipped_max_concurrent`, `stale_incident`, `dispatch`, `dispatch_approved`, and `dispatch_rejected`. Each entry MUST contain `timestamp`, `agent`, `action`, `target`, `inputSummary`, `outputSummary`, and `correlationId`. The in-memory log retains at most 1000 entries, discarding the oldest first.

#### Scenario: Dispatch decision is audited
- **GIVEN** the Operator receives a valid incident that matches a runbook and passes all gates
- **WHEN** the incident is dispatched to the Mitigator
- **THEN** an audit entry is recorded with `agent` set to `operator`, `action` set to `dispatch`, `target` set to the incident component, and an `inputSummary` naming the runbook and attempt number
- **AND** the entry's `outputSummary` reflects dispatch success or failure

#### Scenario: Log is capped at 1000 entries
- **GIVEN** the in-memory audit log already holds 1000 entries
- **WHEN** a new triage decision is audited
- **THEN** the oldest entry is removed so the log never exceeds 1000 entries

### Requirement: Expose the audit log via GET /audit
The system SHALL serve the Operator audit log at `GET /audit`, returning HTTP 200 with a JSON body of the form `{ "entries": [...] }` containing the most recent 100 entries in chronological order.

#### Scenario: Retrieve recent audit entries
- **GIVEN** the Operator has recorded triage decisions
- **WHEN** a client sends `GET /audit`
- **THEN** the response is HTTP 200 with an `entries` array of audit objects, each carrying the seven audit fields
- **AND** at most the 100 most recent entries are returned

### Requirement: Persist consequential audit entries as structured logs
The system SHALL additionally persist audit entries for consequential actions by writing a structured JSON line to stdout with `level` set to `audit` and all seven audit fields. Consequential actions are `alert_no_runbook`, `circuit_broken`, `pending_approval`, `stale_incident`, `dispatch`, `dispatch_approved`, and `dispatch_rejected`; purely observational actions (`log_info`, `observe`, `suggest`, `skipped_active_remediation`, `skipped_max_concurrent`) are recorded in memory only. Durable retention and rotation of these log lines is delegated to the deployment environment (Kubernetes or systemd), not to the application.

#### Scenario: Dispatch is persisted as a JSON log line
- **GIVEN** the Operator dispatches an incident to the Mitigator
- **WHEN** the audit entry is recorded
- **THEN** a single-line JSON object is written to stdout containing `"level":"audit"` plus `timestamp`, `agent`, `action`, `target`, `inputSummary`, `outputSummary`, and `correlationId`

#### Scenario: Observe-mode decisions are not persisted
- **GIVEN** the Operator runs at trust level 0
- **WHEN** an incident is triaged and audited with action `observe`
- **THEN** the entry appears in the in-memory log served by `GET /audit` but no `level: audit` JSON line is emitted for it

### Requirement: Correlate actions end to end with correlation IDs
The system SHALL generate a UUID correlation ID at the start of each Operator triage and propagate it unchanged through the dispatch message to the Mitigator, the Mitigator's audit callback to the Operator, and every audit entry produced for that incident. This makes a full remediation traceable from triage through mitigation to verification callback using a single ID. If a dispatch arrives at the Mitigator without a correlation ID, the Mitigator MUST substitute the literal string `none`.

#### Scenario: Correlation ID flows through dispatch and callback
- **GIVEN** the Operator triages an incident and generates correlation ID X
- **WHEN** the incident is dispatched
- **THEN** the `POST /dispatch` message body sent to the Mitigator carries `correlationId` X
- **AND** the Mitigator's audit callback (`POST /incident` with `from: "mitigator"`, `type: "audit"`) and its dispatch response body both echo correlation ID X
- **AND** every audit entry the Operator records for that incident carries correlation ID X

#### Scenario: Missing correlation ID is defaulted
- **GIVEN** a client posts a dispatch to the Mitigator without a `correlationId`
- **WHEN** the dispatch is processed
- **THEN** the Mitigator uses the string `none` as the correlation ID in its logs, audit callback, and response

### Requirement: Expose Prometheus metrics on all three agents
The system SHALL serve Prometheus text-format metrics at `GET /metrics` on each agent, responding HTTP 200 with `Content-Type: text/plain; version=0.0.4`. Each metric includes `# HELP` and `# TYPE` lines, and histograms emit `_bucket` series with `le` labels (including `+Inf`) plus `_sum` and `_count`. The Monitor exposes `monitor_sweeps_total`, `monitor_sweep_errors_total`, `monitor_incidents_detected_total`, `monitor_chat_requests_total`, and the `monitor_sweep_duration_seconds` histogram (buckets 1, 5, 10, 30, 60, 120, 300). The Operator exposes `operator_incidents_received_total`, `operator_incidents_dispatched_total`, `operator_incidents_no_runbook_total`, `operator_circuit_breaker_trips_total`, `operator_rate_limit_rejections_total`, and the `operator_triage_duration_seconds` histogram. The Mitigator exposes `mitigator_dispatches_received_total`, `mitigator_dispatches_completed_total`, `mitigator_dispatch_errors_total`, and the `mitigator_dispatch_duration_seconds` histogram (buckets 1, 5, 10, 30, 60, 120, 300).

#### Scenario: Scrape operator metrics
- **GIVEN** the Operator has triaged at least one incident
- **WHEN** a client sends `GET /metrics` to the Operator
- **THEN** the response is HTTP 200 with `Content-Type: text/plain; version=0.0.4`
- **AND** the body contains `operator_incidents_received_total` with a nonzero value and `operator_triage_duration_seconds_bucket`, `_sum`, and `_count` series

#### Scenario: All agents expose their metric families
- **GIVEN** all three agents are running
- **WHEN** each agent's `GET /metrics` endpoint is scraped
- **THEN** the Monitor body contains the `monitor_*` metrics, the Operator body contains the `operator_*` metrics, and the Mitigator body contains the `mitigator_*` metrics named above, each preceded by `# HELP` and `# TYPE` lines

### Requirement: Expose the mitigator rollback log via GET /rollback
The system SHALL record a rollback log entry for every executed (non-dry-run) `kubectl_delete`, `pinot_reload_segment`, and `pinot_update_config` action, containing `id` (UUID), `timestamp`, `tool`, `args`, the captured `beforeState`, and an `undoAction` (tool plus args, or null when the action is not undoable), and serve the log at `GET /rollback` as `{ "entries": [...] }`. The log retains at most 50 entries, discarding the oldest first, and each recorded action is also emitted to stdout as a JSON line with `level` set to `rollback`. `kubectl_exec` and `pinot_rebalance` are not currently recorded, and dry-run simulations record nothing (a known coverage gap tracked in docs/architect-todo.md).

#### Scenario: Retrieve rollback entries after a remediation
- **GIVEN** the Mitigator has executed a write action that captured before-state
- **WHEN** a client sends `GET /rollback`
- **THEN** the response is HTTP 200 with an `entries` array whose items each contain `id`, `timestamp`, `tool`, `args`, `beforeState`, and `undoAction`

#### Scenario: Rollback log is capped at 50 entries
- **GIVEN** the rollback log already holds 50 entries
- **WHEN** a new action is recorded
- **THEN** the oldest entry is removed so `GET /rollback` returns at most 50 entries

### Requirement: Log validation drops as structured JSON
The system SHALL emit a structured JSON warning whenever the Monitor drops an incident parsed from LLM sweep output that fails validation (schema mismatch, empty `component`, or empty `evidence` array). The log line contains `level` set to `validation`, `action` set to `dropped_invalid_incident`, a human-readable `reason`, and the raw rejected payload, and the Monitor increments an internal dropped-incident counter. Dropped incidents MUST NOT be stored or forwarded to the Operator.

#### Scenario: Invalid incident from a sweep is dropped and logged
- **GIVEN** a sweep response contains an incident with an empty `evidence` array
- **WHEN** the Monitor parses the sweep output
- **THEN** a JSON warning line is emitted with `"level":"validation"`, `"action":"dropped_invalid_incident"`, the reason `evidence array is empty`, and the raw incident payload
- **AND** the incident is excluded from the stored incidents and from forwarding to the Operator
