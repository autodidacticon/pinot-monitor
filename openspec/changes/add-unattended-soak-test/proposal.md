# Proposal: add-unattended-soak-test

## Why

The agent system has never run unattended against a live cluster: no Pinot is deployed locally, no `pinot-monitor` image is built, and the default LLM model is not pulled. Host capacity is verified ample (18 CPU / 128 GB, empty `orbstack` kube context), so the missing piece is a reproducible soak environment that exercises the Monitor → Operator → Mitigator loop safely while nobody is watching.

## What Changes

- Pull the default `glm-4.7-flash` model into the local Ollama (32B-class alternatives risk the 900s sweep timeout).
- Build the `pinot-monitor:latest` image from the repo Dockerfile.
- Deploy Apache Pinot (quickstart-scale) to the `orbstack` kube context in namespace `pinot`, per `docs/k8s-setup.md`.
- Deploy the `pinot-agents` Helm chart with soak-safe values: `operator.trustLevel=0` (observe only), `mitigator.dryRun=true`, sweep CronJob every 30 minutes, LLM pointed at host Ollama.
- Verify unattended operation: all agents healthy, a full sweep completes within budget, incidents/audit/metrics accumulate, and zero write actions execute.
- Add a small soak verification script (`scripts/soak-check.sh`) so the environment can be re-audited at any time with one command.

## Capabilities

### New Capabilities
- `soak-environment`: requirements for the local unattended soak deployment — safe-by-default posture (observe-only, dry-run), sweep cadence, and the observable evidence (health, audit, metrics, zero writes) that defines "running unattended correctly".

### Modified Capabilities

None. Runtime behavior, chart defaults, and inter-agent contracts are unchanged; this change deploys and verifies what exists. (Existing specs touched for context only: `cluster-health`, `escalation-management`, `audit-observability` define the behaviors the soak run observes.)

## Non-goals

- No trust-level promotion (stays at 0) and no live remediation (dry-run stays on).
- No chaos/load/k6 testing (that remains planned in `docs/testing-plan.md`).
- No CI integration of the soak run (local-only environment).
- No changes to agent source code or the Helm chart's defaults.
- No multi-cluster support; the occupied `kind-cb-dev` context is untouched.

## Impact

- Local machine: ~6 GB Ollama model on host; Pinot + agents inside the shared OrbStack VM (~16 GB allocatable — the binding constraint, shared with the unrelated `kind-cb-dev` cluster).
- Repo: new `scripts/soak-check.sh`; new capability spec `openspec/specs/soak-environment/spec.md` (on archive).
- No source, chart, or contract changes. All kubectl/helm actions target the `orbstack` context only.
