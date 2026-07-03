# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

Pinot Agent System is a multi-agent platform for autonomous monitoring and remediation of Apache Pinot clusters on Kubernetes. Three runtime agents collaborate: Monitor (observe), Operator (decide), Mitigator (act). Monitor and Mitigator are LLM-powered through any OpenAI-compatible API (Ollama by default; Anthropic, OpenAI, Groq, etc. also work); the Operator is a deterministic rules engine with no LLM. Development tasks (architecture, QC) are handled by Claude Code.

## Commands

```bash
pnpm install                     # Install dependencies
pnpm start                       # Run monitor on :3000
pnpm start:operator              # Run operator on :3002
pnpm start:mitigator             # Run mitigator on :3001
pnpm start:all                   # Run all 3 services
pnpm typecheck                   # Type-check all packages (tsc -b)
pnpm lint                        # Lint + format check (Biome)
pnpm lint:fix                    # Auto-fix lint + format (Biome)
pnpm test                        # Run unit tests (Vitest)
docker build -t pinot-monitor .  # Build container image
```

Tests run with Vitest (`pnpm test`). Lint and format use Biome (`pnpm lint`). Node 22 (`.nvmrc`); pnpm is pinned via the `packageManager` field (`corepack enable` provides it). CI (`.github/workflows/ci.yml`) runs install + lint + typecheck + test on pushes to `main` and all PRs.

## Architecture

ES modules (`"type": "module"`), TypeScript with strict mode (including `noUncheckedIndexedAccess`), target ESNext. pnpm workspaces monorepo. Shared compiler options live in `tsconfig.base.json`; each package extends it and type-checking runs through project references (`tsc -b`). Services run straight from `.ts` source via `tsx` — there is no build/emit step.

- Follow Domain-Driven Design with bounded contexts
- Keep files under 500 lines
- Use typed interfaces for all public APIs
- Prefer TDD London School (mock-first) for new code
- Use event sourcing for state changes
- Ensure input validation at system boundaries

### Packages

**`packages/shared` (`@pinot-agents/shared`):**
- `src/tools/registry.ts` — tool framework: `defineTool()`, `getToolSpecs()`, `getToolHandler()`. Zod schemas auto-convert to OpenAI function-calling JSON schemas.
- `src/server.ts` — Fastify factory (`createServer`), `runWithTimeout`, and shared error handler.
- `src/types/incident.ts` — `Incident` schema (severity, component, evidence, suggestedAction) and `IncidentReport` type.
- `src/types/messages.ts` — inter-agent message protocol types (`AgentMessage`, typed payloads for incident/dispatch/verify/audit/alert).

**`packages/monitor` (`@pinot-agents/monitor`):**
- `src/index.ts` — Fastify 5 server on :3000 built via the shared `createServer` factory. Routes: `GET /health`, `POST /sweep`, `POST /chat`, `GET /incidents`, `GET /history`, `GET /watch` (SSE, via `reply.hijack()`), `GET /metrics`. Creates an OpenAI client pointed at the configured LLM provider.
- `src/agent.ts` — iterative tool-calling loop. Sends messages to LLM, processes tool calls, repeats up to `maxTurns`.
- `src/incidents.ts` — in-memory incident store. Parses structured incidents from LLM sweep responses.
- `src/sessions.ts` — in-memory session Map with TTL (1 hour default), auto-purge every 10 minutes.
- `src/sweep-history.ts` — sweep history store backing `/history` and trend summaries.
- `src/prompts/monitor.ts` — `MONITOR_SYSTEM_PROMPT` (sweep procedure + structured incident output) and `CHAT_SYSTEM_PROMPT` (conversational).
- `src/config.ts` — centralized config with env var overrides, helper URL builders for Pinot services.
- `src/tools/kubectl.ts` — `kubectl_get` (whitelisted subcommands/namespaces, dangerous flag rejection, uses `execFile`) and `kubectl_events` (recent Warning/Error events).
- `src/tools/pinot-api.ts` — 10 tools (`pinot_health`, `pinot_tables`, `pinot_segments`, `pinot_cluster_info`, `pinot_debug_table`, `pinot_table_size`, `pinot_broker_latency`, `pinot_ingestion_status`, `pinot_query`, `pinot_server_metrics`) hitting Pinot REST APIs.

**`packages/operator` (`@pinot-agents/operator`):**
- `src/index.ts` — Fastify 5 server on :3002. Routes: `GET /health`, `POST /incident` (rate-limited), `GET /audit`, `GET /metrics`, `GET /novel-incidents`, `GET /pending-approvals`, `POST /approve/:id`, `POST /reject/:id`.
- `src/runbooks/definitions.ts` — 8 runbooks (pod_crashloop, segment_offline, broker_unreachable, controller_down, high_restart_count, query_overload, ingestion_lag, storage_pressure) with severity/component/evidence pattern matching and per-runbook `minTrustLevel`.
- `src/circuit-breaker.ts` — per-runbook/component attempt tracking with cooldown.
- `src/audit.ts` — in-memory audit log of all operator decisions; `src/audit-persistence.ts` — file-based persistence.
- `src/novel-incidents.ts` — tracks incidents that matched no runbook (self-improvement input).

