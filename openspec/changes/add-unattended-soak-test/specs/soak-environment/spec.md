# Delta: soak-environment

## ADDED Requirements

### Requirement: Soak deployments target the dedicated local context only
The soak environment SHALL be deployed exclusively to the `orbstack` Kubernetes context in the `pinot` namespace, with every `kubectl` and `helm` invocation pinning the context explicitly. Soak tooling MUST NOT read or mutate any other context.

#### Scenario: Context is pinned on every operation
- **WHEN** any soak deployment or verification command runs
- **THEN** it carries an explicit `--context orbstack` (or `--kube-context orbstack`) argument
- **AND** the `kind-cb-dev` context is never referenced

### Requirement: Safe-by-default soak posture
The soak deployment SHALL run with `operator.trustLevel=0` (observe only) and `mitigator.dryRun=true`, pinned explicitly in the install values rather than inherited from chart defaults. Under this posture the system MUST NOT execute any write action against the cluster or Pinot.

#### Scenario: Zero writes during unattended operation
- **WHEN** the soak environment has been running unattended for any duration
- **THEN** the Mitigator rollback log (`GET /rollback`) contains zero entries
- **AND** no audit entry with action `dispatch` or `dispatch_approved` exists

#### Scenario: Posture survives chart default changes
- **WHEN** the pinot-agents chart is installed for soak
- **THEN** the values explicitly set `operator.trustLevel=0` and `mitigator.dryRun=true`

### Requirement: Unattended sweep cadence
The soak environment SHALL run the sweep CronJob every 30 minutes (`*/30 * * * *`) against the Monitor, and each sweep MUST complete within the configured sweep timeout (default 900000 ms).

#### Scenario: Sweeps accumulate without intervention
- **WHEN** the environment runs unattended across multiple CronJob cycles
- **THEN** `GET /history` on the Monitor shows a sweep count that advances with each cycle
- **AND** the most recent CronJob run completed successfully

### Requirement: LLM runtime prerequisites are verified before unattended operation
The soak environment SHALL verify, before being left unattended, that the configured model (default `glm-4.7-flash`) is available in Ollama and that one manually triggered `POST /sweep` completes successfully. If the measured sweep duration exceeds 600 seconds, the environment MUST NOT be left unattended until the model choice is reassessed.

#### Scenario: Pre-soak sweep gate
- **WHEN** the environment is being commissioned
- **THEN** `ollama list` (or the tags API) shows the configured model
- **AND** one manual sweep returns HTTP 200 with a report in under 600 seconds

### Requirement: One-command re-verification
The repository SHALL provide `scripts/soak-check.sh`, a read-only, context-pinned script that exits non-zero when the soak environment is unhealthy. It MUST check: all pods in the `pinot` namespace Ready; the three agent `/health` endpoints; sweep history advancing (count at least 1 and the latest sweep recent); the Operator audit endpoint returning an entries array (which is legitimately empty on a healthy cluster with no incidents); Prometheus metrics scrapeable from all three agents; and the zero-write posture (empty rollback log and no `dispatch` audit actions).

#### Scenario: Healthy environment passes
- **WHEN** `scripts/soak-check.sh` runs against a healthy soak deployment
- **THEN** it exits 0 and prints a per-check summary

#### Scenario: Unhealthy environment fails loudly
- **WHEN** any agent is unhealthy, sweeps have stalled, or a write action has been recorded
- **THEN** the script exits non-zero naming the failed check
