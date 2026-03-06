# Apache Pinot K8s Monitoring Agent — Implementation Plan

## Context

We need a monitoring agent for an Apache Pinot cluster on Kubernetes. Pinot is not yet deployed, so we start with a Phase 0 (deploy Pinot) followed by Phase 1 (build the monitoring agent using the Claude Agent SDK in TypeScript). Alerts go to stdout/logs only in Phase 1.

The agent runs as a single monitoring sweep per invocation, using custom MCP tools to query K8s and Pinot REST APIs, then produces a structured health report.

---

## Phase 0: Deploy Apache Pinot on K8s

- [x] **0.1** — Add Helm repo and create namespace
  ```bash
  helm repo add pinot https://raw.githubusercontent.com/apache/pinot/master/helm
  helm repo update
  kubectl create namespace pinot
  ```

- [x] **0.2** — Inspect chart values and create custom values file
  ```bash
  helm inspect values pinot/pinot > /tmp/pinot-default-values.yaml
  ```
  Created **`k8s/pinot-values.yaml`** with dev/test sizing (1 replica each, low JVM heap to fit alongside OpenClaw on the node):
  - Controller: 250m–1 CPU, 512Mi–1Gi RAM, `-Xms256M -Xmx768M`
  - Broker: 250m–1 CPU, 512Mi–1Gi RAM, `-Xms256M -Xmx768M`
  - Server: 250m–1 CPU, 512Mi–1.5Gi RAM, `-Xms256M -Xmx512M`
  - ZooKeeper: 100m–500m CPU, 256Mi–512Mi RAM
  - Storage: `local-path` StorageClass, 1–2Gi PVCs

  **Key caveat**: Helm chart key names vary by version (e.g., `controller` vs `pinotController`). We adapt the values file after inspecting the actual chart structure.

- [x] **0.3** — Install Pinot
  ```bash
  helm install pinot pinot/pinot -n pinot -f k8s/pinot-values.yaml
  ```

- [x] **0.4** — Verify deployment
  - [x] All pods Running: `pinot-controller-0`, `pinot-broker-0`, `pinot-server-0`, `pinot-zookeeper-0`
  - [x] Record actual service names: `pinot-controller:9000`, `pinot-broker:8099`, `pinot-server:80`
  - [x] Verify health endpoints via port-forward (controller, broker, server)
  - [x] Verify cluster API: `curl http://localhost:9000/cluster/info`

---

## Phase 1: Monitoring Agent (Claude Agent SDK, TypeScript)

### Project structure

```
/Users/richard/git/openclaw/pinot-monitor/
├── package.json
├── tsconfig.json
├── Dockerfile
├── src/
│   ├── index.ts              # Entry point — wires MCP server + query()
│   ├── config.ts             # Namespaces, hosts, ports, agent settings
│   ├── tools/
│   │   ├── kubectl.ts        # Read-only kubectl MCP tool
│   │   └── pinot-api.ts      # 5 Pinot REST API MCP tools
│   └── prompts/
│       └── monitor.ts        # System prompt defining monitoring procedure
└── k8s/
    └── cronjob.yaml          # K8s CronJob + RBAC (optional for Phase 1)
```

- [x] **1.1** — Initialize project
  ```bash
  mkdir -p pinot-monitor/src/{tools,prompts} pinot-monitor/k8s
  cd pinot-monitor && npm init -y
  npm install @anthropic-ai/claude-agent-sdk zod
  npm install -D typescript @types/node tsx
  ```
  Set `"type": "module"` in package.json (SDK uses ESM).

- [x] **1.2** — `src/config.ts`
  Centralized config with env var overrides. Defaults use K8s service DNS names (e.g., `pinot-controller.pinot.svc.cluster.local:9000`). Service names updated after Phase 0.4 if they differ.
  Settings: `AGENT_MODEL` (default `claude-sonnet-4-6`), `AGENT_MAX_TURNS` (15), `AGENT_MAX_BUDGET_USD` (0.50).

- [x] **1.3** — `src/tools/kubectl.ts`
  Single tool: **`kubectl_get`**
  - Whitelisted subcommands: `get`, `describe`, `top`, `logs` (Zod enum)
  - Whitelisted namespaces: `pinot`, `openclaw`, `kube-system` (Zod enum)
  - Uses `execFile` (not `exec`) to prevent shell injection
  - Secondary check rejects dangerous flags (`--force`, `-f`, `--delete`)
  - 30s timeout, 1MB output buffer
  - Annotated `readOnly: true`

