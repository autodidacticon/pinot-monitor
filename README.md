# Pinot Agent System

A multi-agent platform for autonomous monitoring and remediation of Apache Pinot clusters on Kubernetes. Three agents collaborate: **Monitor** (observe), **Operator** (decide), **Mitigator** (act). All LLM-powered agents use the OpenAI-compatible chat completions API, supporting any provider (Ollama, OpenAI, Groq, Together, OpenRouter, etc.).

## Agents

| Agent | Port | Role | LLM? |
|-------|------|------|------|
| **Monitor** | 3000 | Read-only cluster observation, sweep, chat, incident detection | Yes |
| **Operator** | 3002 | Deterministic rules engine — triage, dispatch, circuit breaker, audit | No |
| **Mitigator** | 3001 | Write-capable remediation — execute runbooks, verify fixes | Yes |

**Communication flow:** Monitor → Operator → Mitigator → Monitor (verify)

## Prerequisites

### 1. Node.js

Node.js 20+ is required.

```bash
node --version  # v20.x or higher
```

### 2. Kubernetes Cluster

A running Kubernetes cluster with Apache Pinot deployed. The agents use `kubectl` to interact with the cluster and Pinot REST APIs for health checks and queries.

Supported environments:
- **OrbStack** (macOS, recommended for local dev)
- **Docker Desktop** with Kubernetes enabled
- **minikube** / **kind**
- Any cloud-managed cluster (EKS, GKE, AKS)

Verify your cluster is accessible:

```bash
kubectl get pods -n pinot
```

### 3. Apache Pinot

Pinot must be deployed in the `pinot` namespace (configurable via env vars). The default service hostnames assume a Helm-based Pinot install:

| Service | Default Hostname | Default Port |
|---------|-----------------|--------------|
| Controller | `pinot-controller.pinot.svc.cluster.local` | 9000 |
| Broker | `pinot-broker.pinot.svc.cluster.local` | 8099 |
| Server | `pinot-server.pinot.svc.cluster.local` | 80 |

Override with `PINOT_MONITOR_CONTROLLER_HOST`, `PINOT_MONITOR_BROKER_HOST`, etc.

### 4. LLM Provider

The Monitor and Mitigator require an LLM with **tool/function calling** support. Choose one:

#### Option A: Ollama (Local, Free)

