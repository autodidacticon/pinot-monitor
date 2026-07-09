# Design: add-unattended-soak-test

## Context

Host capacity is verified (18 CPU / 128 GB, 91% free; 1.5 TB disk). Two kube contexts exist: `kind-cb-dev` (occupied by an unrelated Confluent stack) and `orbstack` (empty). Both share one OrbStack VM with ~16 GB allocatable memory — the binding constraint. Ollama runs on the host with `qwen3.6:35b-mlx` resident but not the repo default `glm-4.7-flash`. No Pinot is deployed and no `pinot-monitor` image exists. The agents, Helm chart, and sweep CronJob already exist and are specced; nothing here changes runtime behavior.

## Goals / Non-Goals

**Goals:**
- A reproducible local soak environment on the `orbstack` context running the full loop unattended.
- Safe-by-default posture: observe-only, dry-run, zero writes to the cluster.
- One-command re-verification (`scripts/soak-check.sh`).

**Non-Goals:**
- Trust promotion, live remediation, chaos/load testing, CI integration, chart or source changes, touching `kind-cb-dev`.

## Decisions

1. **Target the `orbstack` context, never `kind-cb-dev`.** It is empty and is the README-recommended environment; the kind cluster belongs to another project. Every `kubectl`/`helm` invocation passes `--context orbstack` / `--kube-context orbstack` explicitly rather than relying on the current context (which points at `kind-cb-dev`).
2. **Pull `glm-4.7-flash` instead of reusing the resident `qwen3.6:35b-mlx`.** Architect-todo benchmarks put 32B-class sweeps at 680-1280s against a 900s sweep timeout; glm-4.7-flash benchmarked ~41s. ~6 GB on a host with >100 GB free is cheap insurance against unattended timeouts.
3. **Pinot via the official Apache Pinot Helm chart, minimum footprint.** One replica each of controller/broker/server/zookeeper with small heaps, following `docs/k8s-setup.md`. Rationale: the VM's ~16 GB is shared with the Confluent stack; quickstart-scale Pinot (~4-6 GB requests) fits, a production-sized install does not.
4. **Agents via the repo's own `k8s/helm/pinot-agents` chart with explicit soak values.** `operator.trustLevel=0` and `mitigator.dryRun=true` are chart defaults, but the install pins them explicitly so the soak posture survives future default changes. LLM stays at the chart default `http://host.internal:11434/v1` (OrbStack's host alias), model `glm-4.7-flash`.
5. **Image delivery by local docker build.** OrbStack's cluster pulls local images directly (`imagePullPolicy: IfNotPresent`, tag `pinot-monitor:latest`); no registry needed.
6. **Verification is a script, not a one-off.** `scripts/soak-check.sh` (context-pinned, read-only) checks: pods Ready; three `/health` endpoints; latest sweep evidence (`GET /history` count advancing); audit entries present (`GET /audit`); Prometheus counters scrapeable; rollback log empty and dry-run confirmed (zero executed writes); CronJob last run succeeded. Exit non-zero on any failure so it can be cron'd or re-run after reboots.

## Risks / Trade-offs

- [VM memory pressure: ~16 GB shared with the Confluent stack] → minimum-footprint Pinot, explicit resource requests, and `soak-check.sh` surfaces pod evictions/restarts.
- [`host.internal` not resolvable from a pod] → fallback documented in tasks: use the OrbStack host gateway IP (or `host.docker.internal`) in `global.llm.baseUrl`.
- [First unattended sweep exceeds 900s if the model underperforms on cluster-sized prompts] → measure one manual `POST /sweep` before leaving it unattended; if >600s, stop and reassess model choice.
- [An empty healthy cluster yields no incidents, weakening soak signal] → acceptable: the soak validates cadence, stability, and zero-write posture; incident-path exercise stays manual (out of scope here).
- [Ollama restarts or model eviction on the host] → sweep errors are counted (`monitor_sweep_errors_total`) and visible to `soak-check.sh`; the CronJob simply retries next cycle.

## Migration Plan

Additive only. Teardown: `helm --kube-context orbstack uninstall pinot-agents -n pinot && helm --kube-context orbstack uninstall pinot -n pinot && kubectl --context orbstack delete ns pinot`. Nothing outside the `pinot` namespace on `orbstack` is created.

## Open Questions

None blocking. Model choice for a future higher-trust soak (cloud provider vs local) is deferred to the autonomy-graduation roadmap item.