- [x] **1.4** — `src/tools/pinot-api.ts`
  Five tools, all read-only, using native `fetch()`:

  | Tool | Endpoint | Purpose |
  |---|---|---|
  | `pinot_health` | `/health` on controller, broker, server | Component liveness/readiness |
  | `pinot_tables` | Controller `/tables` or `/tables/{name}` | List tables, get table config |
  | `pinot_segments` | Controller `/segments/{name}` | Detect ERROR/OFFLINE segments |
  | `pinot_cluster_info` | Controller `/cluster/info` + `/instances` | Cluster metadata and instance list |
  | `pinot_debug_table` | Controller `/debug/tables/{name}` | Deep diagnostics for problem tables |

  Shared `pinotFetch()` helper with 10s timeout and graceful error handling. `Promise.allSettled` for parallel health checks (one failure doesn't block others).

- [x] **1.5** — `src/prompts/monitor.ts`
  System prompt defining:
  1. **Role**: K8s infrastructure monitoring agent for Apache Pinot
  2. **Procedure**: Ordered check sequence — K8s pods → Pinot health → cluster info → tables → segments → deep diagnostics (only if issues found) → OpenClaw pods (secondary)
  3. **Output format**: Structured health report with sections for each component, overall status (HEALTHY/DEGRADED/CRITICAL), issues list, and recommendations
  4. **Rules**: Only use MCP tools, no mutations, report failures rather than retrying excessively

- [x] **1.6** — `src/index.ts`
  Entry point that:
  1. Creates MCP server via `createSdkMcpServer()` with all 6 tools
  2. Calls `query()` with system prompt, `permissionMode: "bypassPermissions"`, `tools: []`, `allowedTools: ["mcp__pinot-monitor__*"]`
  3. Cleans `CLAUDECODE` and `CLAUDE_CODE_ENTRYPOINT` from env to allow running inside a Claude Code session
  4. Streams messages, captures final health report text
  5. Prints run summary (duration) and the health report to stdout

- [x] **1.7** — `Dockerfile`
  `node:22-slim` base, installs kubectl, copies source, runs via `npx tsx src/index.ts`.

- [x] **1.8** — `k8s/cronjob.yaml` (optional, for later deployment)
  - CronJob running every 30 minutes
  - ServiceAccount with ClusterRole: read-only access to pods, services, logs, statefulsets across `pinot` and `openclaw` namespaces
  - Dedicated API key secret in `pinot` namespace
  - 5-minute activeDeadlineSeconds, `concurrencyPolicy: Forbid`

- [ ] **1.9** — End-to-end test
  ```bash
  cd pinot-monitor
  kubectl -n pinot port-forward svc/pinot-controller 9000:9000 &
  kubectl -n pinot port-forward svc/pinot-broker 8099:8099 &
  kubectl -n pinot port-forward svc/pinot-server 8097:80 &
  export PINOT_CONTROLLER_HOST=localhost PINOT_BROKER_HOST=localhost PINOT_SERVER_HOST=localhost
  export ANTHROPIC_API_KEY=<key-with-credits>
  npx tsx src/index.ts
  ```
  - [ ] Agent starts without errors
  - [ ] Agent calls kubectl_get and receives pod data
  - [ ] Agent calls all Pinot health/info tools successfully
  - [ ] Agent produces the structured health report to stdout
  - [ ] Run cost under $0.10, time under 2 minutes

---

## Phase 2: OpenClaw External Ollama Configuration

- [x] **2.1** — Ollama provider config
  Updated `openclaw-instance.yaml` to route requests to host-external Ollama:
  ```yaml
  models:
    providers:
      ollama:
        baseUrl: "http://host.internal:11434"   # OrbStack DNS for host Mac
        apiKey: "ollama"                          # Dummy key (required by auth store)
        api: "ollama"                             # Dedicated Ollama API type
        models:
          - id: "ollama/qwen3:32b"
            name: "qwen3:32b"
            reasoning: true
            input: ["text"]
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
            contextWindow: 131072
            maxTokens: 32768
  ```

- [x] **2.2** — Model routing
  Changed from Anthropic primary + Ollama fallback to Ollama as primary:
  ```yaml
  agents:
    defaults:
      model:
        primary: "ollama/qwen3:32b"
  ```

- [x] **2.3** — Chat completions HTTP endpoint
  Enabled the OpenAI-compatible REST endpoint on the gateway:
  ```yaml
  gateway:
    http:
      endpoints:
        chatCompletions:
          enabled: true
  ```

- [x] **2.4** — Verify external Ollama
  - [x] Gateway reaches host Ollama via `http://host.internal:11434`
  - [x] Chat completions endpoint responds at `/v1/chat/completions`
  - [x] qwen3:32b responds correctly through OpenClaw

---

## Known Risks & Lessons Learned

1. **Helm chart key names**: Chart uses `controller`, `broker`, `server`, `zookeeper` (no `pinot` prefix)
2. **Service name prefixing**: Helm created `pinot-controller`, `pinot-broker`, `pinot-server` (release name prefix)
3. **Server admin port**: Exposed as port 80 in the service, not 8097 — config.ts default updated accordingly
4. **Agent SDK nesting**: Running inside a Claude Code session requires deleting `CLAUDECODE` and `CLAUDE_CODE_ENTRYPOINT` from the child process env
5. **OpenClaw config schema**: `models.providers.ollama.models` items must be objects (with `id`, `name`, `input`, `cost`, `contextWindow`, `maxTokens`), not strings
6. **OpenClaw model fallback**: Field is `fallbacks` (array), not `secondary` (string) — the deployment plan was outdated
7. **Ollama API type**: OpenClaw has a dedicated `"ollama"` API type; `"openai-completions"` does not work
8. **Ollama auth**: Even though Ollama needs no key, OpenClaw requires `apiKey` in the provider config (any non-empty string works)
9. **Chat completions endpoint**: Disabled by default; must enable via `gateway.http.endpoints.chatCompletions.enabled: true`
10. **OpenClaw system prompt injection**: OpenClaw injects workspace files (`SOUL.md`, `AGENTS.md`, `BOOTSTRAP.md`, `IDENTITY.md`, `USER.md`) as context to every model in the fallback chain, which can cause identity confusion with non-Claude models