Install [Ollama](https://ollama.com) and pull a model with good tool-calling support:

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull the recommended model (9B, ~6GB RAM, excellent tool calling)
ollama pull glm-4.7-flash

# Verify it's running
curl http://localhost:11434/api/tags
```

No further configuration needed — the defaults point to Ollama at `localhost:11434`.

**Alternative local models** (ranked by tool-calling quality):

| Model | Ollama ID | RAM | Notes |
|-------|-----------|-----|-------|
| GLM-4.7-Flash (recommended) | `glm-4.7-flash` | ~6 GB | Best speed/quality ratio, 3-5x faster than 32B models |
| GLM-4.7 | `glm-4.7` | ~20 GB | Best tool-calling quality among 30B models |
| Devstral Small 2 | `devstral-small-2` | ~15 GB | Mistral's agentic coding model |
| Qwen3 32B | `qwen3:32b` | ~20 GB | Good quality but slower |

#### Option B: OpenAI

```bash
export LLM_BASE_URL=https://api.openai.com/v1
export LLM_MODEL=gpt-4o
export LLM_API_KEY=sk-...
```

#### Option C: Anthropic (via OpenRouter)

```bash
export LLM_BASE_URL=https://openrouter.ai/api/v1
export LLM_MODEL=anthropic/claude-sonnet-4-20250514
export LLM_API_KEY=sk-or-...
```

#### Option D: Groq

```bash
export LLM_BASE_URL=https://api.groq.com/openai/v1
export LLM_MODEL=llama-3.3-70b-versatile
export LLM_API_KEY=gsk_...
```

#### Option E: Together

```bash
export LLM_BASE_URL=https://api.together.xyz/v1
export LLM_MODEL=meta-llama/Llama-3.3-70B-Instruct-Turbo
export LLM_API_KEY=...
```

## Quick Start

### Local Development

```bash
npm install --legacy-peer-deps
npm run start:all    # Run all 3 services
```

Or run individually:

```bash
npm start                # Monitor on :3000
npm run start:operator   # Operator on :3002
npm run start:mitigator  # Mitigator on :3001
```

Verify agents are healthy:

```bash
curl http://localhost:3000/health  # {"ok":true}
curl http://localhost:3001/health  # {"ok":true,"agent":"mitigator"}
curl http://localhost:3002/health  # {"ok":true,"agent":"operator"}
```

Trigger a sweep:

```bash
curl -X POST http://localhost:3000/sweep
```

### Docker

```bash
docker build -t pinot-monitor:latest .
docker run -p 3000:3000 -p 3001:3001 -p 3002:3002 \
  -e LLM_BASE_URL=http://host.docker.internal:11434/v1 \
  pinot-monitor:latest
```

### Kubernetes (Helm)

The recommended deployment method for Kubernetes is the Helm chart at `k8s/helm/pinot-agents/`.

#### 1. Build and load the container image

```bash
docker build -t pinot-monitor:latest .

# For OrbStack — image is automatically available in the cluster
# For minikube:
#   minikube image load pinot-monitor:latest
# For kind:
#   kind load docker-image pinot-monitor:latest
```

#### 2. Configure values

Edit `k8s/helm/pinot-agents/values.yaml` or pass overrides:

```yaml
global:
  llm:
    baseUrl: "http://host.internal:11434/v1"  # Ollama from inside k8s
    model: "glm-4.7-flash"
    apiKey: "ollama"
  pinot:
    controllerHost: "pinot-controller.pinot.svc.cluster.local"
    controllerPort: 9000
    brokerHost: "pinot-broker.pinot.svc.cluster.local"
    brokerPort: 8099

operator:
  trustLevel: 0   # 0=observe, 1=suggest, 2=approve, 3=auto-remediate

mitigator:
  dryRun: true    # true=simulate writes, false=execute writes

sweep:
  enabled: true
  schedule: "*/30 * * * *"  # Every 30 minutes
```

Key settings to review:
- **`global.llm.baseUrl`**: Must be reachable from inside the cluster. For Ollama on the host, use `http://host.internal:11434/v1` (OrbStack) or `http://host.docker.internal:11434/v1` (Docker Desktop).
- **`operator.trustLevel`**: Start at `0` (observe only) and increase as confidence grows.
- **`mitigator.dryRun`**: Keep `true` until you're ready for live remediation.

#### 3. Install the chart

```bash
helm install pinot-agents k8s/helm/pinot-agents -n pinot --create-namespace
```

#### 4. Verify the deployment

```bash
# Check pods are running
kubectl get pods -n pinot -l app.kubernetes.io/name=pinot-agents

# Check agent health
kubectl port-forward -n pinot svc/pinot-agents-monitor 3000:3000 &
curl http://localhost:3000/health

# View operator audit log
kubectl port-forward -n pinot svc/pinot-agents-operator 3002:3002 &
curl http://localhost:3002/audit
```

#### 5. Upgrade or uninstall

```bash
# Upgrade after code changes (rebuild image first)
helm upgrade pinot-agents k8s/helm/pinot-agents -n pinot

# Uninstall
helm uninstall pinot-agents -n pinot
```

#### Helm chart components

The chart deploys:
- **Monitor** — Deployment + ClusterIP Service + read-only RBAC (ServiceAccount + ClusterRole + ClusterRoleBinding)
- **Operator** — Deployment + ClusterIP Service + ServiceAccount
- **Mitigator** — Deployment + ClusterIP Service + write-capable RBAC
- **CronJob** — triggers `/sweep` on the monitor at the configured interval

### Kubernetes (plain manifests)

For a simpler single-agent deployment without Helm:

```bash
kubectl apply -f k8s/deploy.yaml
```

This creates a Monitor-only deployment with read-only RBAC and a sweep CronJob.

## LLM Provider Configuration

All agents use the same env vars. Set per-agent by configuring each service's environment independently.

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_BASE_URL` | `http://localhost:11434/v1` | OpenAI-compatible API endpoint |
| `LLM_MODEL` | `glm-4.7-flash` | Model identifier |
| `LLM_API_KEY` | `ollama` | API key (required for cloud providers) |

The legacy `OLLAMA_BASE_URL` and `OLLAMA_MODEL` env vars are still supported as fallbacks.

### Per-Agent Model Selection

Each agent can use a different model. In Kubernetes, set env vars per container. In the Helm chart, use the per-agent `llm` override:

```yaml
monitor:
  llm:
    model: "gpt-4o-mini"     # Fast, cheap for observation
mitigator:
  llm:
    model: "gpt-4o"          # Strong tool-calling for remediation
```

## Monitor API

### `GET /health`
Returns `{"ok": true}`.

### `POST /sweep`
Runs a full monitoring sweep — checks controller health, k8s events, pod status, segments, storage, query latency, and data freshness.

```bash
curl -X POST http://localhost:3000/sweep
```

### `POST /chat`
Interactive conversation about cluster health. Supports multi-turn sessions.

```bash
curl -X POST http://localhost:3000/chat \
  -H 'Content-Type: application/json' \
  -d '{"message": "Check the health of the Pinot cluster"}'
```

### `GET /incidents`
Retrieve detected incidents. Optional `?severity=CRITICAL|WARNING|INFO` filter.

### `GET /watch`
Server-Sent Events endpoint for real-time monitoring. Streams sweep results at a configurable interval (default 60s).

```bash
curl -N http://localhost:3000/watch
```

### `GET /history`
Retrieve past sweep results. Optional `?hours=N` parameter (default 24h).

## Operator API

### `POST /incident`
Submit incidents for triage. Rate-limited to 10 requests/minute.

### `GET /audit`
View the operator's decision audit log.

### `GET /novel-incidents`
View incidents that didn't match any runbook.

### `GET /pending-approvals`
View incidents queued for human approval (trust level 2 + CRITICAL severity).

### `POST /approve/:id` / `POST /reject/:id`
Approve or reject pending remediations.

### `GET /metrics`
Prometheus-format metrics.

## Mitigator API

### `POST /dispatch`
Receive remediation dispatches from the operator.

### `GET /rollback`
View the rollback log — before-state captures and undo actions for all write operations.

### `GET /metrics`
Prometheus-format metrics.

## Monitor Tools

| Tool | Description |
|------|-------------|
| `kubectl_get` | Run read-only kubectl commands against whitelisted namespaces |
| `kubectl_events` | Get recent k8s Warning/Error events (OOMKills, evictions, probe failures) |
| `pinot_health` | Check health/readiness of controller, broker, and server |
| `pinot_tables` | List tables or get table config |
| `pinot_segments` | Get segment info with table type context |
| `pinot_cluster_info` | Get cluster metadata and instance list |
| `pinot_debug_table` | Deep diagnostics on a specific table |
| `pinot_query` | Execute read-only SQL queries via broker |
| `pinot_table_size` | Get storage size per table with threshold alerts |
| `pinot_broker_latency` | Probe query latency across tables |

## Runbooks

| Runbook | Trigger | Trust Level | Action |
|---------|---------|-------------|--------|
| `pod_crashloop` | CrashLoopBackOff, high restarts (CRITICAL) | 2 (approve) | Delete pod for restart |
| `segment_offline` | OFFLINE/ERROR segments (WARNING+) | 3 (auto) | Reload segment |
| `broker_unreachable` | Broker timeout/connection refused (CRITICAL) | 2 (approve) | Restart broker pod |
| `controller_down` | Controller unreachable (CRITICAL) | 3 (auto) | Restart controller pod |
| `high_restart_count` | Elevated restart count (WARNING) | 1 (suggest) | Describe pod for diagnostics |
| `storage_pressure` | High storage/quota usage (WARNING+) | 2 (approve) | Rebalance table |
| `query_overload` | High query latency (WARNING+) | 1 (suggest) | Describe broker for diagnostics |

## Trust Levels

| Level | Mode | Behavior |
|-------|------|----------|
| 0 | Observe | Log only, no actions |
| 1 | Suggest | Alert humans with suggested action |
| 2 | Approve | Queue CRITICAL actions for human approval |
| 3 | Auto-remediate | Execute matching runbooks automatically |

## Safety Controls

- **DRY_RUN mode** (default: enabled) — all mitigator write tools simulate without executing
- **Circuit breakers** — per-runbook/component retry limits with cooldown periods
- **Blast radius controls** — max 2 concurrent remediations, single-pod delete only (no wildcards/selectors)
- **Rollback log** — before-state captured for all write operations
- **Rate limiting** — operator rejects incident floods (10 req/min default)
- **Input validation** — Zod schema validation on all incident data at system boundaries
- **Request timeouts** — sweep (15min), chat (10min), dispatch (10min)
- **Graceful shutdown** — drains in-flight requests on SIGTERM

## Other Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` / `3001` / `3002` | HTTP server port (per agent) |
| `AGENT_MAX_TURNS` | `25` (monitor) / `10` (mitigator) | Max LLM turns per request |
| `SESSION_TTL_MS` | `3600000` | Chat session TTL in ms (monitor only) |
| `TRUST_LEVEL` | `0` | Operator trust level (0-3) |
| `DRY_RUN` | `true` | Mitigator dry-run mode |
| `MAX_CONCURRENT_REMEDIATIONS` | `2` | Max simultaneous remediations |
| `RATE_LIMIT_MAX` | `10` | Max incidents per rate-limit window |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window duration |
| `WATCH_INTERVAL_MS` | `60000` | SSE watch sweep interval |
| `SWEEP_TIMEOUT_MS` | `900000` | Sweep request timeout |
| `CHAT_TIMEOUT_MS` | `600000` | Chat request timeout |
| `DISPATCH_TIMEOUT_MS` | `600000` | Mitigator dispatch timeout |
| `SHUTDOWN_TIMEOUT_MS` | `30000` | Graceful shutdown timeout |
| `OPERATOR_URL` | `http://localhost:3002` | Operator service URL |
| `MONITOR_URL` | `http://localhost:3000` | Monitor service URL |
| `ALERT_WEBHOOK_URL` | _(empty)_ | Webhook for operator alerts |
| `PINOT_MONITOR_CONTROLLER_HOST` | `pinot-controller.pinot.svc.cluster.local` | Pinot controller host |
| `PINOT_MONITOR_CONTROLLER_PORT` | `9000` | Pinot controller port |
| `PINOT_MONITOR_BROKER_HOST` | `pinot-broker.pinot.svc.cluster.local` | Pinot broker host |
| `PINOT_MONITOR_BROKER_PORT` | `8099` | Pinot broker port |

## Project Structure

```
packages/
├── shared/          # Tool framework, incident schema, metrics, lifecycle utilities
├── monitor/         # Read-only observer agent (11 tools)
├── operator/        # Deterministic rules engine (7 runbooks)
└── mitigator/       # Write-capable remediation agent (rollback, blast radius)
k8s/
├── deploy.yaml      # Plain manifest (monitor-only)
├── job.yaml         # One-shot test Job
└── helm/
    └── pinot-agents/  # Full Helm chart (all 3 agents + RBAC + CronJob)
docs/
├── test-scenarios.md          # 40 QC test scenarios with results
├── architect-todo.md          # Implementation progress
└── operational-best-practices.md  # Ops research and gap analysis
```
