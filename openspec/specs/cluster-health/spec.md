# cluster-health Specification

## Purpose
Cluster health is the Monitor agent's observation capability. It gives an LLM-driven agent safe, strictly read-only visibility into an Apache Pinot cluster and its Kubernetes environment, and exposes that visibility as on-demand sweeps, interactive chat, and a continuous watch stream. It is the sole source of cluster observations for the rest of the agent system; the Monitor never mutates cluster state.

## Requirements

### Requirement: On-demand full sweep
The system SHALL execute a full monitoring sweep when `POST /sweep` is received, driving the LLM through the fixed sweep procedure (controller connectivity, component metrics, K8s events and pod status, cluster info, tables, segments, ingestion lag, storage, query latency, data-level checks) and returning HTTP 200 with a body containing `report` (human-readable health report with overall status HEALTHY, DEGRADED, or CRITICAL), `incidents` (structured incident array parsed from the report), and optional `trends`. Sweep execution MUST be bounded by `SWEEP_TIMEOUT_MS` (default 900000 ms) and the agent loop by `AGENT_MAX_TURNS` (default 25).

#### Scenario: Successful sweep produces a health report
- **GIVEN** the Monitor server is running and its tools can reach the cluster
- **WHEN** a client sends `POST /sweep`
- **THEN** the response is HTTP 200 with `report`, `incidents`, and optional `trends` fields
- **AND** the sweep is recorded in sweep history and detected incidents are stored for retrieval via `GET /incidents`

#### Scenario: Sweep failure is reported
- **GIVEN** the agent loop throws an error during a sweep
- **WHEN** the sweep terminates
- **THEN** the response is HTTP 500 with a body of `{ "error": <message> }`
- **AND** the sweep error counter is incremented

### Requirement: Strict read-only observation
The system SHALL enforce read-only access in every observation tool. `kubectl_get` MUST accept only the subcommands `get`, `describe`, `top`, and `logs`, MUST restrict the namespace to the whitelist `pinot`, `openclaw`, `kube-system`, and MUST reject any argument starting with `--force`, `-f`, `--delete`, `--cascade`, or `--grace-period=0` by returning an error string instead of executing. `pinot_query` MUST accept only SQL whose first word is `SELECT`. Kubectl commands MUST be executed via `execFile` (no shell interpretation) with a 30 second timeout and 1 MB output buffer.

#### Scenario: Dangerous kubectl flag is rejected
- **GIVEN** the LLM calls `kubectl_get` with args containing `--force`
- **WHEN** the tool handler runs
- **THEN** it returns `Error: flag "--force" is not allowed (read-only mode)` without invoking kubectl

#### Scenario: Non-SELECT SQL is rejected
- **GIVEN** the LLM calls `pinot_query` with `DROP TABLE events`
- **WHEN** the tool handler validates the statement
- **THEN** it returns `Error: only SELECT queries are allowed (read-only mode)` without contacting the broker

#### Scenario: Non-whitelisted namespace is rejected
- **GIVEN** the LLM calls `kubectl_get` with namespace `default`
- **WHEN** the tool arguments are validated against the schema
- **THEN** the call fails schema validation because the namespace is not one of `pinot`, `openclaw`, `kube-system`

### Requirement: Fixed observation tool set
The system SHALL expose exactly 12 registered observation tools as the LLM's only means of accessing the cluster: `kubectl_events`, `kubectl_get`, `pinot_health`, `pinot_tables`, `pinot_segments`, `pinot_cluster_info`, `pinot_debug_table`, `pinot_table_size`, `pinot_broker_latency`, `pinot_ingestion_status`, `pinot_query`, and `pinot_server_metrics`. Tool handlers MUST return error strings on failure rather than throwing, so a failed check does not abort the sweep.

#### Scenario: Tool failure does not abort the sweep
- **GIVEN** the Pinot controller is unreachable
- **WHEN** `pinot_health` executes during a sweep
- **THEN** the tool returns an error string describing the fetch failure
- **AND** the agent loop continues with the remaining checks and notes the failure in the report

