# incident-detection Specification

## Purpose
Incident detection turns the Monitor agent's LLM sweep output into validated, structured incident records that downstream agents can act on. It defines the canonical incident schema, extracts incidents from sweep responses, rejects malformed data at the boundary, retains recent incidents and sweep history in bounded in-memory stores, and forwards detected incidents to the Operator for remediation.

## Requirements

### Requirement: Canonical incident schema
The system SHALL define a canonical incident record validated with Zod, consisting of `id` (string), `severity` (enum of `CRITICAL`, `WARNING`, `INFO`), `component` (string), `evidence` (array of strings), `suggestedAction` (string), and `timestamp` (string). All incident producers and consumers MUST use this schema, exported from the shared package.

#### Scenario: Valid incident passes schema validation
- **GIVEN** an object with string `id`, `component`, `suggestedAction`, and `timestamp`, a string array `evidence`, and `severity` equal to `CRITICAL`, `WARNING`, or `INFO`
- **WHEN** it is parsed against the shared Incident Zod schema
- **THEN** parsing succeeds and yields a typed Incident record

#### Scenario: Unknown severity fails schema validation
- **GIVEN** an incident object whose `severity` is not one of `CRITICAL`, `WARNING`, or `INFO`
- **WHEN** it is parsed against the Incident Zod schema
- **THEN** validation fails

### Requirement: Parse incidents from LLM sweep output
The system SHALL parse incidents from the LLM sweep response by first looking for a fenced ```json code block containing either an incident array or an object with an `incidents` array. Parsed entries MUST be normalized before validation: a missing `id` gets a random UUID, an unrecognized `severity` defaults to `WARNING`, a missing `component` defaults to `unknown`, a missing `evidence` defaults to an empty array, and missing `suggestedAction` or `timestamp` default to an empty string and the current ISO time respectively.

#### Scenario: JSON block with incidents array
- **GIVEN** a sweep response containing a ```json block with an `incidents` array
- **WHEN** the response is parsed
- **THEN** each entry is normalized and validated, and the valid incidents are returned