**`packages/mitigator` (`@pinot-agents/mitigator`):**
- `src/index.ts` — Fastify 5 server on :3001. Routes: `GET /health`, `POST /dispatch`, `GET /rollback`, `GET /metrics`.
- `src/rollback.ts` — rollback log: before-state captures for all write operations.
- `src/tools/kubectl-write.ts` — `kubectl_delete`, `kubectl_exec`, `kubectl_get_mitigator` (with before-state capture; single-resource deletes only, selectors rejected).
- `src/tools/pinot-write.ts` — `pinot_rebalance`, `pinot_reload_segment`, `pinot_update_config`.
- `src/tools/monitor-verify.ts` — `request_monitor_verify` (calls Monitor /chat to verify fixes).

### Communication Flow

Monitor --incidents--> Operator --dispatch--> Mitigator --verify(chat)--> Monitor

### DDD Bounded Contexts (target: 5)

- Cluster Health (segment status, server availability)
- Incident Detection (anomaly detection, threshold alerting)
- Mitigation Execution (runbook runner, action sequencer)
- Escalation Management (severity routing, on-call paging)
- Audit & Observability (decision logging, mitigation history)

## Key Conventions

- Monitor tools must be **read-only** — only the Mitigator has write-capable tools
- Tools return error strings instead of throwing
- New tools register themselves via `defineTool()` (from `@pinot-agents/shared`) and must be imported in `index.ts` for side-effect registration
- Environment variables override all config (see `src/config.ts` for defaults)
- Uses `openai` npm package against any OpenAI-compatible `/v1` endpoint (Ollama, OpenAI, Groq, etc.)
- LLM provider configured via `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` env vars (legacy `OLLAMA_*` still supported)
- HTTP servers are built with Fastify 5 via `createServer()` from `@pinot-agents/shared`; request bodies are validated with Zod through `fastify-type-provider-zod`

## File Organization

- Use `packages/*/src/` for source code (monorepo workspaces)
- Unit tests are collocated with source as `packages/*/src/**/*.test.ts` (Vitest); the legacy `/tests` folder holds shell-based stress scripts only
- Use `/docs` for documentation
- Use `/config` for configuration files
- Use `/scripts` for utility scripts
- NEVER save working files or tests to the root folder

## Security

- NEVER hardcode API keys, secrets, or credentials in source files
- NEVER commit .env files or any file containing secrets
- Always validate user input at system boundaries
- Always sanitize file paths to prevent directory traversal

## Deployment

- `k8s/helm/pinot-agents/` — full Helm chart: all 3 agents (Deployments + Services), read-only RBAC for monitor and operator, write-capable RBAC for mitigator, sweep CronJob (default `*/30 * * * *`)
- `k8s/deploy.yaml` — plain manifest alternative: monitor-only Deployment, Service, read-only ClusterRole, sweep CronJob
- `k8s/job.yaml` — one-shot test Job
- Default Pinot service hostnames assume `pinot` namespace with Helm-prefixed service names
- Pinot Helm release: `pinot` in namespace `pinot`
- Default model: `glm-4.7-flash` (Ollama). Any OpenAI-compatible provider works via `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` — e.g. Anthropic's OpenAI-compatible endpoint with `claude-sonnet-5` (or `claude-haiku-4-5-20251001` for cheap/fast), OpenAI `gpt-5.1`. See README "LLM Provider" for setup per provider
- The Operator deploys with no LLM configuration — it is deterministic

## Development Rules

- ALWAYS read a file before editing it
- ALWAYS run tests after making code changes
- ALWAYS verify build succeeds before committing
- NEVER create files unless absolutely necessary — prefer editing existing files
- NEVER proactively create documentation files unless explicitly requested

## Phase Status

- **Phase 0**: COMPLETE — shared package, incident schema, SQL query tool, /incidents endpoint
- **Phase 1**: COMPLETE — Operator + Mitigator + 5 runbooks + Monitor->Operator->Mitigator->Monitor loop
- **Phase 2**: COMPLETE — Novel incident tracking, pattern deduplication
- **Phase 3**: COMPLETE — Metrics (all agents), audit persistence, human review checkpoint
- **Phase 4**: MOSTLY COMPLETE — Circuit breakers, graceful shutdown, request timeouts, rate limiting. Remaining: canary deployments
- **Phase 5 (2026-07)**: COMPLETE — Platform modernization: pnpm workspaces, shared `tsconfig.base.json` (ESNext + `noUncheckedIndexedAccess`), Biome 2.4 lint/format, Vitest 4 unit suite, Fastify 5 servers behind a shared `createServer` factory, GitHub Actions CI

See `docs/architect-todo.md` for the detailed checklist and open follow-ups.
