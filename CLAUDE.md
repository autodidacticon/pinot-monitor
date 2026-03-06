# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pinot Monitor is an AI-powered monitoring agent for Apache Pinot clusters on Kubernetes. It exposes an HTTP server with three endpoints (`/health`, `/sweep`, `/chat`) that use an LLM (Ollama via OpenAI-compatible API) to perform health checks and diagnostics.

## Commands

```bash
npm install --legacy-peer-deps   # Install dependencies (--legacy-peer-deps required for zod v4)
npm start                        # Run dev server on port 3000 (tsx src/index.ts)
npx tsc --noEmit                 # Type-check without emitting
docker build -t pinot-monitor .  # Build container image
```

No test framework is configured. No linter is configured.

## Architecture

ES modules (`"type": "module"`), TypeScript with strict mode, target ES2022.

**Entry point:** `src/index.ts` — bare `node:http` server with three routes. Creates an OpenAI client pointed at Ollama.

**Agent loop:** `src/agent.ts` — iterative tool-calling loop. Sends messages to LLM, processes tool calls, repeats up to `maxTurns`. Returns final response + structured tool call log.

**Tool registry:** `src/tools/registry.ts` — tools self-register via `defineTool()` at import time (side-effect imports in `index.ts`). Zod schemas auto-convert to OpenAI function-calling JSON schemas.

**Tools (all read-only):**
- `src/tools/kubectl.ts` — `kubectl_get`: whitelisted subcommands (`get`, `describe`, `top`, `logs`), whitelisted namespaces, dangerous flag rejection, uses `execFile` not `exec`
- `src/tools/pinot-api.ts` — 5 tools (`pinot_health`, `pinot_tables`, `pinot_segments`, `pinot_cluster_info`, `pinot_debug_table`) hitting Pinot REST APIs with 10s timeout

**Sessions:** `src/sessions.ts` — in-memory Map with TTL (1 hour default), auto-purge every 10 minutes.

**Prompts:** `src/prompts/monitor.ts` — `MONITOR_SYSTEM_PROMPT` (structured sweep procedure) and `CHAT_SYSTEM_PROMPT` (conversational).

**Config:** `src/config.ts` — centralized config with env var overrides, helper URL builders for Pinot services.

## Key Conventions

- All tools must be **read-only** — no mutations allowed
- Tools return error strings instead of throwing
- New tools register themselves via `defineTool()` and must be imported in `index.ts` for side-effect registration
- Environment variables override all config (see `src/config.ts` for defaults)
- Uses `openai` npm package against Ollama's `/v1` endpoint (not the Anthropic SDK)

## Kubernetes

- `k8s/deploy.yaml` — Deployment, Service, RBAC (read-only ClusterRole), CronJob (sweeps every 30min)
- `k8s/job.yaml` — one-shot test Job
- Default Pinot service hostnames assume `pinot` namespace with Helm-prefixed service names
