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
- [x] 5 runbooks (pod_crashloop, segment_offline, broker_unreachable, controller_down, high_restart_count) — since grown to 8 (+ query_overload, ingestion_lag, storage_pressure)
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
- [ ] Propagate cancellation to in-flight sweeps on timeout/shutdown (`runWithTimeout` races a timer but does not cancel the underlying work; the old AbortSignal plumbing was removed in the Fastify migration)
- [ ] Canary deployment support
- [ ] Autonomy graduation metrics (track success/failure per runbook)

## Phase 5 — Platform modernization (2026-07)
- [x] Migrate npm → pnpm workspaces (pnpm@10.28.2, `workspace:*` deps, removes `--legacy-peer-deps`)
- [x] Shared `tsconfig.base.json` — ESNext, strict + `noUncheckedIndexedAccess`/`noImplicitOverride`/`noFallthroughCasesInSwitch`; packages extend it, `tsc -b` project references kept
- [x] Biome 2.4 as single lint + format tool; repo-wide reformat
- [x] Vitest 4 unit suite (34 tests: registry, incidents, circuit breaker, rate limiter, runbooks, kubectl guard, server factory)
- [x] Fastify 5 migration: shared `createServer()` factory in `@pinot-agents/shared` (Zod validation via fastify-type-provider-zod, shared error handler, 404 handler, `runWithTimeout`); all 3 servers migrated with response contracts preserved (SSE `/watch` via `reply.hijack()`)
- [x] GitHub Actions CI (`.github/workflows/ci.yml`): install + Biome + typecheck + Vitest on Node 22
- [x] Repo hygiene: gitignore/untrack `dist` + `*.tsbuildinfo`, `.nvmrc` 22, `@types/node` aligned to 22
- [x] CLAUDE.md + README refreshed (pnpm commands, current model examples, verified tool/runbook/route counts)

### Modernization follow-ups
- [ ] Strengthen `definitions.test.ts` severity-gate assertion (`expect(rb).toBeUndefined()` instead of `rb?.id !== 'pod_crashloop'`)
- [ ] Exercise the 504 `HandlerTimeoutError` path through a real Fastify route in tests
- [ ] Unit tests for mitigator `GET /rollback` and `GET /metrics` (currently smoke-tested only)
- [ ] Suppress the 13 intentional `noTemplateCurlyInString` warnings on runbook `${pod}`/`${table}` placeholder strings (scoped `biome-ignore` or a Biome override)
- [ ] Helm templates still launch via `npm start` / `npm run start:*` — works because the image runs `corepack enable`, but switch to `pnpm` for coherence with the Dockerfile CMD
- [ ] `k8s/deploy.yaml` still sets legacy `OLLAMA_BASE_URL`/`OLLAMA_MODEL` env vars — switch to `LLM_*` (legacy fallback still supported)
- [ ] Runbook action arg names (`table`, `segment`, `selector`) don't match the mitigator tool schemas (`tableName`, `segmentName`; `kubectl_delete` rejects selectors) — they act as LLM hints today; align them
- [ ] Consider pinning an exact Node patch across `.nvmrc`/Dockerfile (currently floating 22.x)
- [ ] Historical docs (`docs/testing-plan.md`, `docs/k8s-setup.md`, `EVOLUTION.md`, `pinot-monitor-plan.md`) still reference npm/`--legacy-peer-deps`/qwen3 defaults/`withTimeout` — annotate or refresh if they're still load-bearing

## QC Test Results (latest run)
- TS-001 through TS-024: ALL PASS
- TS-011: BUG-006 operator 5s timeout — PASS
- TS-012: Circuit breaker blocks after maxRetries — PASS
- TS-013: Novel incident tracking — PASS

## Deployment
- [x] Agents running locally (now `pnpm start` / `pnpm start:all` — tsx under the hood; verified healthy post-Fastify migration)
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
- [ ] Propagate cancellation to in-flight sweeps on timeout/shutdown (see Phase 4 note)
- [ ] Canary deployments
- [ ] Persist audit log to Pinot table for self-monitoring
- [ ] Least-privilege ServiceAccount for mitigator in k8s

## Open Questions
- What metrics should drive automatic trust level advancement?
- When should audit log move from file-based to Pinot table?
- Should the system support multiple Pinot clusters?
