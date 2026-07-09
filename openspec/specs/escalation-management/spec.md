# escalation-management Specification

## Purpose
Escalation management governs how much autonomy the Operator has when acting on incidents. A graduated trust-level model gates whether matched runbooks are merely logged, suggested to humans, queued for explicit approval, or auto-dispatched to the Mitigator. It also routes unhandled incidents to humans via alerts and novel-incident tracking, and protects the Operator from incident floods.

## Requirements

### Requirement: Enforce a graduated trust-level model
The system SHALL operate at a single trust level in the range 0 to 3, where 0 = observe, 1 = suggest, 2 = approve, and 3 = auto-remediate. The level MUST be read from the `TRUST_LEVEL` environment variable, default 0, and clamped to the 0-3 range.

#### Scenario: Default trust level is observe
- **GIVEN** the Operator starts with no `TRUST_LEVEL` environment variable set
- **WHEN** configuration is loaded
- **THEN** the effective trust level is 0 (observe)

#### Scenario: Out-of-range values are clamped
- **GIVEN** `TRUST_LEVEL` is set to `7`
- **WHEN** configuration is loaded
- **THEN** the effective trust level is clamped to 3 (auto-remediate)

### Requirement: Gate runbook dispatch by per-runbook minimum trust level
Each runbook declares a `minTrustLevel` (0-3). When the configured trust level is below a matched runbook's `minTrustLevel`, the system SHALL NOT dispatch the runbook to the Mitigator. At trust level 0 the decision MUST be audit-logged only; at trust levels 1 or 2 the system MUST send an alert containing the suggested runbook and its action tools, and audit-log a `suggest` decision.

#### Scenario: Observe mode logs the proposed action only
- **GIVEN** trust level 0 and a CRITICAL incident matching runbook `pod_crashloop` (minTrustLevel 2)
- **WHEN** the incident is triaged
- **THEN** an audit entry with action `observe` records the runbook and its proposed actions
- **AND** no alert is sent and nothing is dispatched to the Mitigator

#### Scenario: Suggest mode alerts with the proposed action
- **GIVEN** trust level 1 and a CRITICAL incident matching runbook `broker_unreachable` (minTrustLevel 2)
- **WHEN** the incident is triaged
- **THEN** an alert is sent with the reason `Suggested action (trust 1 < 2)` including the runbook id and action tools
- **AND** the triage result is `suggested` and nothing is dispatched to the Mitigator

#### Scenario: Sufficient trust level allows dispatch
- **GIVEN** trust level 3 and a CRITICAL incident matching runbook `controller_down` (minTrustLevel 3)
- **WHEN** the incident is triaged and passes circuit-breaker, blast-radius, and staleness checks
- **THEN** the runbook is dispatched to the Mitigator and audit-logged with action `dispatch`

### Requirement: Queue critical remediations for human approval at trust level 2
When the trust level is exactly 2 and a CRITICAL incident matches a runbook whose `minTrustLevel` is satisfied, the system SHALL queue the remediation as a pending approval instead of dispatching it, audit-logging a `pending_approval` decision that includes the approval id.

#### Scenario: Critical incident is queued instead of dispatched
- **GIVEN** trust level 2 and a CRITICAL incident matching runbook `pod_crashloop` (minTrustLevel 2)
- **WHEN** the incident is triaged
- **THEN** a pending approval with status `pending` is created and its id returned in the triage message
- **AND** nothing is dispatched to the Mitigator until a human decides

### Requirement: Expose approval endpoints for human decisions
The system SHALL expose `GET /pending-approvals` returning only approvals still in `pending` status, `POST /approve/:id` which marks the approval approved and dispatches the queued runbook to the Mitigator, and `POST /reject/:id` which marks it rejected without dispatching. Unknown ids MUST return HTTP 404 and already-decided approvals MUST return HTTP 409.

