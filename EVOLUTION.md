# Pinot Agent System — Evolution Plan

## Vision

Evolve the pinot-monitor from a single read-only observer into a multi-agent system where specialized agents collaborate to observe, diagnose, and remediate infrastructure autonomously. Three runtime agents handle the production loop; development tasks (architecture, quality control, code generation) are handled by claude-flow/ruflo.

---

## Runtime Agents

### 1. Monitor (exists)

**Role:** Read-only observation. Detects problems, produces health reports, answers questions about cluster state.

**Current state:** HTTP server on :3000 with `/health`, `/sweep`, `/chat`, `/incidents`. Seven read-only tools (kubectl_get, pinot_health, pinot_tables, pinot_segments, pinot_cluster_info, pinot_debug_table, pinot_query).

**Evolution path:**

| Phase | Capability |
|-------|-----------|
| P0 ✅ | Add Pinot SQL query tool (broker `/query/sql`) for data-level health checks (row counts, freshness, null ratios) |
| P1 ✅ | Structured incident reports — emit machine-readable incident objects (severity, affected components, evidence, suggested actions) |
| P2 | Continuous watch mode — long-lived WebSocket or SSE stream that pushes state changes as they occur, rather than polling via CronJob |
| P3 | Historical awareness — persist sweep results (SQLite or Pinot itself) so the monitor can answer "when did this start?" and detect trends |

### 2. Mitigator (exists)

**Role:** Performs mutation operations on the cluster in response to dispatches from the Operator. This is the agent that acts.

**Tools (write-capable):**
- `kubectl_delete` — delete pods (force restart), jobs, etc.
- `kubectl_exec` — run commands inside pods
- `kubectl_get_mitigator` — read state with before-state capture
- `pinot_rebalance` — trigger table rebalance via controller API
- `pinot_reload_segment` — reload specific segments
- `pinot_update_config` — modify table/instance config via controller API
- `request_monitor_verify` — ask the Monitor to verify a fix took effect

**Constraints:**
- Every mutation must be logged with before/after state
- The Mitigator never observes directly — it receives a dispatch from the Operator and acts on it
- Rollback capability: every action records an undo operation that can be replayed

**Communication with Monitor:**
- Mitigator calls Monitor's `/chat` endpoint with the incident context: "I just restarted pod X for reason Y. Verify the fix."
- Monitor runs a targeted check and returns pass/fail
- This forms a closed remediation loop: detect → act → verify

**Runbooks:**
The Mitigator's behavior is driven by runbooks — structured remediation plans for known failure modes. Examples:

```
INCIDENT: segment_offline
CONDITION: pinot_segments returns OFFLINE segments for > 5 minutes
ACTIONS:
  1. pinot_reload_segment(table, segment)
  2. wait 30s
  3. request_monitor_verify("verify segment {segment} on table {table} is ONLINE")
ESCALATE_IF: monitor check fails after 2 retries
```

```
INCIDENT: pod_crashloop
CONDITION: pod restart count > 5 in last 10 minutes
ACTIONS:
  1. kubectl_get describe pod (capture events)
  2. kubectl_delete pod (let StatefulSet/Deployment recreate)
  3. wait 60s
  4. request_monitor_verify("verify pod {pod} is Running")
ESCALATE_IF: pod re-enters CrashLoopBackOff within 5 minutes
```

### 3. Operator (exists)

**Role:** Runtime orchestrator. Decides when the Monitor's findings should trigger the Mitigator, manages escalation to humans, and enforces policy. This is the agent that decides.

**Why it's needed:** The Monitor detects. The Mitigator acts. But something needs to sit between them and decide _whether_ to act, _when_, and _how aggressively_. Without the Operator, the Mitigator would either auto-remediate everything (dangerous) or require human approval for everything (defeats the purpose).

**Current state:** HTTP server on :3002 with `/health`, `POST /incident`, `GET /audit`. Deterministic rules engine with 5 runbooks, circuit breaker, and audit log.

**Responsibilities:**
- Receive incident reports from Monitor
- Match incidents against approved runbooks
- If a matching runbook exists and confidence is high → dispatch to Mitigator
- If no runbook exists or confidence is low → log and alert (webhook, Slack, etc.)
- Track remediation attempts and enforce circuit breakers (e.g., "don't restart this pod more than 3 times in an hour")
- Maintain an audit log of all decisions and actions

**Evolution path:**
The Operator is currently a deterministic rules engine. An LLM-based Operator could handle novel situations better — triaging incidents that don't match any runbook by reasoning about the cluster state. Start deterministic, evolve to LLM-assisted.

---

## Development with claude-flow/ruflo

Architecture, quality control, code generation, and runbook authoring are handled by claude-flow/ruflo agents rather than dedicated runtime services. This means:

- New runbooks and tools are developed through ruflo's orchestration
- Code quality is enforced by ruflo's verification and review capabilities
- The runtime system stays focused on the observe → decide → act loop
- No Architect or QC services need to be deployed or maintained

---

## Communication Protocol

Agents communicate over HTTP. Each agent is a service in the cluster.

