## 1. LLM runtime

- [x] 1.1 Pull the default model: `ollama pull glm-4.7-flash`; confirm it appears in `curl -s localhost:11434/api/tags`
- [x] 1.2 Smoke the model's tool-calling path with a one-shot chat completion against `http://localhost:11434/v1` (any tools-capable request returning 200)

## 2. Image

- [x] 2.1 Build the agents image: `docker build -t pinot-monitor:latest .`
- [x] 2.2 Confirm the image is visible to the cluster runtime (`docker images | grep pinot-monitor`; OrbStack shares the local daemon with its k8s)

## 3. Pinot on orbstack

- [x] 3.1 Create the namespace: `kubectl --context orbstack create namespace pinot`
- [x] 3.2 Install Apache Pinot at minimum footprint per `docs/k8s-setup.md` (release name `pinot`, one replica each controller/broker/server/zookeeper, small heaps), pinning `--kube-context orbstack`
- [x] 3.3 Wait for all Pinot pods Ready; verify controller health via port-forward (`curl /health` on :9000)

## 4. Agents on orbstack

- [x] 4.1 Install the chart: `helm --kube-context orbstack install pinot-agents k8s/helm/pinot-agents -n pinot --set operator.trustLevel=0 --set mitigator.dryRun=true` (explicit soak posture per design decision 4; LLM base URL stays at the chart default `http://host.internal:11434/v1`)
- [x] 4.2 If pods cannot reach Ollama via `host.internal`, apply the documented fallback (host gateway IP or `host.docker.internal`) via `--set global.llm.baseUrl=...` and record which was needed
- [x] 4.3 Verify all three agents Ready and answering `/health` (port-forward each service)

## 5. Pre-soak gate (spec: LLM runtime prerequisites)

- [x] 5.1 Trigger one manual sweep (`POST /sweep` via port-forward) and record wall-clock duration; PASS requires HTTP 200 with a report in under 600s — if slower, STOP and reassess model choice before unattended operation
- [x] 5.2 Confirm the sweep produced evidence: `GET /history` count ≥ 1, `GET /metrics` shows `monitor_sweeps_total` ≥ 1, Operator `GET /audit` reflects any forwarded incidents

## 6. Soak verification script

- [x] 6.1 Write `scripts/soak-check.sh` (read-only, `--context orbstack` pinned; checks per the soak-environment spec: pods Ready, three /health endpoints, sweep history advancing, audit present, metrics scrapeable on all agents, rollback log empty; exits non-zero naming the failed check)
- [x] 6.2 Run `scripts/soak-check.sh` against the live environment and confirm exit 0; gate green afterwards (`pnpm lint && pnpm typecheck && pnpm test` — script is shell, gate confirms no repo regressions)

## 7. Unattended confirmation

- [x] 7.1 Confirm the sweep CronJob exists with schedule `*/30 * * * *` and `concurrencyPolicy: Forbid`; after the next scheduled cycle fires, verify the job succeeded and `GET /history` advanced without manual action
- [x] 7.2 Re-run `scripts/soak-check.sh` post-cycle; confirm zero-write posture (empty `GET /rollback`, no `dispatch*` audit actions)
