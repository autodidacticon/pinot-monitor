# Architect — Implementation TODO

## Phase 0 — Foundations
- [x] SQL query tool for Monitor
- [x] Incident schema (severity, component, evidence, suggestedAction)
- [x] /sweep returns structured incidents
- [x] /incidents endpoint
- [x] defineTool + agent loop in @pinot-agents/shared

## Phase 1 — Mitigator + Operator
- [x] Mitigator package with write-capable tools
- [x] Operator package with deterministic rules engine
- [x] 5 runbooks (pod_crashloop, segment_offline, broker_unreachable, controller_down, high_restart_count)
- [x] Monitor → Operator → Mitigator → Monitor verify loop
- [x] Circuit breaker per runbook/component
- [x] Trust level system (0=observe, 1=suggest, 2=approve, 3=auto-remediate)
- [x] Helm chart with Deployments + Services + RBAC

## Phase 2 — Self-improvement Loop (was Phase 3 in CLAUDE.md)
- [x] Novel incident tracking (`packages/operator/src/novel-incidents.ts`)
- [x] GET /novel-incidents endpoint
- [x] triageIncident() records novel incidents when no runbook matches
- [x] SSE /watch endpoint for real-time monitoring (continuous mini-sweeps every 60s)
- [ ] Auto-generate runbook proposals from recurring novel incidents

## Phase 3 — Historical Awareness
- [x] Sweep history persistence with /history endpoint and trend detection
- [ ] Persist audit log to Pinot table (self-monitoring)

## Phase 4 — Hardening (was Phase 3 in CLAUDE.md)
- [x] Prometheus metrics on all 3 agents (`packages/shared/src/metrics.ts`)
- [x] GET /metrics endpoint on Monitor, Operator, Mitigator
- [x] File-based audit persistence (`packages/operator/src/audit-persistence.ts`)
- [x] Human review checkpoint (GET /pending-approvals, POST /approve/:id, POST /reject/:id)
- [x] Dockerfile updated for all packages
- [x] Helm env var mismatches fixed
- [x] Circuit breakers per runbook/component (QC verified: TS-012 PASS)
- [x] Graceful shutdown (all agents)
- [x] Request timeouts (sweep 15min, chat 10min, dispatch 10min)
- [x] Rate limiting (operator 10 req/min)
- [ ] Propagate abort signal to in-flight sweeps during graceful shutdown
- [ ] Canary deployment support
- [ ] Autonomy graduation metrics (track success/failure per runbook)

## QC Test Results (latest run)
- TS-001 through TS-024: ALL PASS
- TS-011: BUG-006 operator 5s timeout — PASS
- TS-012: Circuit breaker blocks after maxRetries — PASS
- TS-013: Novel incident tracking — PASS

## Deployment
- [x] Agents running locally via npx tsx (verified healthy)
- [x] Default model changed from qwen3:32b to glm-4.7-flash (16.9x faster sweeps: 41s vs 680-1280s)
- [ ] Build Docker image on host (`docker build -t pinot-monitor:latest .`)
- [ ] Deploy all 3 agents to k8s via Helm
- [ ] Least-privilege ServiceAccount for Mitigator (RBAC exists in Helm chart, needs k8s deploy)

## Security TODO
- [ ] Create least-privilege ServiceAccount for Mitigator when deploying to k8s
  - Helm chart has ClusterRole `pinot-agents-mitigator` scoped to: pods get/list/delete, pods/exec create, read-only on apps resources
  - Currently running locally with host kubeconfig (full admin) — NOT acceptable for production
  - Consider: Namespace-scoped Role instead of ClusterRole to limit to `pinot` namespace only
- [ ] Validate RBAC is enforced after k8s deployment
- [ ] Ensure DRY_RUN=true is the default and requires explicit opt-out

## Bug Fixes
- [x] BUG-001: Monitor false-positives on OFFLINE segments in OFFLINE tables — pinot_segments now returns table type, sweep prompt instructs LLM to ignore OFFLINE segments in OFFLINE-type tables
- [x] BUG-002: Freshness check hardcoded `event_time` — sweep prompt now instructs LLM to discover time column from schema first
- [x] BUG-006: Operator HTTP call to Mitigator hangs if Mitigator is down — now uses 5s AbortController timeout, treats timeout as "accepted" (QC verified: TS-011 PASS)
- [x] BUG-007: No controller health probe at sweep start — sweep now checks controller connectivity first (step 1) and emits CRITICAL if unreachable
- [x] BUG-008: Runbook pattern fix: pod_crashloop and high_restart_count componentPattern now matches `pinot-server-0` style names (added `pinot-.*\d+` pattern)
- [x] BUG-009: matchRunbook now checks severity field (WARNING→high_restart_count, CRITICAL→pod_crashloop)

## Remaining Items
- [ ] Propagate abort signal to in-flight sweeps during graceful shutdown
- [ ] Canary deployments
- [ ] Persist audit log to Pinot table for self-monitoring
- [ ] Least-privilege ServiceAccount for mitigator in k8s

## Open Questions
- What metrics should drive automatic trust level advancement?
- When should audit log move from file-based to Pinot table?
- Should the system support multiple Pinot clusters?
