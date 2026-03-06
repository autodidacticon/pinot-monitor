# Pinot Monitor

An AI-powered monitoring agent for Apache Pinot clusters running on Kubernetes. Uses an LLM (via Ollama) to perform intelligent health checks, diagnose issues, and produce structured reports.

Runs as an HTTP server with three endpoints:

- **`GET /health`** — Liveness probe
- **`POST /sweep`** — Stateless full cluster health sweep, returns a structured report
- **`POST /chat`** — Stateful conversational interface for interactive cluster investigation

## Architecture

The agent uses the OpenAI-compatible chat completions API (pointed at Ollama) with tool calling. Six read-only tools are available:

| Tool | Description |
|------|-------------|
| `kubectl_get` | Run read-only kubectl commands (get, describe, top, logs) against whitelisted namespaces |
| `pinot_health` | Check health/readiness of controller, broker, and server |
| `pinot_tables` | List tables or get table config |
| `pinot_segments` | Get segment info, detect ERROR/OFFLINE segments |
| `pinot_cluster_info` | Get cluster metadata and instance list |
| `pinot_debug_table` | Deep diagnostics on a specific table |

All tools are read-only. The agent cannot modify, create, or delete any resources.

## Quick Start

### Local Development

```bash
npm install --legacy-peer-deps
npm start
```

The server starts on port 3000 (configurable via `PORT` env var).

### Docker

```bash
docker build -t pinot-monitor:latest .
docker run -p 3000:3000 \
  -e OLLAMA_BASE_URL=http://host.docker.internal:11434/v1 \
  -e OLLAMA_MODEL=qwen3:32b \
  pinot-monitor:latest
```

### Kubernetes

```bash
docker build -t pinot-monitor:latest .
kubectl apply -f k8s/deploy.yaml
```

This creates:
- A Deployment (1 replica) with liveness/readiness probes
- A ClusterIP Service on port 3000
- A CronJob that curls `/sweep` every 30 minutes
- ServiceAccount + RBAC for read-only cluster access

One-shot test sweep:

```bash
kubectl -n pinot delete job pinot-monitor-test --ignore-not-found
kubectl apply -f k8s/job.yaml
kubectl -n pinot logs -f job/pinot-monitor-test
```

## API

### `GET /health`

Returns `{"ok": true}`.

### `POST /sweep`

Runs a full monitoring sweep. No request body needed.

```bash
curl -X POST http://localhost:3000/sweep
```

Returns:

```json
{"report": "═══════════════════════════════════════\n       PINOT CLUSTER HEALTH REPORT\n..."}
```

### `POST /chat`

Interactive conversation about cluster health. Supports multi-turn sessions.

```bash
# Start a new session
curl -X POST http://localhost:3000/chat \
  -H 'Content-Type: application/json' \
  -d '{"message": "Check the health of the Pinot cluster"}'

# Continue the session
curl -X POST http://localhost:3000/chat \
  -H 'Content-Type: application/json' \
  -d '{"sessionId": "<id-from-above>", "message": "Tell me more about the broker"}'
```

Returns:

```json
{
  "sessionId": "uuid",
  "response": "The broker is healthy...",
  "toolCalls": [{"name": "pinot_health", "args": {}}]
}
```

Sessions expire after 1 hour (configurable via `SESSION_TTL_MS`).

## Configuration

All settings can be overridden with environment variables.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `OLLAMA_BASE_URL` | `http://localhost:11434/v1` | Ollama API endpoint |
| `OLLAMA_MODEL` | `qwen3:32b` | Model to use |
| `AGENT_MAX_TURNS` | `15` | Max LLM turns per request |
| `SESSION_TTL_MS` | `3600000` | Chat session TTL (ms) |
| `PINOT_MONITOR_CONTROLLER_HOST` | `pinot-controller.pinot.svc.cluster.local` | Pinot controller host |
| `PINOT_MONITOR_CONTROLLER_PORT` | `9000` | Pinot controller port |
| `PINOT_MONITOR_BROKER_HOST` | `pinot-broker.pinot.svc.cluster.local` | Pinot broker host |
| `PINOT_MONITOR_BROKER_PORT` | `8099` | Pinot broker port |
| `PINOT_MONITOR_SERVER_HOST` | `pinot-server.pinot.svc.cluster.local` | Pinot server host |
| `PINOT_MONITOR_SERVER_PORT` | `80` | Pinot server admin port |

## Project Structure

```
src/
├── index.ts              # HTTP server (entry point)
├── agent.ts              # Reusable agent loop (model ↔ tools)
├── sessions.ts           # In-memory session store with TTL
├── config.ts             # Centralized config with env var overrides
├── prompts/
│   └── monitor.ts        # System prompts (sweep + chat)
└── tools/
    ├── registry.ts       # Tool definition framework (Zod → JSON Schema)
    ├── kubectl.ts        # kubectl_get tool
    └── pinot-api.ts      # Pinot API tools (health, tables, segments, etc.)
```