#### Scenario: Malformed JSON block falls back to text report
- **GIVEN** a sweep response whose ```json block is not valid JSON
- **WHEN** the response is parsed
- **THEN** parsing falls back to extracting incidents from the text report

### Requirement: Text report fallback driven by overall status
When no usable JSON block is present, the system SHALL extract incidents from the text report using the `Overall Status:` line (`HEALTHY`, `DEGRADED`, or `CRITICAL`, matched case-insensitively). A `HEALTHY` status yields no incidents. Otherwise each bulleted or numbered line in the `── Issues ──` section becomes one incident with severity `CRITICAL` when the overall status is `CRITICAL` and `WARNING` otherwise, the line text as its single evidence entry, an empty `suggestedAction`, and a component guessed from keywords in the line (controller, broker, server, segment, zookeeper, pod/crash mapping to `kubernetes`, otherwise `unknown`).

#### Scenario: Healthy report produces no incidents
- **GIVEN** a sweep response with no JSON block and `Overall Status: HEALTHY`
- **WHEN** the response is parsed
- **THEN** an empty incident list is returned

#### Scenario: Critical report issues become critical incidents
- **GIVEN** a sweep response with `Overall Status: CRITICAL` and an Issues section listing `- pinot-broker pod is CrashLoopBackOff`
- **WHEN** the response is parsed
- **THEN** an incident is created with severity `CRITICAL`, component `pinot-broker`, and the issue line as evidence

#### Scenario: Issues section reports none detected
- **GIVEN** a non-healthy report whose Issues section contains the text `none detected`
- **WHEN** the response is parsed
- **THEN** an empty incident list is returned

### Requirement: Boundary validation with dropped counter
The system SHALL validate every parsed incident before it is stored or forwarded, dropping any incident that fails the Zod schema, has a `component` that is empty after trimming, or has an empty `evidence` array. Each drop MUST increment a dropped-incident counter and emit a structured JSON warning log with the reason and the raw incident.

#### Scenario: Incident with empty component is dropped
- **GIVEN** a parsed incident whose `component` is an empty or whitespace-only string
- **WHEN** boundary validation runs
- **THEN** the incident is excluded from the results
- **AND** the dropped-incident counter increments and a warning log with action `dropped_invalid_incident` is emitted

#### Scenario: Incident with empty evidence is dropped
- **GIVEN** a parsed incident whose `evidence` array has zero entries
- **WHEN** boundary validation runs
- **THEN** the incident is excluded and the dropped-incident counter increments

### Requirement: Bounded incident store queryable by severity
The system SHALL keep detected incidents in an in-memory store capped at 500 entries, discarding the oldest entries when the cap is exceeded. `GET /incidents` MUST return the stored incidents as `{ incidents: [...] }`, optionally filtered by a case-insensitive `severity` query parameter, and MUST respond with status 400 when the severity is not one of `CRITICAL`, `WARNING`, `INFO`.

#### Scenario: Store trims to 500 incidents
- **GIVEN** the store already holds 500 incidents
- **WHEN** a new sweep stores additional incidents
- **THEN** the oldest incidents are removed so the store holds at most 500

#### Scenario: Filter incidents by severity
- **GIVEN** stored incidents of mixed severities
- **WHEN** a client calls `GET /incidents?severity=critical`
- **THEN** the response contains only incidents with severity `CRITICAL`

#### Scenario: Invalid severity rejected
- **GIVEN** the monitor server is running
- **WHEN** a client calls `GET /incidents?severity=BOGUS`
- **THEN** the server responds with status 400 and an error listing the valid severities

### Requirement: Fire-and-forget forwarding to operator
When a sweep detects one or more incidents, the system SHALL POST `{ incidents }` as JSON to the Operator's `/incident` endpoint without awaiting the result in the sweep flow. Forwarding failures MUST be logged and MUST NOT change the sweep's HTTP response, which still returns status 200 with the report and incidents. Sweeps that detect zero incidents SHALL NOT call the Operator.

#### Scenario: Incidents forwarded after sweep
- **GIVEN** a sweep that produces two valid incidents
- **WHEN** the sweep completes
- **THEN** the incidents are sent via POST to the Operator `/incident` endpoint
- **AND** the sweep response returns status 200 without waiting for the forward to finish

#### Scenario: Operator unreachable does not fail the sweep
- **GIVEN** the Operator service is down
- **WHEN** a sweep with incidents completes
- **THEN** the forwarding error is logged and the sweep still returns status 200 with its report and incidents

### Requirement: Sweep history with trend detection
The system SHALL record each completed sweep (timestamp, duration in milliseconds, incident count, and incidents) in an in-memory history capped at 1000 records, emitting a structured JSON log line per sweep. It SHALL compute a trend summary for the current sweep's incidents by counting past sweeps within a 24 hour lookback that contained an incident with the same component and severity, and include that summary as `trends` in the sweep response when non-empty. `GET /history` MUST return `{ count, sweeps }`, accept an optional positive integer `hours` query parameter to limit results, and respond with status 400 for a non-positive or non-numeric `hours` value.

#### Scenario: Recurring incident appears in trend summary
- **GIVEN** prior sweeps within the last 24 hours recorded a `WARNING` incident for component `pinot-server`
- **WHEN** a new sweep detects another `WARNING` incident for `pinot-server`
- **THEN** the sweep response includes a `trends` string reporting how many recent sweeps contained that component and severity

#### Scenario: History filtered by hours
- **GIVEN** recorded sweeps spanning several days
- **WHEN** a client calls `GET /history?hours=24`
- **THEN** the response contains only sweeps whose timestamps fall within the last 24 hours, with `count` matching the returned list

#### Scenario: Invalid hours parameter rejected
- **GIVEN** the monitor server is running
- **WHEN** a client calls `GET /history?hours=abc`
- **THEN** the server responds with status 400 and an error stating the parameter must be a positive integer