#### Scenario: Tools are the only cluster access
- **GIVEN** a sweep or chat request is in progress
- **WHEN** the LLM needs cluster information
- **THEN** it can only obtain it through the 12 registered tool specs passed to the agent loop, and the system prompt instructs it to use no other tools

### Requirement: Interactive chat with TTL sessions
The system SHALL answer conversational questions via `POST /chat` with a body of `{ sessionId?, message }` where `message` is a non-empty string. A missing or unknown `sessionId` MUST create a new session seeded with the chat system prompt; a known `sessionId` MUST resume that session's message history. Sessions MUST expire after `SESSION_TTL_MS` (default 3600000 ms) of inactivity, with expired sessions purged every 10 minutes. Responses MUST include `sessionId`, `response`, and the `toolCalls` made. Chat requests MUST be bounded by `CHAT_TIMEOUT_MS` (default 600000 ms).

#### Scenario: New chat session is created
- **GIVEN** a client sends `POST /chat` with no `sessionId`
- **WHEN** the request is processed
- **THEN** a new session with a random UUID is created and the response returns that `sessionId` along with `response` and `toolCalls`

#### Scenario: Expired session is replaced
- **GIVEN** a session whose last access was more than 3600000 ms ago
- **WHEN** a client sends `POST /chat` with that `sessionId`
- **THEN** the expired session is deleted and a fresh session with the same id is created, losing the prior conversation history

### Requirement: Continuous watch mode
The system SHALL stream continuous monitoring results over Server-Sent Events at `GET /watch`. On connect the server MUST send a `connected` event and start a shared watch loop (if not already running) that executes a mini-sweep every `WATCH_INTERVAL_MS` (default 60000 ms) and broadcasts a `sweep` event with `timestamp`, `incidentCount`, `incidents`, and optional `trends` to all connected clients. Mini-sweep failures MUST broadcast an `error` event without stopping the loop. The loop MUST stop when the last client disconnects.

#### Scenario: Client connects to watch stream
- **GIVEN** no watch loop is running
- **WHEN** a client opens `GET /watch`
- **THEN** the response uses `Content-Type: text/event-stream` and immediately delivers a `connected` event
- **AND** the watch loop starts with the configured interval

#### Scenario: Loop stops when no clients remain
- **GIVEN** a watch loop is running with one connected client
- **WHEN** that client disconnects
- **THEN** the watch loop is stopped and no further mini-sweeps run until a new client connects

#### Scenario: Mini-sweep failure is broadcast
- **GIVEN** clients are connected and a mini-sweep throws an error
- **WHEN** the interval fires
- **THEN** all clients receive `{ "type": "error", "timestamp": ..., "error": <message> }` and the loop continues on schedule

### Requirement: LLM provider agnosticism
The system SHALL talk to its LLM through the OpenAI-compatible chat completions API, configured entirely by environment variables: `LLM_BASE_URL` (default `http://localhost:11434/v1`), `LLM_MODEL` (default `glm-4.7-flash`), and `LLM_API_KEY` (default `ollama`). The legacy variables `OLLAMA_BASE_URL` and `OLLAMA_MODEL` MUST still be honored as fallbacks when the `LLM_*` variables are unset. No provider-specific code paths are permitted; any endpoint implementing the OpenAI `/v1` chat completions and function-calling contract works unchanged.

#### Scenario: Default provider is local Ollama
- **GIVEN** no LLM environment variables are set
- **WHEN** the Monitor starts
- **THEN** it creates an OpenAI client against `http://localhost:11434/v1` with model `glm-4.7-flash` and api key `ollama`

#### Scenario: Switching to a hosted provider
- **GIVEN** `LLM_BASE_URL`, `LLM_MODEL`, and `LLM_API_KEY` are set to a hosted OpenAI-compatible endpoint
- **WHEN** the Monitor starts
- **THEN** sweeps, chat, and watch mode all use that provider with no code changes, and legacy `OLLAMA_*` values are ignored in favor of the `LLM_*` values