```
┌──────────┐  incident   ┌──────────┐  dispatch   ┌────────────┐
│ Monitor  │────────────▶│ Operator │────────────▶│ Mitigator  │
│ :3000    │             │ :3002    │             │ :3001      │
└──────────┘             └──────────┘             └────────────┘
     ▲                        │                        │
     │         verify         │     audit log          │
     └────────────────────────┼────────────────────────┘
                              │
                              ▼
                        ┌──────────┐
                        │  Alert   │
                        │(external)│
                        └──────────┘
```

**Message format (all inter-agent messages):**

```json
{
  "from": "monitor",
  "to": "operator",
  "type": "incident",
  "correlationId": "uuid",
  "timestamp": "iso8601",
  "payload": { ... }
}
```

Message types:
- `incident` — Monitor → Operator (problem detected)
- `dispatch` — Operator → Mitigator (go fix this)
- `verify` — Mitigator → Monitor (check if fix worked)
- `verify_result` — Monitor → Mitigator (pass/fail)
- `audit` — any agent → Operator (log an action)
- `alert` — Operator → external (human notification)

---

## Shared Infrastructure

### Shared Tool Library (complete)

The `@pinot-agents/shared` package provides `defineTool()`, Zod-based schema validation, and the agent loop. All three runtime agents use this shared framework while bringing their own tool sets.

### Audit Log

Every agent action is logged to a shared store. Schema:

```
timestamp | agent | action | target | input_summary | output_summary | correlation_id
```

Currently in-memory within the Operator. Future: move to a Pinot table for persistence and self-monitoring.

### Message Bus (future)

Currently direct HTTP calls between agents. If message volume or reliability requirements grow, introduce a lightweight message bus (Redis Streams, NATS, or a Pinot table for dogfooding).

---

## Implementation Phases

### Phase 0 — Foundations ✅

Evolved the Monitor to produce structured incidents.

- Added SQL query tool to Monitor
- Defined incident schema (`severity`, `component`, `evidence`, `suggestedAction`)
- Modified `/sweep` to return `{ report: string, incidents: Incident[] }`
- Added `/incidents` endpoint to retrieve recent incidents
- Extracted `defineTool` + agent loop into `@pinot-agents/shared`

### Phase 1 — Mitigator + Operator ✅

Built the Mitigator and Operator as separate services.

- Mitigator: `packages/mitigator`, write-capable tools, LLM-driven execution
- Operator: `packages/operator`, deterministic rules engine with circuit breaker
- Defined 5 initial runbooks (pod_crashloop, segment_offline, broker_unreachable, controller_down, high_restart_count)
- Wired up: Monitor → Operator → Mitigator → Monitor verify loop
- All three deploy as Deployments + Services in the `pinot` namespace

### Phase 2 — Self-improvement loop

Connect runtime failure data back to development.

- Operator detects novel incidents (no matching runbook) → logs them as development goals
- Use ruflo to design and implement new runbooks or tools for unhandled failure modes
- The system gradually expands its coverage of failure modes

### Phase 3 — Hardening

- Circuit breakers and rate limits on all mutation paths (circuit breaker exists, needs metrics)
- Canary deployments (deploy to a staging cluster first)
- Human review checkpoint for Mitigator actions above a severity threshold
- Prometheus metrics from all agents (request counts, latencies, incidents detected/resolved)
- Persist the audit log to a Pinot table — the system monitors itself

---

## Resolved Decisions

1. **Model selection per agent.** Each agent configures its own LLM independently via `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` env vars. The Helm chart supports per-agent overrides. Recommended: Monitor uses a cheap/fast model (GPT-4o-mini or local qwen3:32b), Mitigator uses the strongest available tool-calling model (GPT-4o, Claude Sonnet, or qwen3:235b), Operator uses no LLM (deterministic rules engine).

2. **Blast radius control.** Solved via trust levels + circuit breakers + dry-run mode. The Operator enforces a 4-level trust system (0=observe, 1=suggest, 2=approve, 3=auto-remediate) with per-runbook minimum trust levels. Mitigator defaults to `DRY_RUN=true` — all write tools simulate without executing. Circuit breakers prevent repeated remediation of the same component.

3. **Testing write operations.** Dry-run mode (`DRY_RUN=true`, default) lets the full pipeline run end-to-end without executing mutations. Integration tests validate the complete loop in dry-run. Chaos tests use manual kubectl to inject failures against a local OrbStack cluster. See `docs/testing-plan.md`.

4. **Shared state.** Keep it simple — agents communicate via HTTP only. No shared database needed yet. Audit log persistence (file or ConfigMap) is the first step toward shared state. A Pinot table for audit data is a Phase 3 goal.

5. **Human-in-the-loop.** Trust levels control human engagement. At Level 0-1, humans are always notified. At Level 2, humans must approve CRITICAL actions. At Level 3, humans are only notified on failures. Alert fatigue is managed by: deduplication windows, circuit breaker cooldowns, severity-based routing, and rate limiting (max incidents per sweep cycle). Alerting is configured via `ALERT_WEBHOOK_URL` on the Operator.

## Open Questions

1. **Autonomy graduation.** What metrics should drive automatic trust level advancement? Track success/failure per runbook and auto-advance after N consecutive successes? Or keep trust level changes as a manual operator decision?

2. **Audit persistence.** When should the audit log move from in-memory to a Pinot table? What retention policy? Should the system be able to query its own remediation history to inform future decisions?

3. **Multi-cluster.** Should the system support monitoring multiple Pinot clusters from a single deployment? Or one agent set per cluster?
