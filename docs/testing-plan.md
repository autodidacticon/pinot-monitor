# Pinot Agent System — Integration & Load Test Plan

## Table of Contents

1. [Test Infrastructure Setup](#test-infrastructure-setup)
2. [Integration Tests](#integration-tests)
3. [Load Tests](#load-tests)
4. [Chaos Tests](#chaos-tests)
5. [Test Data & Fixtures](#test-data--fixtures)
6. [CI/CD Integration](#cicd-integration)

---

## Test Infrastructure Setup

### Framework Selection

| Category | Tool | Rationale |
|----------|------|-----------|
| Integration tests | **Vitest** | Native ESM + TypeScript, fast, compatible with the project's build setup |
| Load tests | **k6** | Scriptable in JS, produces structured metrics, good for HTTP endpoint testing |
| Chaos tests | **Manual kubectl + shell scripts** | Lightweight, no cluster-level operator required for local OrbStack |

### Installation

```bash
# Vitest (integration + unit tests)
npm install -D vitest @vitest/coverage-v8 --legacy-peer-deps

# k6 (load tests — installed globally via brew)
brew install k6
```

### Directory Structure

```
tests/
  integration/
    health.test.ts          # Agent health checks
    monitor-sweep.test.ts   # Monitor sweep + incident output
    operator-triage.test.ts # Runbook matching, trust levels, circuit breaker
    mitigator-dry.test.ts   # Mitigator dry-run dispatch
    e2e-loop.test.ts        # Full detection-triage-remediation-verification loop
    trust-matrix.test.ts    # Trust level x runbook matrix
    circuit-breaker.test.ts # Circuit breaker trip behavior
  load/
    monitor-sweep.k6.js     # Concurrent sweep load
    operator-flood.k6.js    # Operator throughput
    llm-latency.k6.js       # LLM per-turn latency profiling
  chaos/
    pod-kill.sh             # Delete Pinot pod, observe loop
    agent-failure.sh        # Kill one agent process
    llm-unavailable.sh      # Stop Ollama, verify graceful degradation
  fixtures/
    incidents.ts            # Canned incident payloads
    dispatch.ts             # Canned dispatch payloads
  helpers/
    agent-client.ts         # HTTP helper wrapping fetch for all 3 agents
    wait.ts                 # Polling/retry utilities
```

### Vitest Configuration

Add to `package.json` (root):

```json
{
  "scripts": {
    "test": "vitest run",
    "test:integration": "vitest run --dir tests/integration",
    "test:watch": "vitest"
  }
}
```

Create `vitest.config.ts` at the project root:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 60_000, // LLM calls can be slow
    hookTimeout: 30_000,
    globals: true,
  },
});
```

### Prerequisites for Running Tests

- All 3 agents running (`npm run start:all`) or started in `beforeAll`
- A Pinot cluster accessible (OrbStack / kind / minikube with Helm release `pinot` in namespace `pinot`)
- Ollama running at `localhost:11434` with `qwen3:32b` loaded (for LLM-dependent tests)
- `DRY_RUN=true` for Mitigator (default)

---

## Integration Tests

### 1. Agent Health Checks

**File:** `tests/integration/health.test.ts`

**Purpose:** Verify all 3 agents are reachable and report healthy.

| # | Test Case | Method | Expected |
|---|-----------|--------|----------|
| 1.1 | Monitor health | `GET :3000/health` | 200, body contains `"ok"` |
| 1.2 | Mitigator health | `GET :3001/health` | 200, body contains `"ok"` |
| 1.3 | Operator health | `GET :3002/health` | 200, body contains `"ok"` |

```ts
// Pseudocode
describe('Agent Health Checks', () => {
  it.each([
    ['Monitor', 3000],
    ['Mitigator', 3001],
    ['Operator', 3002],
  ])('%s responds healthy on port %d', async (name, port) => {
    const res = await fetch(`http://localhost:${port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });
});
```

---

### 2. Monitor Sweep

**File:** `tests/integration/monitor-sweep.test.ts`

**Purpose:** Trigger a sweep and verify structured incident output.

| # | Test Case | Expected |
|---|-----------|----------|
| 2.1 | Sweep returns 200 | `POST :3000/sweep` returns 200 |
| 2.2 | Incidents are structured | Each incident has `severity`, `component`, `evidence`, `suggestedAction` |
| 2.3 | Incidents appear on GET /incidents | `GET :3000/incidents` returns array including sweep results |
| 2.4 | Sweep with healthy cluster | Returns empty incidents or "all clear" message |

**Notes:**
- This test depends on the real Pinot cluster state. For deterministic results, seed a known failure first (see E2E loop) or assert on schema shape only.
- Timeout should be generous (60s+) because the LLM is in the loop.

---

### 3. Operator Triage

**File:** `tests/integration/operator-triage.test.ts`

**Purpose:** Verify runbook matching, trust level enforcement, and dispatch behavior.

| # | Test Case | Payload | Expected |
|---|-----------|---------|----------|
| 3.1 | Pod crashloop matches runbook | `{ severity: "critical", component: "pinot-server-0", evidence: "CrashLoopBackOff, 5 restarts" }` | Response includes `runbook: "pod_crashloop"` |
| 3.2 | Segment offline matches runbook | `{ severity: "high", component: "myTable", evidence: "segment seg_0 OFFLINE" }` | `runbook: "segment_offline"` |
| 3.3 | Broker unreachable | `{ severity: "critical", component: "pinot-broker-0", evidence: "connection refused" }` | `runbook: "broker_unreachable"` |
| 3.4 | Controller down | `{ severity: "critical", component: "pinot-controller-0", evidence: "not ready" }` | `runbook: "controller_down"` |
| 3.5 | High restart count | `{ severity: "medium", component: "pinot-server-1", evidence: "restartCount: 8" }` | `runbook: "high_restart_count"` |
| 3.6 | No matching runbook | `{ severity: "low", component: "unknown", evidence: "disk 80%" }` | Response indicates no runbook matched, incident logged |
| 3.7 | Audit trail | After triage | `GET :3002/audit` includes the decision |

---

### 4. Mitigator Dry-Run

**File:** `tests/integration/mitigator-dry.test.ts`

**Purpose:** Verify dry-run mode returns simulated results without executing real commands.

| # | Test Case | Expected |
|---|-----------|----------|
| 4.1 | Dispatch returns 200 | `POST :3001/dispatch` with a valid payload returns 200 |
| 4.2 | Dry-run flag in response | Response body indicates `dryRun: true` or includes "[DRY RUN]" |
| 4.3 | No actual kubectl writes | No pods are deleted/restarted (verify via `kubectl get pods` before/after) |
| 4.4 | LLM tool calls are logged | Response includes the tool calls the LLM wanted to make |

**Payload fixture:**

```json
{
  "runbook": "pod_crashloop",
  "component": "pinot-server-0",
  "namespace": "pinot",
  "evidence": "CrashLoopBackOff, 5 restarts in 10 minutes",
  "trustLevel": 3
}
```

---

### 5. End-to-End Loop

**File:** `tests/integration/e2e-loop.test.ts`

**Purpose:** Inject a known failure, verify the full Monitor -> Operator -> Mitigator -> Monitor loop.

**Preconditions:**
- Pinot cluster healthy
- All 3 agents running
- `DRY_RUN=true` on Mitigator

**Steps:**

1. Record baseline: `kubectl get pods -n pinot`
2. Inject failure: `kubectl delete pod pinot-server-0 -n pinot` (pod will restart via StatefulSet)
3. Trigger sweep: `POST :3000/sweep`
4. Assert: Monitor returns an incident referencing `pinot-server-0`
5. Forward incident to Operator: `POST :3002/incident` with the incident payload
6. Assert: Operator matches a runbook and returns a dispatch payload
7. Forward dispatch to Mitigator: `POST :3001/dispatch` with the dispatch payload
8. Assert: Mitigator returns dry-run remediation result
9. Verify: `POST :3000/chat` asking "Is pinot-server-0 healthy?" — expect affirmative (pod will have restarted by now via StatefulSet)
10. Verify audit: `GET :3002/audit` includes the full chain

**Timeout:** 120 seconds (LLM calls + pod restart time).

**Note:** Steps 5-8 simulate what the Operator would do automatically at higher trust levels. At trust level 0-1, the Operator only observes/suggests. The test manually drives each step to validate the interfaces.

---

### 6. Trust Level Matrix

**File:** `tests/integration/trust-matrix.test.ts`

**Purpose:** Test all 4 trust levels with each runbook to verify correct behavior.

| Trust Level | Behavior | Operator Response |
|-------------|----------|-------------------|
| 0 — Observe | Log only, no action | `action: "observe"`, no dispatch |
| 1 — Suggest | Log + suggest remediation | `action: "suggest"`, includes recommended steps, no dispatch |
| 2 — Approve | Log + suggest + request human approval | `action: "approve"`, dispatch payload included but flagged `requiresApproval: true` |
| 3 — Auto | Full autonomous dispatch | `action: "auto"`, dispatch sent to Mitigator |

**Matrix (20 test cases):**

```
Runbooks (5) x Trust Levels (4) = 20 combinations
```

Each combination sends a matching incident to the Operator with the given trust level and asserts the response `action` field and whether a dispatch was issued.

```ts
const runbooks = [
  'pod_crashloop',
  'segment_offline',
  'broker_unreachable',
  'controller_down',
  'high_restart_count',
];
const trustLevels = [0, 1, 2, 3];

describe('Trust Level Matrix', () => {
  for (const runbook of runbooks) {
    for (const trust of trustLevels) {
      it(`${runbook} at trust=${trust}`, async () => {
        const res = await postIncident(fixtureFor(runbook), trust);
        assertTrustBehavior(res, trust);
      });
    }
  }
});
```

---

### 7. Circuit Breaker

**File:** `tests/integration/circuit-breaker.test.ts`

**Purpose:** Verify the circuit breaker trips after repeated identical incidents.

| # | Test Case | Expected |
|---|-----------|----------|
| 7.1 | First attempt succeeds | Operator returns dispatch (at trust=3) |
| 7.2 | Rapid repeat attempts | Each returns dispatch until maxRetries reached |
| 7.3 | Circuit trips | After maxRetries, Operator returns `circuitOpen: true`, no dispatch |
| 7.4 | Cooldown expires | After cooldown period, circuit closes and dispatch resumes |
| 7.5 | Different component unaffected | Same runbook but different component still dispatches |

**Approach:**
- Send the same incident (same runbook + component) N+1 times in rapid succession where N = maxRetries
- Assert first N return dispatch, N+1 returns circuit open
- Wait for cooldown (or mock time), retry, assert it succeeds

---

## Load Tests

All load tests use **k6** and output structured JSON metrics.

### 1. Monitor Sweep Under Load

**File:** `tests/load/monitor-sweep.k6.js`

**Purpose:** Measure sweep latency under concurrent load.

```js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    concurrent_sweeps: {
      executor: 'constant-vus',
      vus: 5,
      duration: '2m',
    },
    ramp_up: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '1m', target: 10 },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<30000'], // 30s p95 (LLM in the loop)
    http_req_failed: ['rate<0.1'],       // <10% failure rate
  },
};

export default function () {
  const res = http.post('http://localhost:3000/sweep');
  check(res, { 'sweep 200': (r) => r.status === 200 });
  sleep(1);
}
```

**Metrics to collect:**
- p50, p95, p99 latency
- Requests per second
- Error rate
- LLM token throughput (from agent logs)

---

### 2. Operator Throughput

**File:** `tests/load/operator-flood.k6.js`

**Purpose:** Flood the Operator with incidents, measure triage latency and verify no crashes.

```js
export const options = {
  scenarios: {
    flood: {
      executor: 'constant-arrival-rate',
      rate: 100,          // 100 incidents/sec
      timeUnit: '1s',
      duration: '1m',
      preAllocatedVUs: 50,
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'], // Operator is deterministic, should be fast
    http_req_failed: ['rate<0.01'],
  },
};
```

**Key assertions:**
- p95 triage latency < 500ms (no LLM involved)
- Zero dropped incidents
- Circuit breaker activates correctly under flood of identical incidents
- Audit log grows without memory issues (monitor RSS via `/health` or process metrics)

---

### 3. LLM Latency Profiling

**File:** `tests/load/llm-latency.k6.js`

**Purpose:** Profile per-turn LLM latency for Monitor and Mitigator across providers.

**Scenarios:**

| Scenario | Agent | Provider | Model |
|----------|-------|----------|-------|
| A | Monitor /chat | Ollama local | qwen3:32b |
| B | Monitor /chat | Ollama local | qwen3:235b-a22b |
| C | Mitigator /dispatch | Ollama local | qwen3:32b |

```js
export const options = {
  scenarios: {
    monitor_chat_32b: {
      executor: 'per-vu-iterations',
      vus: 3,
      iterations: 10,
      env: { TARGET: 'http://localhost:3000/chat', MODEL: 'qwen3:32b' },
    },
  },
  thresholds: {
    'http_req_duration{scenario:monitor_chat_32b}': ['p(95)<60000'],
  },
};
```

**Metrics to collect:**
- Time-to-first-token (if streaming is added)
- Total turn latency
- Tokens per second (from Ollama metrics at `:11434/api/tags`)
- Memory usage on Ollama host during concurrent requests

---

## Chaos Tests

Chaos tests are shell scripts run manually or via CI. They require a running Kubernetes cluster.

### 1. Pod Kill

**File:** `tests/chaos/pod-kill.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="pinot"
POD="pinot-server-0"

echo "=== Chaos: Pod Kill ==="
echo "Deleting pod $POD in namespace $NAMESPACE..."
kubectl delete pod "$POD" -n "$NAMESPACE" --grace-period=0

echo "Waiting 10s for Monitor to detect..."
sleep 10

echo "Triggering sweep..."
SWEEP=$(curl -s -X POST http://localhost:3000/sweep)
echo "$SWEEP" | jq .

echo "Checking incidents..."
INCIDENTS=$(curl -s http://localhost:3000/incidents)
echo "$INCIDENTS" | jq .

# Verify pod recovers (StatefulSet recreates it)
echo "Waiting for pod recovery..."
kubectl wait --for=condition=Ready "pod/$POD" -n "$NAMESPACE" --timeout=120s
echo "Pod recovered."
```

**Pass criteria:**
- Monitor detects the missing/restarting pod in its sweep
- Incident is structured with correct severity and component
- Pod recovers via StatefulSet within 2 minutes

---

### 2. Agent Failure

**File:** `tests/chaos/agent-failure.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "=== Chaos: Agent Failure ==="

# Kill the Operator
OPERATOR_PID=$(lsof -ti:3002 || true)
if [ -n "$OPERATOR_PID" ]; then
  echo "Killing Operator (PID $OPERATOR_PID)..."
  kill "$OPERATOR_PID"
fi

echo "Verifying Monitor still responds..."
curl -sf http://localhost:3000/health && echo " Monitor OK" || echo " Monitor FAILED"

echo "Verifying Mitigator still responds..."
curl -sf http://localhost:3001/health && echo " Mitigator OK" || echo " Mitigator FAILED"

echo "Triggering sweep (Operator down)..."
SWEEP=$(curl -s -X POST http://localhost:3000/sweep)
echo "$SWEEP" | jq .

echo "Attempting dispatch to Mitigator directly..."
DISPATCH=$(curl -s -X POST http://localhost:3001/dispatch \
  -H 'Content-Type: application/json' \
  -d '{"runbook":"pod_crashloop","component":"pinot-server-0","namespace":"pinot","evidence":"test"}')
echo "$DISPATCH" | jq .

echo "Done. Restart Operator manually: npm run start:operator"
```

**Pass criteria:**
- Monitor and Mitigator continue operating independently
- No unhandled exceptions or crashes in the remaining agents
- Errors when trying to reach the dead agent are logged gracefully

---

### 3. LLM Unavailable

**File:** `tests/chaos/llm-unavailable.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "=== Chaos: LLM Unavailable ==="

echo "Stopping Ollama..."
ollama stop 2>/dev/null || true
pkill -f "ollama serve" || true

sleep 2

echo "Verifying agents still respond on /health..."
for port in 3000 3001 3002; do
  curl -sf "http://localhost:$port/health" && echo " :$port OK" || echo " :$port FAILED"
done

echo "Triggering sweep (LLM down)..."
SWEEP=$(curl -s -w "\nHTTP %{http_code}" -X POST http://localhost:3000/sweep)
echo "$SWEEP"

echo "Attempting dispatch (LLM down)..."
DISPATCH=$(curl -s -w "\nHTTP %{http_code}" -X POST http://localhost:3001/dispatch \
  -H 'Content-Type: application/json' \
  -d '{"runbook":"pod_crashloop","component":"pinot-server-0","namespace":"pinot","evidence":"test"}')
echo "$DISPATCH"

echo "Operator should still work (no LLM dependency)..."
TRIAGE=$(curl -s -w "\nHTTP %{http_code}" -X POST http://localhost:3002/incident \
  -H 'Content-Type: application/json' \
  -d '{"severity":"critical","component":"pinot-server-0","evidence":"CrashLoopBackOff"}')
echo "$TRIAGE"

echo "Restarting Ollama..."
ollama serve &>/dev/null &
sleep 5
echo "Ollama restarted."
```

**Pass criteria:**
- All 3 agents remain responsive on `/health`
- Monitor and Mitigator return meaningful error responses (not crashes) when LLM is unavailable
- Operator functions normally (it has no LLM dependency)
- After Ollama restarts, Monitor and Mitigator resume normal operation without agent restart

---

## Test Data & Fixtures

**File:** `tests/fixtures/incidents.ts`

```ts
import type { Incident } from '@pinot-agents/shared';

export const podCrashloop: Incident = {
  severity: 'critical',
  component: 'pinot-server-0',
  evidence: 'Pod pinot-server-0 in CrashLoopBackOff, 5 restarts in 10 minutes',
  suggestedAction: 'Delete pod to force clean restart',
};

export const segmentOffline: Incident = {
  severity: 'high',
  component: 'events_REALTIME',
  evidence: 'Segment events__0__1__20260307T0000Z is OFFLINE on pinot-server-1',
  suggestedAction: 'Reload segment or rebalance table',
};

export const brokerUnreachable: Incident = {
  severity: 'critical',
  component: 'pinot-broker-0',
  evidence: 'Connection refused on pinot-broker-0:8099',
  suggestedAction: 'Check broker pod status and restart if needed',
};

export const controllerDown: Incident = {
  severity: 'critical',
  component: 'pinot-controller-0',
  evidence: 'pinot-controller-0 not ready, 0/1 containers running',
  suggestedAction: 'Investigate controller logs and restart',
};

export const highRestartCount: Incident = {
  severity: 'medium',
  component: 'pinot-server-1',
  evidence: 'restartCount: 8 in last 24 hours',
  suggestedAction: 'Investigate root cause of frequent restarts',
};
```

**File:** `tests/helpers/agent-client.ts`

```ts
const BASE_URLS = {
  monitor: 'http://localhost:3000',
  operator: 'http://localhost:3002',
  mitigator: 'http://localhost:3001',
} as const;

export async function agentFetch(
  agent: keyof typeof BASE_URLS,
  path: string,
  options?: RequestInit,
) {
  const url = `${BASE_URLS[agent]}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  return { status: res.status, body: await res.json() };
}

export async function postIncident(incident: unknown, trustLevel = 3) {
  return agentFetch('operator', '/incident', {
    method: 'POST',
    body: JSON.stringify({ ...incident as object, trustLevel }),
  });
}

export async function postDispatch(dispatch: unknown) {
  return agentFetch('mitigator', '/dispatch', {
    method: 'POST',
    body: JSON.stringify(dispatch),
  });
}
```

---

## CI/CD Integration

### GitHub Actions Workflow (suggested)

```yaml
name: Integration Tests
on:
  push:
    branches: [main]
  pull_request:

jobs:
  integration:
    runs-on: ubuntu-latest
    services:
      ollama:
        # Use a pre-built Ollama image or skip LLM tests in CI
        image: ollama/ollama:latest
        ports:
          - 11434:11434
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install --legacy-peer-deps
      - run: npm run typecheck
      - run: npm run start:all &
      - run: sleep 10  # Wait for agents to start
      - run: npm test

  load:
    runs-on: ubuntu-latest
    needs: integration
    steps:
      - uses: actions/checkout@v4
      - uses: grafana/setup-k6-action@v1
      - run: k6 run tests/load/operator-flood.k6.js
      # Skip LLM-dependent load tests in CI (too slow without GPU)
```

### Running Locally

```bash
# Integration tests (requires all agents running + Pinot cluster + Ollama)
npm run start:all &
npm run test:integration

# Load tests
k6 run tests/load/monitor-sweep.k6.js
k6 run tests/load/operator-flood.k6.js

# Chaos tests (requires kubectl access to Pinot cluster)
bash tests/chaos/pod-kill.sh
bash tests/chaos/agent-failure.sh
bash tests/chaos/llm-unavailable.sh
```

---

## Success Criteria Summary

| Category | Metric | Target |
|----------|--------|--------|
| Integration | All health checks pass | 100% |
| Integration | Sweep returns valid incident schema | 100% |
| Integration | All 20 trust-level matrix cases pass | 100% |
| Integration | Circuit breaker trips at maxRetries | 100% |
| Integration | E2E loop completes within 120s | 100% |
| Load | Operator p95 latency | < 500ms |
| Load | Monitor sweep p95 latency | < 30s |
| Load | Error rate under load | < 10% (Monitor), < 1% (Operator) |
| Chaos | Agents survive peer failure | No crashes |
| Chaos | Agents survive LLM outage | Graceful errors, no crashes |
| Chaos | Pod kill detected within 1 sweep | Incident generated |
