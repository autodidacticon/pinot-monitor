# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

Pinot Agent System is a multi-agent platform for autonomous monitoring and remediation of Apache Pinot clusters on Kubernetes. Three runtime agents collaborate: Monitor (observe), Operator (decide), Mitigator (act). All use Ollama via OpenAI-compatible API. Development tasks (architecture, QC) are handled by Claude Code.

## Commands

```bash
npm install --legacy-peer-deps   # Install dependencies (--legacy-peer-deps required for zod v4)
npm start                        # Run monitor on :3000
npm run start:operator           # Run operator on :3002
npm run start:mitigator          # Run mitigator on :3001
npm run start:all                # Run all 3 services
npm run typecheck                # Type-check all packages (tsc -b)
docker build -t pinot-monitor .  # Build container image
```

No test framework is configured. No linter is configured.

## Architecture

ES modules (`"type": "module"`), TypeScript with strict mode, target ES2022. npm workspaces monorepo.

- Follow Domain-Driven Design with bounded contexts
- Keep files under 500 lines
- Use typed interfaces for all public APIs
- Prefer TDD London School (mock-first) for new code
- Use event sourcing for state changes
- Ensure input validation at system boundaries

### Packages

**`packages/shared` (`@pinot-agents/shared`):**
- `src/tools/registry.ts` — tool framework: `defineTool()`, `getToolSpecs()`, `getToolHandler()`. Zod schemas auto-convert to OpenAI function-calling JSON schemas.
- `src/types/incident.ts` — `Incident` schema (severity, component, evidence, suggestedAction) and `IncidentReport` type.
- `src/types/messages.ts` — inter-agent message protocol types (`AgentMessage`, typed payloads for incident/dispatch/verify/audit/alert).

**`packages/monitor` (`@pinot-agents/monitor`):**
- `src/index.ts` — bare `node:http` server with four routes (`/health`, `/sweep`, `/chat`, `/incidents`). Creates an OpenAI client pointed at Ollama.
- `src/agent.ts` — iterative tool-calling loop. Sends messages to LLM, processes tool calls, repeats up to `maxTurns`.
- `src/incidents.ts` — in-memory incident store. Parses structured incidents from LLM sweep responses.
- `src/sessions.ts` — in-memory session Map with TTL (1 hour default), auto-purge every 10 minutes.
- `src/prompts/monitor.ts` — `MONITOR_SYSTEM_PROMPT` (sweep procedure + structured incident output) and `CHAT_SYSTEM_PROMPT` (conversational).
- `src/config.ts` — centralized config with env var overrides, helper URL builders for Pinot services.
- `src/tools/kubectl.ts` — `kubectl_get`: whitelisted subcommands, namespaces, dangerous flag rejection, uses `execFile`.
- `src/tools/pinot-api.ts` — 6 tools (`pinot_health`, `pinot_tables`, `pinot_segments`, `pinot_cluster_info`, `pinot_debug_table`, `pinot_query`) hitting Pinot REST APIs.

**`packages/operator` (`@pinot-agents/operator`):**
- `src/index.ts` — HTTP server on :3002. Routes: `/health`, `POST /incident`, `GET /audit`.
- `src/runbooks/definitions.ts` — 5 runbooks (pod_crashloop, segment_offline, broker_unreachable, controller_down, high_restart_count) with pattern matching.
- `src/circuit-breaker.ts` — per-runbook/component attempt tracking with cooldown.
- `src/audit.ts` — in-memory audit log of all operator decisions.

**`packages/mitigator` (`@pinot-agents/mitigator`):**
- `src/index.ts` — HTTP server on :3001. Routes: `/health`, `POST /dispatch`.
- `src/tools/kubectl-write.ts` — `kubectl_delete`, `kubectl_exec`, `kubectl_get_mitigator` (with before-state capture).
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

## File Organization

- Use `packages/*/src/` for source code (monorepo workspaces)
- Use `/tests` for test files
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

- `k8s/deploy.yaml` — Deployment, Service, RBAC (read-only ClusterRole), CronJob (sweeps every 30min)
- `k8s/job.yaml` — one-shot test Job
- Default Pinot service hostnames assume `pinot` namespace with Helm-prefixed service names
- Helm release: `pinot` in namespace `pinot`
- Default model: `glm-4.7-flash` (Ollama), also available: `qwen3:32b`, `qwen3:235b-a22b`
- Supports any OpenAI-compatible provider via `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`

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
