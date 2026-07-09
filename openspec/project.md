# Project Context

## Purpose

Pinot Agent System is a multi-agent platform for autonomous monitoring and remediation of Apache Pinot clusters on Kubernetes. Its goals, in priority order:

1. **Detect real problems early.** Continuously observe cluster health (controller/broker/server availability, segments, storage, query latency, ingestion lag) and turn raw signals into structured, validated incidents.
2. **Remediate safely, not just automatically.** Known failure modes are fixed by runbooks; every write action is guarded by dry-run defaults, blast-radius limits, circuit breakers, and rollback capture. An unsafe fix is worse than no fix.
3. **Earn autonomy gradually.** A trust-level model (0=observe, 1=suggest, 2=approve, 3=auto-remediate) gates every action. The system starts as a reporter and graduates toward automation only as its track record justifies it.
4. **Keep humans in the loop where it matters.** CRITICAL actions at approval-level trust queue for explicit human sign-off; incidents with no matching runbook alert a human instead of guessing.
5. **Learn from what it could not handle.** Novel (unmatched) incidents are recorded as the input for future runbook proposals — the self-improvement loop.
6. **Stay accountable.** Every decision is audited with correlation IDs traceable across the Monitor → Operator → Mitigator → Monitor loop, and all agents expose Prometheus metrics.
7. **Run anywhere.** Any OpenAI-compatible LLM provider (Ollama locally by default; Anthropic, OpenAI, Groq, etc.), any conformant Kubernetes cluster.

### Design stance: separation of powers

- **Monitor** (LLM, read-only): observes and reports. Its tools cannot mutate anything.
- **Operator** (deterministic, no LLM): decides. Triage is a rules engine — reproducible, auditable, cheap.
- **Mitigator** (LLM, write-capable): acts. The only agent with write tools, and the most heavily guarded.

LLMs are used where judgment over ambiguous signals adds value (observation, remediation execution); decisions that must be reproducible and safe are deterministic code.

## Tech stack

- **Node 22** (`.nvmrc`), **pnpm 10** workspaces monorepo (`packages/*`), ESM everywhere
- **TypeScript** ESNext, strict + `noUncheckedIndexedAccess`, shared `tsconfig.base.json`, `tsc -b` project references, run from source via `tsx` (no build step)
- **Fastify 5** HTTP servers built by the shared `createServer()` factory (`packages/shared/src/server.ts`), request validation via **Zod 4** + `fastify-type-provider-zod`
- **openai** npm package against any OpenAI-compatible `/v1` endpoint (`LLM_BASE_URL`/`LLM_MODEL`/`LLM_API_KEY`; default `glm-4.7-flash` on Ollama)
- **Biome** (lint + format), **Vitest 4** (collocated `*.test.ts`), GitHub Actions CI
- **Kubernetes**: Helm chart (`k8s/helm/pinot-agents/`) with per-agent RBAC (read-only for Monitor/Operator, write-capable for Mitigator), sweep CronJob

## Architecture

Three services with frozen JSON contracts between them:

- Monitor (:3000) --incidents--> Operator (:3002) --dispatch--> Mitigator (:3001) --verify(chat)--> Monitor
- Tools register through `defineTool()` in `@pinot-agents/shared`; Zod schemas convert to OpenAI function-calling specs
- All state is in-memory (incident store, sessions, capped audit log, approvals); audit persistence emits structured JSON lines to stdout, with retention delegated to the deployment environment

Capabilities are specified in `openspec/specs/`:

| Capability | What it covers |
|---|---|
| `cluster-health` | Read-only observation: sweeps, chat, watch mode, tool guards |
| `incident-detection` | Incident schema, parsing, validation, storage, forwarding |
| `mitigation-execution` | Runbook matching, dispatch, write-tool guards, rollback, verification |
| `escalation-management` | Trust levels, human approvals, novel incidents, alerting, flood control |
| `audit-observability` | Audit log, correlation IDs, Prometheus metrics, rollback log |

## Conventions

- Monitor tools MUST be read-only; only the Mitigator has write-capable tools
- Tools return error strings instead of throwing
- Inter-agent response shapes are frozen contracts — changing them breaks the loop
- Zod validation at all system boundaries; env vars override all config
- Keep files under 500 lines; sentence-case headings in docs

## Non-goals (current)

- Multi-cluster support (open question in `docs/architect-todo.md`)
- Replacing human operators — the system escalates rather than guesses
- Persistence beyond in-memory + audit files (a Pinot-backed audit table is roadmap, not current)

## Roadmap (tracked in docs/architect-todo.md)

- Auto-generate runbook proposals from recurring novel incidents
- Autonomy graduation metrics (per-runbook success/failure driving trust advancement)
- Canary deployments; sweep cancellation on timeout/shutdown
- Persist audit log to a Pinot table (self-monitoring)
- Validate least-privilege Mitigator RBAC in a live cluster