#### Scenario: Approving dispatches the queued remediation
- **GIVEN** a pending approval exists
- **WHEN** `POST /approve/:id` is called with its id
- **THEN** the runbook is dispatched to the Mitigator using the original incident and correlation id
- **AND** the response is HTTP 200 with `{"status": "approved"}` and the dispatch result, and a `dispatch_approved` audit entry is written

#### Scenario: Rejecting declines without dispatch
- **GIVEN** a pending approval exists
- **WHEN** `POST /reject/:id` is called with its id
- **THEN** the response is HTTP 200 with `{"status": "rejected"}`, a `dispatch_rejected` audit entry is written, and nothing is dispatched

#### Scenario: Unknown or already-decided approvals are refused
- **GIVEN** an id that does not exist, or one that was already approved or rejected
- **WHEN** `POST /approve/:id` or `POST /reject/:id` is called
- **THEN** the response is HTTP 404 with `{"error": "Approval not found"}` for an unknown id, or HTTP 409 for an already-decided approval

### Requirement: Log INFO incidents without remediation
The system SHALL handle incidents with severity `INFO` by writing a `log_info` audit entry only. INFO incidents MUST never be dispatched, alerted, or queued for approval, regardless of trust level or runbook match.

#### Scenario: INFO incident is logged only
- **GIVEN** trust level 3 and an incident with severity `INFO`
- **WHEN** the incident is triaged
- **THEN** the triage result is `logged` with message `INFO severity — logged only`
- **AND** no runbook is dispatched and no alert is sent

### Requirement: Record unmatched incidents as novel and alert
When a non-INFO incident matches no runbook, the system SHALL record it as a novel incident and send an alert with reason `No matching runbook`. Novel incidents MUST be deduplicated by a pattern derived from the component and evidence keywords, tracking occurrence counts, first and last seen timestamps, and up to 5 example evidence sets, and MUST be readable via `GET /novel-incidents` sorted by occurrence count descending.

#### Scenario: First occurrence creates a novel incident
- **GIVEN** a WARNING incident whose component and evidence match no runbook
- **WHEN** the incident is triaged
- **THEN** a novel incident with status `new` and occurrence count 1 is recorded
- **AND** an alert is sent and an `alert_no_runbook` audit entry is written

#### Scenario: Repeat occurrences are deduplicated
- **GIVEN** a novel incident already exists for a pattern
- **WHEN** another incident producing the same pattern is triaged
- **THEN** the existing record's occurrence count is incremented and `lastSeen` updated instead of creating a duplicate

### Requirement: Deliver alerts to an optional webhook
The system SHALL log every alert to the console, and when `ALERT_WEBHOOK_URL` is configured (default empty, disabled) it MUST also POST a JSON body containing the incident, the alert reason, and a timestamp to that URL. Webhook delivery failures MUST be caught and MUST NOT disrupt incident triage.

#### Scenario: Webhook configured receives the alert payload
- **GIVEN** `ALERT_WEBHOOK_URL` is set and an alert is raised
- **WHEN** the alert is sent
- **THEN** the webhook receives an HTTP POST with JSON fields `incident`, `reason`, and `timestamp`

#### Scenario: Webhook failure does not block triage
- **GIVEN** `ALERT_WEBHOOK_URL` points to an unreachable host
- **WHEN** an alert is sent during triage
- **THEN** the failure is logged and triage completes normally

### Requirement: Rate-limit incident intake
The system SHALL protect `POST /incident` with a sliding-window rate limiter, defaulting to 10 requests per 60000 ms window (configurable via `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_MS`). Requests over the limit MUST be rejected before triage with HTTP 429, a `Retry-After` header equal to the window length in seconds, and a rate-limit rejection metric increment.

#### Scenario: Flood of incidents is throttled
- **GIVEN** default rate-limit configuration and 10 `POST /incident` requests already accepted within the current 60 second window
- **WHEN** an 11th request arrives
- **THEN** the response is HTTP 429 with body `{"error": "Rate limit exceeded. Try again later."}`
- **AND** the `Retry-After` header is `60` and the request never reaches triage
