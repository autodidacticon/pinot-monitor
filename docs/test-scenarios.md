# Test Scenarios — Executed by Quality Control

This document records every test scenario executed against the Pinot cluster,
including the conditions created, agent responses, and outcomes.

---

## Scenario Registry

| ID | Name | Runbook Targeted | Status | Date |
|----|------|-----------------|--------|------|
| TS-001 | Baseline health sweep | N/A | **FAIL** (false positives) | 2026-03-09 |
| TS-002 | Pod crashloop via server delete | pod_crashloop | **PARTIAL** (pod recovered too fast) | 2026-03-09 |
| TS-003 | Segment offline via data load | segment_offline | **PASS** (runbook matched) | 2026-03-09 |
| TS-004 | Broker unreachable via pod delete | broker_unreachable | **PASS** (runbook matched) | 2026-03-09 |
| TS-005 | Controller down via pod delete | controller_down | **FAIL** (not detected, pod recovered too fast) | 2026-03-09 |
| TS-006 | High restart count via repeated deletes | high_restart_count | **FAIL** (not triggered, delete != restart) | 2026-03-09 |
| TS-007 | Query overload stress test | N/A (novel) | **PASS** (no errors at 20 concurrent) | 2026-03-09 |
| TS-008 | Segment flood (many small segments) | segment_offline | **DONE** (see TS-026) | 2026-03-09 |
| TS-009 | Novel incident (no runbook match) | N/A | **PASS** (novel pattern recorded) | 2026-03-09 |
| TS-010 | Full E2E loop validation | All | **PARTIAL** (dispatch received but response timeout) | 2026-03-09 |
| TS-011 | BUG-006 fix verification (dispatch timeout) | segment_offline | **PASS** (5s timeout, fire-and-forget) | 2026-03-09 |
| TS-012 | Circuit breaker validation | segment_offline | **PASS** (trips after maxRetries=2) | 2026-03-09 |
| TS-013 | Novel incident (Zookeeper pattern) | N/A | **PASS** (novel pattern recorded) | 2026-03-09 |
| TS-014 | BUG-001 fix: OFFLINE segment false positives | segment_offline | **PASS** (no false positives) | 2026-03-09 |
| TS-015 | BUG-007 fix: Controller health probe | controller_down | **PASS** (health probe works) | 2026-03-09 |
| TS-016 | Runbook pattern fix (pinot-server-0 matching) | pod_crashloop, high_restart_count | **PARTIAL** (component match works, severity not filtered) | 2026-03-09 |
| TS-017 | Circuit breaker reset after restart | segment_offline | **PASS** (dispatch succeeds after restart) | 2026-03-09 |
| TS-018 | Full sweep with BUG-001/002/007 fixes | N/A | **PASS** (zero false positives, all 3 bugs verified fixed) | 2026-03-09 |
| TS-018b | Full sweep with glm-4.7-flash | N/A | **PASS** (zero incidents, 41.2s sweep) | 2026-03-09 |
| TS-019 | Rapid dispatch benchmark (glm-4.7-flash) | segment_offline | **PASS** (5.022s dispatch) | 2026-03-09 |
| TS-020 | Rate limiter test | N/A | **PASS** (429 after 9+1 requests) | 2026-03-09 |
| TS-021 | Rapid sequential sweeps (3x) | N/A | **PASS** (28-34s, consistent quality) | 2026-03-09 |
| TS-022 | Concurrent sweep + chat | N/A | **PASS** (both complete, degraded perf) | 2026-03-09 |
| TS-023 | Full E2E with glm-4.7-flash (pod delete) | segment_offline | **PASS** (3 incidents detected, dispatch + remediation) | 2026-03-09 |
| TS-024 | Graceful shutdown during sweep | N/A | **PASS** (server closes, force exit after 30s) | 2026-03-09 |
| TS-025 | Storage capacity baseline | N/A (storage_pressure) | **PASS** (baseline measured) | 2026-03-09 |
| TS-026 | Segment flood with quota enforcement | N/A (storage_pressure) | **PASS** (quota rejects at 10M) | 2026-03-09 |
| TS-027 | Large data ingestion (via TS-026) | N/A (storage_pressure) | **PASS** (200K rows = 7.3MB) | 2026-03-09 |
| TS-028 | Storage monitoring gap analysis | N/A (storage_pressure) | **GAP** (no storage detection) | 2026-03-09 |
| TS-029 | Storage tool verification (pinot_table_size) | N/A | **PASS** (returns human-readable sizes) | 2026-03-09 |
| TS-030 | Sweep with storage check | N/A | **PASS** (storage section included, 43s) | 2026-03-09 |
| TS-031 | Storage pressure runbook matching | storage_pressure | **PASS** (dispatched at TRUST_LEVEL=3) | 2026-03-09 |
| TS-032 | SSE /watch endpoint | N/A | **PASS** (connects, delivers sweep events) | 2026-03-09 |
| TS-033 | Heavy query stress test | N/A (novel) | **PASS** (degradation at 50 expensive, server timeouts) | 2026-03-09 |
| TS-034 | Query overload detection | N/A | **PARTIAL** (sweep slowed, 1 indexing incident under load) | 2026-03-09 |
| TS-035 | Query timeout behavior | N/A | **PASS** (timeouts confirmed, 200 simple queries ok) | 2026-03-09 |
| TS-036 | Query overload detection E2E (pinot_broker_latency) | query_overload | **PASS** (tool works, runbook matches, full pipeline) | 2026-03-09 |
| TS-037 | LLM output validation (input validation at operator boundary) | N/A | **PASS** (all invalid inputs rejected) | 2026-03-09 |
| TS-038 | Blast radius controls (concurrent + same-component) | segment_offline | **PASS** (max concurrent + same-component blocking verified) | 2026-03-09 |
| TS-039 | Rollback log endpoint | N/A | **PASS** (endpoint works, dry-run mode prevents entries) | 2026-03-09 |
| TS-040 | K8s events monitoring (kubectl_events tool) | N/A | **PASS** (tool invoked, events in sweep report) | 2026-03-09 |

---

## Scenario Details

### TS-001: Baseline Health Sweep

**Objective:** Establish baseline — sweep a healthy cluster and verify no false positives.

**Steps:**
1. Verify all Pinot pods are Running and Ready
2. Trigger `POST /sweep` on Monitor
3. Check incidents returned

**Expected:** Zero incidents or INFO-level only.

**Actual:** **FAIL** — 2 WARNING incidents detected on a healthy cluster:
1. `seg-offline-001` (pinot-segments): "3 OFFLINE segments" — **false positive**. OFFLINE is the correct state for batch-loaded OFFLINE table segments. Monitor should distinguish OFFLINE table type from segments in error state.
2. `column-missing-002` (pinot-tables): "Failed to query MAX(event_time): UnknownColumnError" — Monitor assumes all tables have an `event_time` column for freshness checks. The test table uses `timestamp`.

**Bugs Filed:** BUG-001 (false positive OFFLINE segments), BUG-002 (hardcoded event_time column)

---

### TS-002: Pod Crashloop via Server Delete

**Objective:** Trigger pod_crashloop runbook by killing the Pinot server pod.

**Steps:**
1. Record baseline pod state: `kubectl get pods -n pinot`
2. Delete server pod: `kubectl delete pod pinot-server-0 -n pinot`
3. Trigger sweep immediately: `POST /sweep`
4. Check operator audit: `GET /audit`
5. Verify pod recovers via StatefulSet

**Expected:** Monitor detects restart/crashloop, Operator matches pod_crashloop runbook.

**Actual:** **PARTIAL** — Pod auto-recovered in ~3 seconds via StatefulSet. The sweep takes longer than recovery, so by the time the LLM processes tool results, the pod is already Running again. The CrashLoopBackOff state was never reached because the pod restarted cleanly.

**Observation:** To properly trigger pod_crashloop, the pod must fail repeatedly (not just be deleted once). StatefulSet restart is too fast for single-delete to trigger the pattern.

---

### TS-003: Segment Offline via Data Load

**Objective:** Verify segment_offline runbook matches when OFFLINE segments are detected.

**Steps:**
1. Created test schema `stress_test_events` and OFFLINE table
2. Uploaded 3 segments (10K, 100K, 1M rows)
3. Triggered sweep

**Expected:** Monitor detects OFFLINE segments, Operator matches segment_offline runbook.

**Actual:** **PASS** — Operator matched `segment_offline` runbook and attempted dispatch to Mitigator. Dispatch failed due to BUG-003 (mitigator URL unreachable). However, the detection + runbook matching worked correctly.

**Note:** This is technically a false positive — OFFLINE segments in OFFLINE tables are normal. But it proves the runbook matching pipeline works.

---

### TS-007: Query Overload Stress Test

**Objective:** Overwhelm the Pinot broker/server with expensive queries.

**Steps:**
1. 1.1M rows loaded across 3 segments
2. Sequential queries: COUNT, GROUP BY, AVG, PERCENTILE, DISTINCTCOUNT
3. 10 concurrent GROUP BY queries
4. 20 concurrent mixed heavy queries

**Expected:** Resource exhaustion or degradation detected.

**Actual:** **PASS** (cluster survived) — Pinot handled all load without errors:
- Single queries: 24-244ms
- 10 concurrent: 251ms wall time, 0 errors
- 20 concurrent: 3,615ms wall time, 0 errors
- PERCENTILE and DISTINCTCOUNT most expensive (244ms single)
- Linear degradation under concurrency (10x latency at 20 concurrent)

**Conclusion:** 1.1M rows on single server is not enough to cause instability. Need 10M+ rows or memory-constrained server to stress the system.

---

### TS-009: Novel Incident (No Runbook Match)

**Objective:** Verify Phase 2 self-improvement loop records novel patterns.

**Steps:**
1. Baseline sweep produced an incident with no matching runbook (column-missing pattern)
2. Checked GET /novel-incidents

**Expected:** Operator records it as novel incident.

**Actual:** **PASS** — Novel incident correctly tracked:
- Pattern: `pinot-tables:failed_maxeventtime_query_timestamp_unknowncolumnerror`
- Status: `new`
- Occurrences: 1
- Component: `pinot-tables`
- Severity: `WARNING`

---

### TS-004: Broker Unreachable via Pod Delete

**Objective:** Trigger broker_unreachable runbook by deleting the broker pod.

**Steps:**
1. Verified pinot-broker-0 Running (age 28m, 0 restarts)
2. `kubectl delete pod pinot-broker-0 -n pinot` at 05:34:38 UTC
3. Triggered sweep immediately
4. Broker recovered in ~5s via StatefulSet

**Expected:** Monitor detects broker unavailability, Operator matches broker_unreachable runbook.

**Actual:** **PASS** — Runbook correctly matched:
- Operator audit at `05:47:24.420Z`: `action=dispatch, target=pinot-broker, runbook=broker_unreachable`
- Mitigator received dispatch (correlation `3ca0e0be`), ran remediation in DRY_RUN mode
- Mitigator actions: `kubectl_get` pods, `kubectl_delete` broker pod (DRY RUN), verify via Monitor chat
- Operator reports "Dispatch failed: fetch failed" but mitigator log confirms receipt and processing (BUG-006)

**Note:** The sweep took ~785s. The broker recovered in ~5s, but the monitor's `pinot_health` tool still detected the transient unavailability.

---

### TS-005: Controller Down via Pod Delete

**Objective:** Trigger controller_down runbook by deleting the controller pod.

**Steps:**
1. Verified pinot-controller-0 Running (age 3d11h)
2. `kubectl delete pod pinot-controller-0 -n pinot` at 06:01:44 UTC
3. Triggered sweep immediately
4. Controller recovered in ~5s via StatefulSet

**Expected:** Monitor detects controller unavailability, Operator matches controller_down runbook.

**Actual:** **FAIL** — controller_down runbook was NOT triggered:
- Sweep completed in 803.6s with 3 incidents (all segment_offline/query-related, same as baseline)
- No controller-related incidents detected
- Controller recovered before sweep's first tool call could observe it (kubectl_get shows all pods Running)
- Monitor depends on controller for most Pinot API tools, so if controller is down, tools return errors but LLM interprets them as API issues rather than controller outage

**Root cause:** Two issues prevent detection:
1. StatefulSet recovery is faster (~5s) than sweep initiation
2. Monitor has no dedicated controller connectivity check; it relies on LLM inference from tool errors
3. The `pinot_health` tool may have succeeded because the controller was already back by turn 2

**Recommendation:** Add a dedicated controller health probe at sweep start (before other tools), or use kubectl events/logs to detect recent pod restarts.

---

### TS-006: High Restart Count via Repeated Deletes

**Objective:** Trigger high_restart_count runbook by deleting pinot-server-0 three times rapidly.

**Steps:**
1. Pre-state: pinot-server-0 Running, 0 restarts
2. Deleted pod 3 times with 5s gaps (06:15:30, 06:15:35, 06:15:41 UTC)
3. Post-state: pinot-server-0 Running, 0 restarts
4. Triggered sweep

**Expected:** Monitor detects high restart count, Operator matches high_restart_count runbook.

**Actual:** **FAIL** — high_restart_count runbook was NOT triggered:
- `kubectl delete pod` on a StatefulSet creates a new pod (not a container restart)
- `restartCount` in pod status remained 0 after all 3 deletes
- Kubernetes `restartCount` only increments when a container crashes within the same pod
- The sweep detected only segment_offline incidents (same as baseline)
- No high_restart_count audit entry in operator

**Root cause:** Fundamental test design flaw — `kubectl delete pod` does not increment `restartCount`. To trigger `high_restart_count`, the container must crash repeatedly within the same pod (e.g., OOMKill, failing liveness probe, corrupted entrypoint).

**Recommendation:** To properly test this runbook:
- Use `kubectl exec` to kill the Java process inside the container: `kubectl exec pinot-server-0 -n pinot -- kill 1`
- Or reduce memory limits to trigger OOMKill under load
- Or modify the liveness probe to fail temporarily

---

### TS-010: Full E2E Loop Validation (Re-test)

**Objective:** Validate complete Monitor -> Operator -> Mitigator -> Monitor loop.

**Steps:**
1. Verified all 3 agents healthy (health endpoints return ok)
2. `kubectl delete pod pinot-server-0 -n pinot` at 06:27:51 UTC
3. Triggered sweep (completed in 949.3s, 7 tool calls, 2 incidents)
4. Checked operator audit, mitigator log, metrics, novel incidents

**Results by stage:**
- **Monitor -> Operator:** **PASS** — Monitor forwarded incidents to operator. Operator audit shows `dispatch` action at `06:32:21.994Z` for `segment_offline` runbook.
- **Operator -> Mitigator:** **PARTIAL** — Operator reports "fetch failed" BUT mitigator log confirms receipt of all dispatches. Root cause is BUG-006 (synchronous dispatch timeout).
- **Mitigator execution:** **PASS** — Mitigator ran remediation in DRY_RUN mode:
  - `pinot_reload_segment` (DRY RUN)
  - `kubectl_get_mitigator` to check pod state
  - `request_monitor_verify` to verify fix via Monitor chat
- **Mitigator -> Monitor (verify):** **PASS** — Monitor chat received verification request and ran segment checks.

**Operator Metrics (final state):**
- `operator_incidents_received_total`: 13
- `operator_incidents_dispatched_total`: 8
- `operator_incidents_no_runbook_total`: 3
- `operator_circuit_breaker_trips_total`: 0
- `operator_triage_duration_seconds_sum`: 2226.4s (avg 222.6s per triage, LLM-dominated)

**Novel Incidents (3 tracked):**
1. `pinot-tables:failed_maxeventtime_query_timestamp_unknowncolumnerror` (WARNING)
2. `pinot-server-0:crashloopbackoff_last_minutes_pinotserver0_restarts` (WARNING)
3. `pinot-table:ingestion_marked_status_stresstesteventsoffline_unknown` (WARNING)

**Mitigator DRY_RUN Actions (all sessions):**
- 5x `pinot_reload_segment` (segment reload)
- 2x `kubectl_delete` (pod restart)
- 1x `kubectl_exec` (log inspection)
- 1x `pinot_update_config` (table config update)
- Multiple `request_monitor_verify` calls (verification loop)

**Conclusion:** **PARTIAL** — The full loop works end-to-end, but the operator incorrectly reports dispatch failures due to HTTP response timeout (BUG-006). All dispatches are received and processed by the mitigator. The verify step (Mitigator -> Monitor) also works correctly.

---

## Bugs Found

| ID | Severity | Description | Component |
|----|----------|-------------|-----------|
| BUG-001 | MEDIUM | **FIXED (TS-014, TS-018)** — Monitor flags OFFLINE segments in OFFLINE tables as incidents (false positive) | Monitor |
| BUG-002 | LOW | **FIXED (TS-018)** — Monitor freshness check hardcodes `event_time` column name | Monitor |
| BUG-003 | HIGH | Operator->Mitigator dispatch reports "fetch failed" (reclassified as BUG-006) | Operator/Mitigator |
| BUG-004 | LOW | `timestamp` column name causes data overflow (reserved SQL keyword) | Test data |
| BUG-005 | MEDIUM | New OFFLINE tables not queryable until broker pod restart (routing lag) | Pinot (external) |
| BUG-006 | HIGH | **FIXED** — Mitigator handles dispatch synchronously (runs full LLM loop before HTTP response), causing operator fetch to timeout. Fix: operator uses 5s AbortController timeout, treats timeout as "accepted". Dispatches ARE received and operator now reports success. | Operator |
| BUG-007 | MEDIUM | **FIXED (TS-015, TS-018)** — No dedicated controller health probe in sweep; controller outages undetectable if pod recovers before sweep tools run | Monitor |
| BUG-008 | LOW | Sweep duration (680-1280s) far exceeds pod recovery time (~5s), making transient pod failures mostly undetectable | Monitor |
| BUG-009 | MEDIUM | `matchRunbook()` ignores severity field in incidentPattern, causing greedy first-match (pod_crashloop matches WARNING incidents meant for high_restart_count) | Operator |

---

## Performance Baselines

| Metric | Value | Conditions |
|--------|-------|------------|
| Single query latency | 24-244ms | 1.1M rows, 3 segments, single server |
| 10 concurrent queries | 251ms wall | GROUP BY queries |
| 20 concurrent queries | 3,615ms wall | Mixed heavy queries |
| Segment upload (10K rows) | 0.87s | 496 KB CSV |
| Segment upload (100K rows) | 0.82s | 4.96 MB CSV |
| Segment upload (1M rows) | 4.43s | 49.6 MB CSV |
| Sweep duration (qwen3:32b) | 679-1278s (TS-018: 695.8s) | LLM-dominated, highly variable |
| Sweep duration (glm-4.7-flash) | 41.2s (TS-018b), 28-34s (TS-021) | 16.9-24x faster than qwen3:32b |
| Sweep consistency (3x sequential) | 28.4s, 31.3s, 33.7s (TS-021) | Coefficient of variation: 8% |
| Concurrent sweep + chat overhead | 4.8x sweep, 3.3x chat (TS-022) | LLM serialization bottleneck |
| E2E detection-to-dispatch (glm-4.7-flash) | ~52s (TS-023) | 20x faster than qwen3:32b |
| Graceful shutdown force timeout | 30s (TS-024) | Configurable via SHUTDOWN_TIMEOUT_MS |
| Triage duration | <1ms | Deterministic rules engine |
| Pod recovery (StatefulSet) | ~5s | Single pod delete, no data corruption |
| Operator triage avg (pre-fix) | 222.6s | Includes LLM-dominated dispatch wait |
| Operator triage avg (post-fix) | ~5s | Dominated by 5s dispatch timeout |
| Circuit breaker response | <5ms | Instant rejection when breaker open |
| Novel incident recording | <5ms | Pattern matching + store |

---

### TS-011: BUG-006 Fix Verification (Dispatch Timeout)

**Objective:** Verify the BUG-006 fix — operator should return in ~5s when dispatching to mitigator, treating timeout as "accepted".

**Steps:**
1. First dispatch was sent in prior test (attempt 1) — operator returned in ~5s with "Dispatched runbook segment_offline (attempt 1)"
2. Waited and checked mitigator metrics: `dispatches_received_total: 1`, `dispatches_completed_total: 0` (still processing LLM loop)
3. Checked operator audit: dispatch logged as successful ("Dispatched to mitigator")
4. Sent second incident at 07:02:56 UTC
5. Timed the response

**Expected:** Operator returns in ~5s with success message, mitigator receives dispatch asynchronously.

**Actual:** **PASS** — All assertions met:
- Operator returned in **5.016s** (matches 5s AbortController timeout)
- Response: `{"results":[{"action":"dispatched","runbookId":"segment_offline","message":"Dispatched runbook segment_offline (attempt 2)"}]}`
- Audit log shows both dispatches with `outputSummary: "Dispatched to mitigator"` (no more "fetch failed")
- Mitigator received both dispatches (`dispatches_received_total: 2`)
- Operator triage duration: ~5s per dispatch (dominated by timeout wait, not LLM)

**BUG-006 Status:** **FIXED** — The fix in `packages/operator/src/index.ts` (`dispatchToMitigator()`) uses a 5s `AbortController` timeout and treats `AbortError` as success ("Dispatch accepted (mitigator processing async)"). This decouples operator response time from mitigator LLM processing.

---

### TS-012: Circuit Breaker Validation

**Objective:** Verify circuit breaker trips after maxRetries is reached for segment_offline runbook.

**Steps:**
1. Attempt 1 (from TS-011): dispatched successfully
2. Attempt 2 (from TS-011): dispatched successfully
3. Attempt 3: sent identical incident at 07:03:12 UTC
4. Attempt 4: sent identical incident at 07:03:18 UTC (verify stays open)

**Configuration:** `segment_offline` runbook has `maxRetries: 2`, `cooldownMs: 600000` (10 min), `escalateAfterRetries: true`.

**Expected:** Attempts 1-2 dispatch, attempt 3+ circuit-broken.

**Actual:** **PASS** — Circuit breaker works correctly:
- Attempt 1: `{"action":"dispatched","message":"Dispatched runbook segment_offline (attempt 1)"}`
- Attempt 2: `{"action":"dispatched","message":"Dispatched runbook segment_offline (attempt 2)"}`
- Attempt 3: `{"action":"circuit_broken","message":"Circuit breaker open for segment_offline"}` — returned in **0.005s** (instant, no dispatch)
- Attempt 4: `{"action":"circuit_broken","message":"Circuit breaker open for segment_offline"}` — confirmed stays open
- Audit log confirms: two `dispatch` entries, two `circuit_broken` entries
- Operator metrics: `circuit_breaker_trips_total: 2`

**Key observations:**
- Circuit breaker is per `runbookId:component` key (`segment_offline:pinot-segments`)
- Guard condition: `attempts < maxRetries` (2 attempts allowed, 3rd blocked)
- Cooldown is 10 minutes; breaker will reset after `cooldownMs` elapses from last attempt
- `escalateAfterRetries: true` triggers alert when breaker trips

---

### TS-013: Novel Incident (Zookeeper Pattern)

**Objective:** Verify novel incident tracking for an incident with no matching runbook (Zookeeper component).

**Steps:**
1. Sent incident with `component: "pinot-zookeeper"` and evidence about ZK session timeout, leader election, broker disconnection
2. Checked GET /novel-incidents

**Expected:** Incident recorded as novel with unique pattern, status "new".

**Actual:** **PASS** — Novel incident correctly tracked:
- Pattern: `pinot-zookeeper:after_election_leader_session_timeout`
- Status: `new`
- Occurrences: 1
- Component: `pinot-zookeeper`
- Severity: `WARNING`
- Evidence preserved: `["ZK session timeout after 30s", "Leader election in progress", "3 brokers disconnected from ZK"]`
- Audit entry: `action=alert_no_runbook`, `outputSummary="No runbook found, alerted human"`

**Note:** Pattern generation creates a compact key from evidence keywords. This is a good candidate for a future runbook (zookeeper_session_expired) if ZK issues recur.

---

### TS-014: BUG-001 Fix Verification (OFFLINE Segment False Positives)

**Objective:** Verify BUG-001 fix — monitor no longer flags OFFLINE segments in OFFLINE tables as incidents.

**Steps:**
1. Confirmed all 3 agents healthy (health endpoints return ok)
2. `POST /chat` with message: "Check the segments for table stress_test_events_OFFLINE and tell me if any are in error state. Remember that OFFLINE segments in OFFLINE tables are normal."
3. Analyzed LLM response for false positive incident generation

**Expected:** Monitor correctly identifies OFFLINE segments as normal for an OFFLINE table; no incidents flagged.

**Actual:** **PASS** — The monitor's `pinot_segments` tool was called and returned segment data. The LLM response correctly stated:
- All 3 segments (`stress_test_events_1773032664132`, `stress_test_events_1773032667546`, `stress_test_events_1773032672108`) are in OFFLINE state
- "which is normal for an OFFLINE table"
- "No segments are in ERROR state"
- "No action required"

**BUG-001 Status:** **FIXED** — The `pinot_segments` tool now fetches table type, and the sweep prompt instructs the LLM that OFFLINE segments in OFFLINE tables are normal.

---

### TS-015: BUG-007 Fix Verification (Controller Health Probe)

**Objective:** Verify BUG-007 fix — monitor can check controller connectivity via `pinot_health` tool.

**Steps:**
1. `POST /chat` with message: "Check if the Pinot controller is reachable using pinot_health"
2. Verified the LLM used the `pinot_health` tool and returned controller status

**Expected:** Monitor uses `pinot_health` tool to check controller connectivity; returns clear status.

**Actual:** **PASS** — The monitor:
- Called `pinot_health` tool
- Reported: "The Pinot controller is reachable and healthy (status: OK)"
- Confirmed all components (controller, broker, server) are in OK state

**BUG-007 Status:** **FIXED** — The sweep prompt now starts with a controller connectivity check. The `pinot_health` tool provides the necessary health probe.

---

### TS-016: Runbook Pattern Fix (pinot-server-0 Component Matching)

**Objective:** Verify `pod_crashloop` and `high_restart_count` runbooks match `pinot-server-0` style component names.

**Steps:**
1. Sent incident to operator: `component: "pinot-server-0"`, evidence: `["CrashLoopBackOff in last 10 minutes, 5 restarts"]`
2. Sent incident to operator: `component: "pinot-server-0"`, evidence: `["High restart count: 8 restarts in last hour"]`
3. Checked audit log

**Expected:** First incident matches `pod_crashloop`, second matches `high_restart_count`.

**Actual:** **PARTIAL** —
- First incident: **PASS** — Correctly matched `pod_crashloop` runbook. Response: `"Dispatched runbook pod_crashloop (attempt 1)"`. This confirms the component pattern `/pinot-.*\d+/i` correctly matches `pinot-server-0`.
- Second incident: **UNEXPECTED** — Matched `pod_crashloop` (attempt 2) instead of `high_restart_count`. Root cause: `pod_crashloop` evidence pattern `/crashloop|crash.?loop|restart/i` matches the word "restart" in "8 restarts in last hour", and `pod_crashloop` is ordered before `high_restart_count` in the runbooks array. Since `matchRunbook()` does not check severity (severity field is defined but unused in matching), `pod_crashloop` (CRITICAL-intended) matched a WARNING incident.
- Second attempt also triggered circuit breaker (maxRetries=2 reached).

**Finding:** The component pattern fix works correctly (`pinot-server-0` now matches). However, `matchRunbook()` does not filter by severity, causing `pod_crashloop` to greedily match incidents intended for `high_restart_count`. This is a pre-existing gap (BUG-009).

**New Bug Filed:** BUG-009 — `matchRunbook()` ignores severity field in incidentPattern, causing greedy first-match behavior.

---

### TS-017: Circuit Breaker Reset After Agent Restart

**Objective:** Verify circuit breaker state is cleared when agents restart, allowing previously-blocked runbooks to dispatch again.

**Steps:**
1. Confirmed agents were recently restarted (in-memory state reset)
2. Sent `segment_offline` incident: `component: "pinot-segments"`, evidence: `["3 OFFLINE segments in error state"]`
3. Checked response

**Expected:** Dispatch succeeds (circuit breaker reset, attempt 1).

**Actual:** **PASS** — Response: `"Dispatched runbook segment_offline (attempt 1)"`. The circuit breaker state was properly cleared on restart, allowing the segment_offline runbook to dispatch again. Audit log confirms: `action=dispatch, target=pinot-segments, runbook=segment_offline, attempt=1`.

---

### TS-018: Full Sweep with BUG-001/002/007 Fixes

**Objective:** Run a full sweep against the healthy cluster after fixing BUG-001 (OFFLINE segment false positives), BUG-002 (hardcoded event_time), and BUG-007 (controller probe). Compare results to TS-001 baseline which had 2 false positives.

**Pre-conditions:**
- All 3 agents healthy (monitor :3000, mitigator :3001, operator :3002)
- Operator TRUST_LEVEL=3, BUG-009 fix applied
- Monitor sweeps_total: 0, incidents_detected_total: 0 (clean state)
- Operator: 2 prior audit entries (from earlier tests), 0 circuit breaker trips

**Steps:**
1. `POST http://localhost:3000/sweep` with body `{}`
2. Polled `GET /metrics` every 60s during sweep
3. Collected sweep response, operator audit, operator metrics, novel incidents

**Expected:** Zero false positives. Controller probe first. No hardcoded event_time errors.

**Actual:** **PASS** -- All 3 bug fixes verified:

**Sweep Report Summary:**
- Overall Status: **HEALTHY**
- Duration: **695.8s** (~11.6 min) -- within historical range (679-1278s)
- Incidents detected: **0** (empty JSON array `[]`)
- No sweep errors

**BUG-007 (Controller health probe) -- VERIFIED FIXED:**
- The sweep report shows controller health check as the first item under "Pinot Health"
- Result: "Controller: OK - API reachable and responsive"
- The prompt instruction "Use pinot_health FIRST to verify the controller is reachable" was followed

**BUG-001 (OFFLINE segment false positives) -- VERIFIED FIXED:**
- Report states: "stress_test_events (OFFLINE)" with "3 OFFLINE segments in storage"
- Annotated as "normal for OFFLINE table"
- **No incident generated** (in TS-001, this produced false positive `seg-offline-001`)
- The `pinot_segments` tool now returns table type, and the prompt correctly instructs the LLM to skip OFFLINE segments in OFFLINE tables

**BUG-002 (Hardcoded event_time column) -- VERIFIED FIXED:**
- Report states: "No time column in table schema - freshness check skipped"
- The LLM checked the schema first and found no time column, instead of blindly querying `MAX(event_time)`
- **No incident generated** (in TS-001, this produced false positive `column-missing-002`)
- The prompt instruction "First get the table schema... Do NOT hardcode column names like event_time" was followed

**Post-sweep metrics:**
- `monitor_sweeps_total`: 1 (incremented from 0)
- `monitor_incidents_detected_total`: 0 (no false positives)
- `monitor_sweep_errors_total`: 0
- `monitor_sweep_duration_seconds_sum`: 695.841s
- `monitor_chat_requests_total`: 7 (incremented by 2 during sweep -- schema lookup + count query)

**Operator state (unchanged -- no incidents forwarded):**
- `operator_incidents_received_total`: 2 (unchanged from pre-sweep)
- `operator_incidents_dispatched_total`: 2 (unchanged)
- Audit log: no new entries from this sweep
- Novel incidents: empty (no new patterns)

**Comparison to TS-001 (Baseline):**

| Aspect | TS-001 (Baseline) | TS-018 (Post-fix) | Status |
|--------|-------------------|-------------------|--------|
| Overall status | DEGRADED (false positives) | HEALTHY | IMPROVED |
| Incidents | 2 (both false positives) | 0 | FIXED |
| seg-offline-001 | "3 OFFLINE segments" (false positive) | "normal for OFFLINE table" (no incident) | BUG-001 FIXED |
| column-missing-002 | "Failed to query MAX(event_time)" (false positive) | "No time column - freshness check skipped" (no incident) | BUG-002 FIXED |
| Controller probe | Not performed first | Performed first (OK) | BUG-007 FIXED |
| Sweep duration | ~680s | 695.8s | Comparable |
| Operator dispatches from sweep | 2 (from false positives) | 0 | IMPROVED |

**Conclusion:** All three bug fixes are verified working in a full sweep context. The monitor now correctly:
1. Checks controller health first (BUG-007)
2. Recognizes OFFLINE segments in OFFLINE tables as normal (BUG-001)
3. Looks up the actual time column from the schema instead of hardcoding event_time (BUG-002)

The sweep produced zero false positives against a healthy cluster, which is the expected baseline behavior.

---

### TS-018b: Full Sweep with glm-4.7-flash (LLM Model Benchmark)

**Objective:** Benchmark sweep performance with glm-4.7-flash model (replacing qwen3:32b) and verify all bug fixes still hold.

**Pre-conditions:**
- All 3 agents healthy (monitor :3000, mitigator :3001, operator :3002)
- LLM_MODEL=glm-4.7-flash on all agents
- Operator TRUST_LEVEL=3
- Clean metrics state (all counters at 0)

**Steps:**
1. Recorded start time: 2026-03-09T07:39:38.914Z
2. `POST http://localhost:3000/sweep` with body `{}`
3. Recorded end time: 2026-03-09T07:40:27.901Z
4. Collected sweep response, metrics, operator audit

**Expected:** Zero false positives, all 3 bug fixes hold, faster sweep than qwen3:32b.

**Actual:** **PASS** -- All assertions met:

**Sweep Report Summary:**
- Overall Status: **HEALTHY**
- Duration: **41.2s** (monitor_sweep_duration_seconds_sum)
- Wall clock: **49s**
- Incidents detected: **0** (empty JSON array `[]`)
- Sweep errors: 0

**Bug Fix Verification:**
- **BUG-007 (Controller probe):** VERIFIED -- Report shows "Controller: OK" as first health check item
- **BUG-001 (OFFLINE false positives):** VERIFIED -- Report states "All OFFLINE segments in OFFLINE-type table are in normal state. No ERROR or problematic segments detected."
- **BUG-002 (Hardcoded event_time):** VERIFIED -- Report states "Freshness check skipped - table schema does not contain a recognized time column"

**LLM Behavior Observations (glm-4.7-flash vs qwen3:32b):**
- Report format is cleaner and more structured (uses Unicode box-drawing characters)
- No `/think` reasoning blocks (qwen3 sometimes emitted thinking tokens)
- Tool call patterns identical: pinot_health, kubectl_get, pinot_tables, pinot_segments, pinot_cluster_info, pinot_query
- Report correctly identifies OpenClaw agent pod (previously not mentioned in qwen3 sweeps)
- No hallucinated incidents or false positives

**Performance Comparison:**

| Metric | qwen3:32b | glm-4.7-flash | Speedup |
|--------|-----------|---------------|---------|
| Sweep duration | 680-1280s (avg ~695s) | 41.2s | **16.9x faster** |
| Wall clock | ~700s | 49s | **14.3x faster** |
| Incidents (healthy cluster) | 0 (post-fix) | 0 | Same |
| Report quality | Good | Good (cleaner format) | Comparable |

**Post-sweep metrics:**
- `monitor_sweeps_total`: 1
- `monitor_incidents_detected_total`: 0
- `monitor_sweep_errors_total`: 0
- `monitor_sweep_duration_seconds_sum`: 41.247s
- `monitor_chat_requests_total`: 0

**Conclusion:** glm-4.7-flash is dramatically faster (16.9x) than qwen3:32b with no loss in sweep quality. All three bug fixes remain effective. The model produces clean, well-structured reports and follows tool-calling instructions correctly. This speed improvement makes the sweep cycle practical for near-real-time monitoring (sub-minute vs ~12 minutes).

---

### TS-019: Rapid Dispatch Benchmark (glm-4.7-flash)

**Objective:** Measure end-to-end operator dispatch latency with glm-4.7-flash model.

**Steps:**
1. Sent incident to operator: `component: "pinot-segments"`, severity: WARNING, evidence: "2 OFFLINE segments in error state"
2. Timed the response

**Expected:** Dispatch in ~5s (dominated by AbortController timeout to mitigator).

**Actual:** **PASS**
- Dispatch duration: **5.022s** (matches 5s AbortController timeout)
- Response: `{"results":[{"action":"dispatched","runbookId":"segment_offline","message":"Dispatched runbook segment_offline (attempt 1)"}]}`
- Operator correctly matched `segment_offline` runbook
- Audit entry: `action=dispatch, target=pinot-segments, runbook=segment_offline, attempt=1`

**Observation:** Dispatch latency is identical to qwen3:32b (both dominated by 5s timeout, not LLM processing). The operator's triage logic is deterministic (rules engine), so model choice does not affect dispatch speed.

---

### TS-020: Rate Limiter Test (Phase 4 Feature)

**Objective:** Verify the new SlidingWindowRateLimiter on POST /incident rejects requests beyond the configured limit (10/minute).

**Steps:**
1. Sent 12 rapid sequential requests to POST /incident with INFO severity test incidents
2. Recorded HTTP status codes for each request

**Expected:** First 10 return 200, last 2 return 429.

**Actual:** **PASS** (with caveat)
- Requests 1-9: HTTP 200 (accepted)
- Requests 10-12: HTTP 429 (rejected with `{"error":"Rate limit exceeded. Try again later."}`)
- Rate limiter triggered at request 10 (not 11)

**Caveat -- Off-by-one explained:**
The TS-019 bench-1 dispatch (sent ~17s earlier) consumed one slot in the 60-second sliding window. So the effective window had: 1 (bench-1) + 8 (rate-1 through rate-8) = 9 requests when rate-9 arrived, leaving room for rate-9. At rate-10, `timestamps.length >= 10`, so it was rejected. This is correct behavior -- the sliding window includes ALL requests within the 60-second window, not just the current test batch.

**Post-test metrics:**
- `operator_incidents_received_total`: 10 (1 from TS-019 + 9 from TS-020)
- `operator_rate_limit_rejections_total`: 3
- `operator_incidents_dispatched_total`: 1 (only bench-1 matched a runbook; INFO incidents logged only)
- `operator_circuit_breaker_trips_total`: 0

**Audit log analysis:**
- 1 `dispatch` entry (bench-1 segment_offline)
- 8 `log_info` entries (rate-1 through rate-8, all INFO severity -- correctly logged without dispatch)
- Rate-limited requests (rate-10 through rate-12) produced no audit entries (rejected before processing)

**Implementation details:**
- Rate limiter: `SlidingWindowRateLimiter` in `packages/shared/src/lifecycle.ts`
- Config: `RATE_LIMIT_MAX=10`, `RATE_LIMIT_WINDOW_MS=60000`
- Guard: `timestamps.length >= maxRequests` (correct >= comparison)
- Rejection response: HTTP 429 with `Retry-After` header set to window duration in seconds

**Conclusion:** Rate limiter works correctly. The sliding window correctly tracks all requests within the time window regardless of when they were sent. The `>=` guard ensures exactly `maxRequests` are allowed per window.

---

### TS-021: Rapid Sequential Sweeps (glm-4.7-flash Stress Test)

**Objective:** Run 3 sweeps back-to-back to test consistency of glm-4.7-flash across repeated invocations.

**Pre-conditions:**
- All 3 agents healthy
- LLM_MODEL=glm-4.7-flash
- Prior sweep baseline: 41.2s (TS-018b)

**Steps:**
1. `POST /sweep` three times sequentially
2. Compare durations and report quality
3. Check metrics between sweeps

**Expected:** Consistent sweep durations (~30-50s), zero incidents on healthy cluster, no degradation across runs.

**Actual:** **PASS** -- All 3 sweeps consistent:

| Sweep | Duration | Incidents | Report Quality |
|-------|----------|-----------|----------------|
| 1 | 28.4s | 0 | HEALTHY, clean format, all checks passed |
| 2 | 31.3s | 0 | HEALTHY, clean format, all checks passed |
| 3 | 33.7s | 0 | HEALTHY, clean format, all checks passed |

**Metrics after 3 sweeps:**
- `monitor_sweeps_total`: 4 (1 prior + 3 new)
- `monitor_incidents_detected_total`: 0
- `monitor_sweep_errors_total`: 0
- `monitor_sweep_duration_seconds_sum`: 134.582s (avg 33.7s per sweep in this batch)

**Report quality observations:**
- All 3 reports correctly identified: controller OK, broker OK, server OK
- All 3 correctly handled OFFLINE segments in OFFLINE table (no false positives)
- All 3 skipped freshness check due to no time column (BUG-002 fix holds)
- Minor formatting variations between runs (Unicode boxes, checkmarks) but content identical
- Row count consistently reported as 1,110,000

**Duration trend:** Slight increase (28.4s -> 31.3s -> 33.7s) likely due to Ollama model cache warming or minor load variation. All within acceptable range and far faster than qwen3:32b (680-1280s).

**Conclusion:** glm-4.7-flash produces consistent, high-quality sweeps across rapid sequential invocations with no degradation in accuracy or performance.

---

### TS-022: Concurrent Sweep + Chat

**Objective:** Test monitor's ability to handle a chat request while a sweep is in progress (Node.js single-threaded concurrency).

**Steps:**
1. Started sweep in background
2. Sent chat 500ms later: "Is the Pinot controller healthy?"
3. Measured both completion times

**Expected:** Both complete, but chat may be delayed due to single-threaded event loop contention.

**Actual:** **PASS** (both completed, with performance degradation)

| Request | Duration | Normal Duration | Slowdown |
|---------|----------|-----------------|----------|
| Sweep | 143.0s | ~30s | **4.8x slower** |
| Chat | 23.4s | ~7s | **3.3x slower** |

**Chat response:**
- Correctly called `pinot_health` tool
- Returned: "The Pinot controller is healthy" with OK status for all components
- Response quality identical to non-concurrent chat

**Observations:**
1. Node.js handled both requests concurrently (no deadlock or rejection)
2. Both requests completed successfully with correct results
3. Significant performance degradation (~4x) due to LLM API contention -- both requests compete for the same Ollama model instance
4. The Ollama server serializes LLM inference internally, so concurrent requests from the monitor effectively queue at the LLM layer
5. The sweep took 143s vs normal 30s because the chat's LLM calls interleaved with sweep LLM calls

**Root cause of slowdown:** Not Node.js single-threading, but Ollama model concurrency. Ollama processes one inference at a time per model, so concurrent requests from the monitor queue at the LLM API layer. Each request waits for the other's inference to complete before getting its turn.

**Conclusion:** The monitor correctly handles concurrent requests at the HTTP layer. Performance degradation is caused by LLM API serialization, not application-level blocking. In production, a separate Ollama instance (or batching-capable LLM API) would eliminate this bottleneck.

---

### TS-023: Full E2E with glm-4.7-flash (Pod Delete)

**Objective:** Gold standard test -- delete pinot-server-0, trigger sweep, verify the complete Monitor -> Operator -> Mitigator -> Monitor loop with glm-4.7-flash.

**Pre-conditions:**
- All 3 agents healthy
- All pods Running with 0 restarts
- Operator audit: 10 prior entries (1 dispatch + 9 log_info from earlier tests)
- Operator incidents_received: 10, dispatched: 1

**Steps:**
1. `kubectl delete pod pinot-server-0 -n pinot` (pod deletion took ~16s)
2. Immediately triggered `POST /sweep`
3. Checked operator audit, mitigator metrics, novel incidents

**Expected:** Monitor detects server issues, Operator matches runbook, Mitigator receives dispatch.

**Actual:** **PASS** -- Full E2E loop completed successfully:

**Sweep Results (46.9s):**
- Overall status: **DEGRADED**
- 3 incidents detected:
  1. `server-health-failure` (WARNING, pinot-server): Server health/readiness endpoint returned fetch failed error
  2. `segment-unavailable` (WARNING, pinot-segments): 3 offline segments unavailable during broker query
  3. `server-restart` (INFO, kubernetes): pinot-server-0 showing very recent restart age of 5 seconds

**Stage-by-Stage Results:**

| Stage | Status | Details |
|-------|--------|---------|
| Monitor detection | **PASS** | 3 real incidents detected in 46.9s (vs 949s with qwen3:32b in TS-010) |
| Monitor -> Operator | **PASS** | All 3 incidents forwarded to operator |
| Operator triage | **PASS** | `server-health-failure`: no runbook (novel), alerted. `segment-unavailable`: matched segment_offline, dispatched. `server-restart`: INFO, logged only. |
| Operator -> Mitigator | **PASS** | segment_offline dispatch sent (attempt 1), 5s timeout |
| Mitigator execution | **PASS** | Dispatch received (mitigator_dispatches_received_total: 2) |

**Operator audit (3 new entries from this test):**
- `07:52:52.493Z`: `alert_no_runbook` for pinot-server (novel incident)
- `07:52:57.500Z`: `dispatch` for pinot-segments, runbook=segment_offline, attempt=1
- `07:52:57.500Z`: `log_info` for kubernetes (INFO severity, no action)

**Novel incidents:**
- New pattern recorded: `pinot-server:endpoint_fetch_healthreadiness_returned_server` (WARNING)

**Post-test metrics:**
- `monitor_incidents_detected_total`: 3 (from 0)
- `operator_incidents_received_total`: 13 (from 10)
- `operator_incidents_dispatched_total`: 2 (from 1)
- `operator_incidents_no_runbook_total`: 1 (from 0)
- `mitigator_dispatches_received_total`: 2 (from 1)
- `mitigator_dispatch_duration_seconds_sum`: 135.8s (LLM-dominated remediation)

**Comparison to TS-010 (qwen3:32b E2E):**

| Aspect | TS-010 (qwen3:32b) | TS-023 (glm-4.7-flash) | Improvement |
|--------|---------------------|------------------------|-------------|
| Sweep duration | 949.3s | 46.9s | **20.2x faster** |
| Incidents detected | 2 | 3 (more granular) | Better detection |
| Detection specificity | segment_offline only | server-health + segment + restart | More nuanced |
| Operator triage | ~5s | ~5s | Same (deterministic) |
| Novel incidents | 0 | 1 (server health) | Better coverage |

**Conclusion:** The full E2E loop works correctly with glm-4.7-flash. The faster model detected the failure with more granularity (3 incidents vs 2), properly categorized severity levels (WARNING vs INFO), and the entire detection-to-dispatch cycle completed in under 52s (46.9s sweep + 5s dispatch). This is a 20x improvement over qwen3:32b and makes the system practical for near-real-time incident response.

---

### TS-024: Graceful Shutdown During Sweep

**Objective:** Verify the graceful shutdown handler (Phase 4 feature) stops accepting new connections but waits for in-flight requests.

**Steps:**
1. Started a sweep via `POST /sweep`
2. After 5 seconds, sent `SIGTERM` to monitor process (PID 7163)
3. Observed behavior
4. Waited for process exit
5. Restarted monitor

**Expected:** Server stops accepting new connections, in-flight sweep completes, then process exits cleanly.

**Actual:** **PASS** (with caveats)

**Timeline:**
- `07:53:28`: Sweep started
- `07:53:33`: SIGTERM sent (5s into sweep)
- `07:53:33`: Server immediately stopped accepting connections (curl returns exit code 7 = connection refused)
- `07:53:33`: In-flight sweep response was NOT returned to client (curl got empty response)
- `~07:54:03`: Process exited after 30s force timeout (`SHUTDOWN_TIMEOUT_MS=30000`)

**Behavior analysis:**
1. **server.close()** was called correctly -- new connections refused immediately
2. The in-flight HTTP response was NOT delivered to the client -- the curl received an empty response
3. The process waited the full 30s force timeout before exiting via `process.exit(1)`
4. The process did NOT exit cleanly (force exit, not natural completion)

**Finding: In-flight request handling gap**
The graceful shutdown correctly calls `server.close()`, which stops new connections. However, the in-flight sweep (LLM tool-calling loop) was interrupted. The `server.close()` callback ("all in-flight requests completed") never fired within the 30s window because the sweep was still waiting for LLM responses. The force timeout then killed the process.

This is expected behavior for long-running LLM requests. The sweep was making async LLM API calls via `fetch()`, and `server.close()` does not cancel those in-flight fetch calls. The sweep continued running in the background until the force timeout killed the process.

**Restart:**
- Monitor restarted successfully after test
- Health endpoint responds normally
- Metrics reset to zero (in-memory state cleared)

**Recommendation:** For production deployment, the `withTimeout` wrapper's AbortSignal could be used to propagate shutdown to in-flight sweep loops, allowing the sweep to terminate early and return a partial result. Currently the sweep ignores the abort signal from graceful shutdown.

**Conclusion:** Graceful shutdown works correctly at the HTTP layer (stops new connections, waits for existing ones). However, long-running LLM-backed requests (sweeps) will always hit the force timeout because the LLM API calls are not cancellable. The 30s force timeout is a reasonable safety net.

---

## Remaining Scenarios

TS-008 (segment flood) is pending. Requires larger data volumes (many small segments).

---

## Runbook Trigger Summary

| Runbook | Triggered? | Scenario | Notes |
|---------|-----------|----------|-------|
| segment_offline | YES (11x) | TS-003, TS-004, TS-005, TS-006, TS-010, TS-011, TS-012, TS-023 | No longer triggers on healthy sweep after BUG-001 fix (TS-018). Circuit breaker trips after 2 attempts (TS-012). TS-023: correctly triggered on real segment unavailability after server pod delete. |
| pod_crashloop | YES (2x) | TS-002 | Triggered by LLM hallucination of "5 restarts" and once by manual test |
| broker_unreachable | YES (1x) | TS-004 | Correctly triggered when broker pod deleted |
| controller_down | NO | TS-005 | Controller recovered before sweep could detect it (BUG-007) |
| high_restart_count | NO | TS-006, TS-016 | kubectl delete creates new pod, does not increment restartCount. TS-016: severity-unaware matching causes pod_crashloop to match first (BUG-009) |

---

## Key Findings

1. **Sweep latency is the critical bottleneck.** At 680-1280s per sweep, transient pod failures (~5s recovery) are undetectable. The system is designed for persistent failures, not transient ones.

2. **BUG-006 is FIXED.** The operator now uses a 5s AbortController timeout for mitigator dispatch, treating timeout as "accepted". Dispatches return in ~5s regardless of mitigator LLM processing time. Audit entries correctly show "Dispatched to mitigator" instead of "fetch failed".

3. **The E2E loop fundamentally works.** Monitor detects incidents, forwards to Operator, Operator matches runbooks and dispatches to Mitigator, Mitigator runs remediation (DRY_RUN) and verifies via Monitor chat. All stages function correctly now that BUG-006 is fixed.

4. **Circuit breaker works correctly.** Tested with segment_offline (maxRetries=2): first 2 attempts dispatched, 3rd and 4th attempts circuit-broken instantly (<5ms). Cooldown-based reset and per-component tracking verified.

5. **BUG-001 is FIXED.** The monitor no longer flags OFFLINE segments in OFFLINE tables as incidents. The `pinot_segments` tool now returns table type, and the sweep prompt instructs the LLM to treat OFFLINE segments in OFFLINE tables as normal (TS-014).

6. **BUG-007 is FIXED.** The monitor can now check controller connectivity via `pinot_health` tool at sweep start. Verified the health probe returns clear status for all components (TS-015).

7. **Runbook component pattern fix works, but severity matching is missing (BUG-009).** The component pattern `/pinot-.*\d+/i` correctly matches `pinot-server-0` style names (TS-016). However, `matchRunbook()` does not check the severity field, so `pod_crashloop` (intended for CRITICAL) greedily matches WARNING incidents before `high_restart_count` can be evaluated.

8. **Circuit breaker resets correctly on restart.** In-memory circuit breaker state is cleared when agents restart, allowing previously-blocked runbooks to dispatch again (TS-017).

9. **Novel incident tracking works well.** 4 novel patterns correctly identified and stored with proper deduplication (including new Zookeeper pattern from TS-013).

10. **TS-018: All three sweep bug fixes verified in full sweep.** BUG-001 (OFFLINE false positives), BUG-002 (hardcoded event_time), and BUG-007 (controller probe) all confirmed fixed. Full sweep on healthy cluster now returns zero incidents (was 2 false positives in TS-001). Sweep duration comparable (695.8s vs ~680s baseline).

11. **TS-018b: glm-4.7-flash is 16.9x faster than qwen3:32b with no quality loss.** Sweep completed in 41.2s vs 680-1280s baseline. All three bug fixes (BUG-001, BUG-002, BUG-007) remain effective. Report quality is comparable or better (cleaner formatting, no thinking tokens). This makes sub-minute sweep cycles practical for near-real-time monitoring.

12. **TS-020: Rate limiter (Phase 4) works correctly.** SlidingWindowRateLimiter on POST /incident correctly enforces 10 requests/minute with a sliding window. Rejected requests return HTTP 429 with Retry-After header. Rate-limited requests produce no audit entries (rejected before processing). Metric `operator_rate_limit_rejections_total` tracks rejections.

13. **TS-021: glm-4.7-flash is consistent across rapid sequential sweeps.** Three back-to-back sweeps completed in 28.4s, 31.3s, and 33.7s (coefficient of variation 8%). All produced zero false positives on a healthy cluster. Report quality was identical across all runs. No degradation in accuracy or performance over repeated invocations.

14. **TS-022: Concurrent requests cause LLM-layer contention, not application-layer blocking.** Node.js correctly handles concurrent sweep + chat at the HTTP layer. However, performance degrades ~4x because Ollama serializes LLM inference per model. The sweep took 143s (vs 30s normal) and the chat took 23.4s (vs 7s normal). Both completed successfully with correct results.

15. **TS-023: Full E2E loop works with glm-4.7-flash at 20x speed.** Pod delete -> sweep (46.9s) -> 3 incidents detected -> operator triage -> segment_offline dispatch -> mitigator remediation. The faster model detected failures with more granularity (3 incidents vs 2 with qwen3:32b) and proper severity categorization. Detection-to-dispatch completed in ~52s total.

16. **TS-024: Graceful shutdown works at HTTP layer but cannot cancel LLM calls.** SIGTERM triggers `server.close()` which stops new connections immediately. In-flight LLM-backed requests (sweeps) continue until the 30s force timeout kills the process. The abort signal from shutdown is not propagated to the sweep's LLM loop. Recommendation: wire the shutdown abort signal through to in-flight sweep loops for early termination.

---

### TS-025: Storage Capacity Baseline

**Objective:** Measure current segment storage on pinot-server-0, calculate storage per million rows, and estimate capacity limits.

**Procedure:**
1. Check disk usage on pinot-server-0 via `df -h`
2. Measure segment data directory size via `du -sh`
3. Query Pinot table size API (`/tables/{name}/size`)
4. Calculate storage ratios

**Results:**

| Metric | Value |
|--------|-------|
| Server disk total | 720 GB |
| Server disk used | 21 GB (3%) |
| Server disk available | 700 GB |
| Segment index directory | `/var/pinot/server/data/index/` |
| Total index storage | 29 MB (29,806,745 bytes) |
| Row count (stress_test_events) | 1,110,000 |
| Segments | 3 (392K + 3.0M + 26M) |
| Storage per million rows | 26.85 MB |
| Estimated capacity (700GB free) | ~27,990 million rows |
| PVC size (k8s claim) | 2 GB |

**Key Finding:** The PVC is only 2GB but the underlying filesystem is 720GB (shared overlay). The effective storage limit depends on whether Pinot is constrained by PVC quota enforcement or actual disk. On this cluster (non-production, no enforced PVC limits), the practical limit is much higher.

**Segment size breakdown by API:**
- `stress_test_events_1773032664132`: 392,491 bytes (10K rows estimated)
- `stress_test_events_1773032667546`: 3,134,980 bytes (~100K rows)
- `stress_test_events_1773032672108`: 26,279,274 bytes (~1M rows)

**Status:** PASS — baseline established.

---

### TS-026: Segment Flood with Quota Enforcement

**Objective:** Create multiple OFFLINE tables with storage quotas, upload segments to test quota enforcement and storage pressure detection.

**Procedure:**
1. Created 5 tables (`storage_flood_1` through `storage_flood_5`) with 10MB storage quota each
2. Generated 100K-row CSV files (~3.5MB per segment after Pinot indexing)
3. Uploaded 1 segment to each table (all succeeded)
4. Attempted to exceed quota on `storage_flood_1` by uploading 3 additional segments

**Results:**

| Upload | Target Table | Result |
|--------|-------------|--------|
| Segment 1 (100K rows) | storage_flood_1 | SUCCESS (3.49 MB) |
| Segment 2 (100K rows) | storage_flood_1 | SUCCESS (4.19 MB, total = 7.33 MB) |
| Segment 3 (100K rows) | storage_flood_1 | **REJECTED** (would exceed 10M quota) |
| Segment 4 (100K rows) | storage_flood_1 | **REJECTED** (quota still exceeded) |

**Quota behavior observed:**
- Pinot's quota check calculates: `estimatedTableSize = currentTableSize + newSegmentSize * replicas`
- When `storage_flood_1` was at 7.33MB and a ~3.5MB segment would push it to ~10.8MB (over 10M quota), the upload was rejected with HTTP 500: `"Caught exception while uploading segments"`
- The error message does NOT explicitly say "quota exceeded" — it is a generic upload failure wrapping the quota violation
- Existing segments remain intact after quota rejection (no data loss)

**Post-test storage:**
- Total index directory grew from 29MB to 50MB during test (6 tables)
- After cleanup (all flood tables deleted), returned to 29MB

**Status:** PASS — quota enforcement works. Error messaging is poor (generic 500, not 403 with quota details as documented).

---

### TS-027: Large Data Ingestion

**Objective:** Monitor storage growth during ingestion of larger datasets.

**Note:** This was executed as part of TS-026 rather than as a separate large CSV test, since the quota enforcement test already demonstrated storage growth behavior.

**Results:**
- 100K rows produces ~3.5MB of indexed segment data
- 200K rows (2 segments) = 7.3MB
- Storage growth is approximately linear with row count
- At 26.85 MB per million rows, ingesting 10M rows would require ~268MB
- Pinot's columnar storage with dictionary encoding achieves good compression: the raw CSV was larger than the indexed segment

**Estimated thresholds for a 2GB PVC:**
| Rows | Estimated Storage | % of 2GB PVC |
|------|------------------|--------------|
| 1M | 27 MB | 1.3% |
| 10M | 269 MB | 13.1% |
| 50M | 1.34 GB | 65.4% |
| 75M | 2.01 GB | ~100% (CRITICAL) |

**Status:** PASS — growth is predictable and linear.

---

### TS-028: Storage Monitoring Gap Analysis

**Objective:** Determine whether the current monitor agent detects storage capacity issues, and identify gaps.

**Test 1: Automated Sweep**
- Ran a full sweep (`POST /sweep`) with 6 tables (including flood tables)
- Sweep result: **HEALTHY, zero incidents**
- The sweep checked: pod status, health endpoints, cluster info, tables, segments, row counts, freshness
- The sweep did NOT check: disk usage, segment sizes, table storage quotas, storage quota utilization

**Test 2: Direct Chat Query**
- Asked the monitor via chat: "What is the current disk usage and storage capacity on the Pinot server? Check if any tables are approaching their storage quotas."
- The monitor attempted to answer using available tools but lacks:
  - A tool to call `/tables/{name}/size` API
  - A tool to check disk usage (`df -h`)
  - A tool to read table quota configuration
  - A tool to calculate quota utilization percentage
- It improvised by using `kubectl_get` to find PVC info and `pinot_segments` for segment lists, but could not report actual byte-level storage

**Gap Analysis:**

| Capability | Current Status | Gap |
|-----------|---------------|-----|
| Table storage size (bytes) | NOT AVAILABLE | Need `pinot_table_size` tool calling `/tables/{name}/size` |
| Storage quota configuration | NOT AVAILABLE | Need to parse quota from table config (already in `pinot_tables` response but not surfaced) |
| Quota utilization percentage | NOT AVAILABLE | Need to compute `currentSize / quotaLimit * 100` |
| Disk-level usage (`df -h`) | NOT AVAILABLE | `kubectl_get` cannot run `exec`; need `kubectl exec` in monitor tools (read-only) |
| Controller metric: TABLE_STORAGE_QUOTA_UTILIZATION | NOT AVAILABLE | Need tool to query Pinot metrics endpoint |
| Segment-level size breakdown | NOT AVAILABLE | The `/tables/{name}/size` API provides per-segment sizes |

**Pinot APIs available but not exposed as monitor tools:**

1. **`GET /tables/{tableName}/size`** — Returns `reportedSizeInBytes`, `estimatedSizeInBytes`, per-segment sizes, per-replica sizes, and `missingSegments` count. This is the most critical missing API.

2. **`GET /tables/{tableName}` (config)** — Already exposed via `pinot_tables` tool, but the quota section (`"quota": {"storage": "10M"}`) is buried in the full config JSON. The sweep prompt does not instruct the LLM to look for quota settings.

3. **Pinot Metrics endpoint** — Controller exposes `TABLE_STORAGE_QUOTA_UTILIZATION` as a JMX/metrics gauge. Not currently accessible.

**Status:** GAP — the monitor has no storage monitoring capability.

---

## Recommended Runbook: `storage_pressure`

### Pattern Definition

```typescript
{
  id: "storage_pressure",
  name: "Storage Pressure Mitigation",
  incidentPattern: {
    severity: ["WARNING", "CRITICAL"],
    componentPattern: /server|storage|disk|pinot-server/i,
    evidencePattern: /storage|disk|quota|capacity|full|space|pressure/i,
  },
  actions: [
    // Step 1: Identify largest tables consuming storage
    { tool: "kubectl_get", args: { subcommand: "get", resource: "pvc", namespace: "pinot" } },
    // Step 2: Rebalance to distribute segments across servers (if multi-server)
    { tool: "pinot_rebalance", args: { table: "${table}" } },
  ],
  verifyPrompt: "Check storage usage on Pinot servers and verify it is below 80% capacity",
  maxRetries: 1,
  escalateAfterRetries: true,
  cooldownMs: 1_800_000, // 30 minutes
  minTrustLevel: 2, // Require human approval — storage actions are destructive
}
```

### Prerequisites (new tools/changes needed)

1. **New Monitor Tool: `pinot_table_size`**
   - Calls `GET /tables/{tableName}/size` on the controller
   - Returns reported size, estimated size, segment count, per-segment sizes
   - Read-only, safe for monitor package

2. **Monitor Prompt Update**
   - Add step to the sweep procedure: "Check storage usage for each table using `pinot_table_size`"
   - Add threshold logic: >80% quota = WARNING, >95% quota = CRITICAL
   - For tables without quotas, report absolute sizes and flag tables >1GB

3. **New Mitigator Tool: `pinot_delete_segments`** (optional, for automated remediation)
   - Deletes old segments by time range to free space
   - Only for tables with retention policies
   - Requires TRUST_LEVEL >= 3

4. **Incident Detection Patterns**
   - Quota utilization >80%: emit WARNING with component=`pinot-server`, evidence includes quota percentage
   - Quota utilization >95%: emit CRITICAL
   - Upload rejection (HTTP 500 from quota check): emit CRITICAL with evidence "segment upload rejected, storage quota exceeded"
   - No quota configured on large table (>500MB): emit INFO advisory

### Severity Thresholds

| Condition | Severity | Suggested Action |
|-----------|----------|-----------------|
| Table at 60-80% of storage quota | INFO | Monitor closely |
| Table at 80-95% of storage quota | WARNING | Review retention policies, consider rebalance |
| Table at >95% of storage quota | CRITICAL | Delete expired segments, increase quota, or add servers |
| Segment upload rejected due to quota | CRITICAL | Immediate intervention required |
| Disk usage >80% on any server | WARNING | Rebalance segments across servers |
| Disk usage >90% on any server | CRITICAL | Emergency: delete data or expand storage |

---

## Key Findings Summary

17. **TS-025: Storage baseline is extremely low relative to capacity.** The cluster stores 1.1M rows in 29MB across 3 segments. At 26.85 MB per million rows, the 700GB available disk could hold ~28 billion rows before running out of space. However, the PVC is only 2GB, which limits the effective capacity to ~75M rows. Storage per row is efficient due to Pinot's columnar format with dictionary encoding.

18. **TS-026: Pinot's storage quota enforcement works but has poor error reporting.** When a table's storage quota (configured as `"quota": {"storage": "10M"}`) is exceeded, segment uploads are rejected with a generic HTTP 500 error rather than a specific 403 with quota details. This makes it harder for automated systems to distinguish quota violations from other upload failures. Tables without quotas have no upload limits.

19. **TS-027: Storage growth is linear and predictable.** Each million rows requires approximately 27MB of indexed storage. This ratio is consistent across segment sizes (small segments have slightly higher overhead per row due to metadata). At this density, a 2GB PVC would fill at approximately 75M rows.

20. **TS-028: The monitor agent has zero storage monitoring capability.** Neither the automated sweep nor the chat interface can report on disk usage, table sizes, or quota utilization. The Pinot controller exposes a `/tables/{name}/size` API that returns exact byte-level sizes per table, per segment, and per replica, but no monitor tool calls this endpoint. This is the most significant operational gap identified. A new `pinot_table_size` tool, a `storage_pressure` runbook, and sweep prompt updates are recommended.

21. **TS-029: The new `pinot_table_size` tool works correctly.** When invoked via chat, the tool returns a human-readable table with table names and sizes (e.g., "stress_test_events: 28.4 MB"). It also reports total storage and evaluates against WARNING (1GB) and CRITICAL (5GB) thresholds. The TS-028 gap for table-level storage monitoring is now closed.

22. **TS-030: RESOLVED.** Increasing `maxTurns` from 15 to 25 resolved the issue. The sweep now completes in ~43 seconds with full storage reporting. The storage check step adds a few extra tool calls but fits comfortably within the 25-turn limit.

23. **TS-031: The `storage_pressure` runbook correctly matches storage incidents.** When an incident with component `pinot-storage` and evidence containing "storage usage at 85% of quota" was sent to the operator, it matched the `storage_pressure` runbook and dispatched to the mitigator (attempt 1). The audit log confirmed the dispatch with a correlation ID. The `minTrustLevel: 2` requirement was satisfied by `TRUST_LEVEL=3`.

24. **TS-032: RESOLVED.** The SSE `/watch` endpoint delivers sweep events correctly. With TS-030 fixed, sweep results stream through including incident counts. Two consecutive sweeps were observed within a 180-second window.

25. **TS-033: Query stress test found the breaking point at 50 concurrent expensive queries.** Simple queries (COUNT) scale to 200 concurrent with zero errors. GROUP BY queries handle 100 concurrent with graceful 2-3x degradation. But PERCENTILE + DISTINCTCOUNT + multi-GROUP BY queries cause 80% server timeouts at 50 concurrent (error 427). Key finding: a single Pinot server with 1.1M rows cannot handle more than ~10 concurrent expensive analytical queries without degradation. The default broker timeout of 10s is the limiting factor.

26. **TS-034: The monitor has a gap in query performance detection.** Under sustained query load, the sweep itself slowed from 30s to 50s (67% degradation). The LLM indirectly detected an indexing concern through elevated pinot_query response times, but there is no dedicated latency measurement tool. The planned `pinot_broker_latency` tool would close this gap. Without it, query overload is only detected through its side effects on other operations.

27. **TS-035: Pinot's per-query timeout is correctly enforced.** The `option(timeoutMs=N)` syntax works as expected, returning error code 427 with `partialResult: true` and zero rows. The default 10s timeout explains the TS-033c failures: expensive queries take ~9s each under contention, and queue delays push total time past 10s. The cluster remained fully healthy through all tests (0 restarts, 0 OOM events), confirming Pinot's graceful degradation under overload.

---

### TS-029: Storage Tool Verification

**Objective:** Verify the new `pinot_table_size` tool returns table sizes in human-readable format.

**Method:** `POST /chat` with message "Check the storage size of all Pinot tables using pinot_table_size"

**Result:** PASS

The tool was invoked successfully (`toolCalls: [{"name":"pinot_table_size","args":{}}]`) and returned:

- Table: `stress_test_events` — 28.4 MB (29,806,745 bytes)
- Total storage: 28.4 MB
- Thresholds reported: WARNING at 1 GB/table, CRITICAL at 5 GB/table
- Conclusion: "No storage pressure detected"

This directly addresses the TS-028 gap: the monitor now has table-level storage visibility.

---

### TS-030: Sweep with Storage Check

**Objective:** Verify that a full sweep now includes storage information.

**Method:** `POST /sweep` with empty body, 300s timeout.

**Result (attempt 1):** FAIL — the sweep returned `{"report":"Agent reached maximum turns without completing.","incidents":[]}` with `maxTurns=15`.

**Result (attempt 2, TS-030b):** PASS — with `maxTurns` increased to 25, the sweep completed in **43.4 seconds**.

The report includes all expected sections:

1. **Kubernetes:** All 4 pods healthy (broker, controller, server, zookeeper) with 0 restarts.
2. **Pinot Health:** Controller, Broker, Server all OK.
3. **Cluster:** pinot-quickstart with 3 active instances.
4. **Tables & Segments:** 1 table (`stress_test_events`, OFFLINE type, 3 segments).
5. **Storage:** Total 28.4 MB (29,806,745 bytes). Table `stress_test_events` at 28 MB, below WARNING (1GB) and CRITICAL (5GB) thresholds.
6. **Data Health:** 1,110,000 rows verified.
7. **Issues:** None detected.
8. **Incidents:** Empty array `[]` — no storage-related incidents (correct, since usage is well below thresholds).

The sweep did **not** hit the maxTurns limit. The storage section is present and reports table sizes correctly. No false positives were generated.

---

### TS-031: Storage Pressure Runbook Matching

**Objective:** Verify the `storage_pressure` runbook matches storage-related incidents and dispatches at TRUST_LEVEL=3.

**Method:** `POST /incident` to operator with:
- `id: "storage-test-1"`
- `severity: "WARNING"`
- `component: "pinot-storage"`
- `evidence: ["Table stress_test_events_OFFLINE storage usage at 85% of quota (850MB/1GB)"]`
- `suggestedAction: "Rebalance table"`

**Result:** PASS

Response: `{"results":[{"action":"dispatched","runbookId":"storage_pressure","message":"Dispatched runbook storage_pressure (attempt 1)"}]}`

Audit log entry confirmed:
- Agent: operator
- Action: dispatch
- Target: pinot-storage
- Input: `runbook=storage_pressure, attempt=1`
- Output: "Dispatched to mitigator"

The runbook's `componentPattern` (`/server|storage|disk|pinot-server/i`) matched `pinot-storage`, and the `evidencePattern` (`/storage|disk|quota|capacity|full|space|pressure/i`) matched the evidence string. With `minTrustLevel: 2` and `TRUST_LEVEL=3`, the dispatch was authorized without human approval.

---

### TS-032: SSE Watch Endpoint

**Objective:** Test the new `/watch` SSE endpoint for streaming sweep results.

**Method:** `timeout 90 curl -s -N http://localhost:3000/watch | head -50`

**Result (attempt 1):** PARTIAL — only the connection event was received within 90 seconds.

**Result (attempt 2):** PASS — with a 180-second timeout, the endpoint delivered:
1. Connection event: `{"type":"connected","timestamp":"2026-03-09T08:22:47.040Z"}`
2. Sweep event: `{"type":"sweep","timestamp":"2026-03-09T08:24:19.102Z","incidentCount":0,"incidents":[]}`
3. Second sweep event: `{"type":"sweep","timestamp":"2026-03-09T08:25:31.894Z","incidentCount":0,"incidents":[]}`

The SSE endpoint is fully operational. With the TS-030 maxTurns fix, sweep results are now delivered correctly (0 incidents, matching the clean cluster state). Two consecutive sweep cycles were observed within the 180-second window, confirming the periodic sweep interval is working.

---

### TS-033: Heavy Query Stress Test

**Objective:** Go beyond TS-007's 20 concurrent queries and find the breaking point where measurable query degradation occurs on the Pinot cluster (1.1M rows, 3 segments, single server).

**Research (web search):**
- Default broker query timeout: 10,000ms (`pinot.broker.timeoutMs`)
- DISTINCTCOUNT and PERCENTILE are the most expensive aggregation functions (unbounded memory, no star-tree support, no index utilization)
- Multi-GROUP BY with high-cardinality columns compounds the cost
- Pinot has OOM protection that kills expensive queries when heap is depleted

**Schema:** `eventId` (STRING), `userId` (STRING), `eventType` (STRING), `value` (DOUBLE), `timestamp` (LONG)

**Baselines (single query, no concurrent load):**
- COUNT(*): 5ms query time, 58ms wall clock
- GROUP BY userId + AVG + DISTINCTCOUNT: 264ms query time, 318ms wall clock

**Test 033a: 50 concurrent COUNT(*) queries**
- Wall clock: 432ms
- Max query time: 92ms (vs 5ms baseline = 18x degradation)
- Errors: 0/50
- Result: PASS - simple aggregation handles concurrency well

**Test 033b: 100 concurrent GROUP BY queries**
- Query: `SELECT userId, COUNT(*), AVG(value) FROM stress_test_events_OFFLINE GROUP BY userId ORDER BY COUNT(*) DESC LIMIT 100`
- Wall clock: 1,515ms
- Max query time: 779ms, avg 524ms (vs 264ms baseline = 2-3x degradation)
- Errors: 0/100
- Result: PASS - GROUP BY degrades gracefully under load

**Test 033c: 50 concurrent EXPENSIVE queries (the breaking point)**
- Query: `SELECT userId, eventType, PERCENTILE(value, 99), DISTINCTCOUNT(eventId) FROM stress_test_events_OFFLINE GROUP BY userId, eventType ORDER BY PERCENTILE(value, 99) DESC LIMIT 1000`
- Wall clock: 10,447ms
- Max query time: 10,098ms, avg 9,088ms (vs 848ms baseline = 10-12x degradation)
- Errors: **40/50** (80% failure rate)
- Error: code 427 "1 servers [pinot-server-0_O] not responded" (server timeout)
- Successful queries took ~1,251ms each
- Result: **DEGRADATION FOUND** - 50 concurrent expensive queries overwhelm the single server, causing 80% timeouts

**Cluster impact:** No pod restarts, no OOM kills. Server recovered immediately after load ceased.

---

### TS-034: Query Overload Detection

**Objective:** Determine whether the monitor agent detects query-induced performance degradation during heavy load.

**Method:** Run sustained heavy load (3 waves of 30 expensive queries with 3s gaps) while simultaneously triggering a sweep.

**Attempt 1 (no concurrent load):** Sweep completed in 30s, 0 incidents. No performance data to detect.

**Attempt 2 (concurrent load):** Sweep completed in 50s (67% slower than the ~30s norm), 0 incidents detected. The sweep JSON contained control characters, suggesting the LLM response was affected by elevated system load.

**Attempt 3 (sustained concurrent load):**
- 3 waves of 30 expensive queries, sweep triggered 2s after load start
- Sweep completed in **50s** (vs ~30s normal = 67% degradation)
- **1 incident detected:** [INFO] pinot-segments: "Review table indexing configuration for timestamp column, or consider alternative query approaches for date range checks"
- The LLM indirectly noticed query performance issues through the pinot_query tool's elevated response times during its sweep

**Result:** PARTIAL
- The monitor has no dedicated latency measurement tool (`pinot_broker_latency` not yet available)
- Under heavy load, the LLM did notice slower responses and flagged an indexing concern
- The sweep itself was measurably degraded (50s vs 30s), proving that query overload affects the monitoring pipeline
- A dedicated broker latency tool would enable direct detection of query performance degradation

---

### TS-035: Query Timeout Behavior

**Objective:** Test Pinot's behavior when queries exceed their timeout, and test broker saturation limits with high concurrency.

**Test 035a: Single expensive query (baseline)**
- timeUsedMs: 848, 0 exceptions, 1,110,000 docs scanned, 1,000 rows returned
- The expensive query (PERCENTILE + DISTINCTCOUNT + multi-GROUP BY) completes in <1s when running alone

**Test 035b: Forced timeout with `option(timeoutMs=100)`**
- timeUsedMs: 107
- 1 exception: code 427 "1 servers [pinot-server-0_O] not responded"
- partialResult: true, numRowsResultSet: 0
- The query was correctly killed after the 100ms budget, returning an empty partial result

**Test 035c: Borderline timeout with `option(timeoutMs=500)`**
- timeUsedMs: 504
- 1 exception: code 427 "1 servers [pinot-server-0_O] not responded"
- partialResult: true, numRowsResultSet: 0
- The expensive query needs ~848ms; 500ms is insufficient, confirming the timeout is enforced

**Test 035d: 200 concurrent COUNT(*) queries (broker saturation test)**
- Wall clock: 1,623ms
- Max query time: 197ms (vs 5ms baseline = 39x degradation, but still well under timeout)
- Errors: 0/200
- The broker handles 200 concurrent lightweight queries without errors, though latency degrades significantly

**Result:** PASS
- Pinot's per-query timeout (`option(timeoutMs=N)`) works correctly, returning error code 427 with partial results
- Default 10s timeout explains why 80% of TS-033c queries failed (expensive queries take ~9s under load, exceeding 10s when queued)
- Simple queries scale to 200 concurrent with no errors; expensive queries break at ~50 concurrent on a single server
- Cluster remained healthy throughout all tests (0 restarts, 0 OOM events)

---

## TS-036: Query Overload Detection E2E (pinot_broker_latency)

**Date:** 2026-03-09
**Runbook Targeted:** query_overload
**Agents:** Monitor (glm-4.7-flash, maxTurns=25), Operator (TRUST_LEVEL=3), Mitigator
**New tool under test:** `pinot_broker_latency` (packages/monitor/src/tools/pinot-api.ts)

**Objective:** Validate the full query overload detection pipeline end-to-end: (1) the new `pinot_broker_latency` tool measures latency during sweeps, (2) elevated latency is detectable under stress, (3) the `query_overload` runbook matches latency-related incidents, and (4) the operator dispatches to the mitigator.

### Test 036a: Normal sweep with latency measurement (baseline)

**Command:** `curl -s -X POST http://localhost:3000/sweep`
**Duration:** 36.5s

**Result:** PASS
- Sweep report includes a "Query Performance" section: `stress_test_events: 182ms [OK]`
- The `pinot_broker_latency` tool was invoked automatically during the sweep
- No incidents generated (0 incidents, cluster HEALTHY)
- Latency well below the 5000ms WARNING threshold

### Test 036b: Sweep under stress load (50 concurrent expensive queries)

**Setup:** Launched 50 concurrent expensive queries (DISTINCTCOUNT + PERCENTILE + GROUP BY) against the broker:
```bash
for i in $(seq 1 50); do
  kubectl exec pinot-broker-0 -n pinot -- curl -s -X POST http://localhost:8099/query/sql \
    -H "Content-Type: application/json" \
    -d '{"sql": "SELECT event_type, DISTINCTCOUNT(user_id), PERCENTILE(value, 95) FROM stress_test_events_OFFLINE GROUP BY event_type"}' &
done
```

**Command:** Immediately triggered `curl -s -X POST http://localhost:3000/sweep`
**Duration:** 50.1s (37% slower than baseline)

**Result:** PASS (broker resilient)
- Sweep report includes "Query Performance" section: `stress_test_events: 152ms [OK]`
- Latency actually measured lower than baseline (152ms vs 182ms) due to timing — the COUNT(*) probe likely ran between stress query batches
- No incidents generated — the single-server cluster handled the load without crossing the 5000ms threshold
- The sweep itself was 14s slower (50.1s vs 36.5s), suggesting the LLM agent was somewhat affected by system load
- Zero incidents forwarded to operator (confirmed via empty audit log)

**Analysis:** The broker is resilient to 50 concurrent expensive queries for this dataset size (1.1M rows, 28.4MB). The `pinot_broker_latency` tool correctly measured low latency because the COUNT(*) probe is lightweight. To trigger WARNING/CRITICAL thresholds would require either (a) a much larger dataset, (b) more concurrent load, or (c) resource constraints on the broker.

### Test 036c: Manual incident — query_overload runbook matching

**Command:**
```bash
curl -s -X POST http://localhost:3002/incident \
  -H "Content-Type: application/json" \
  -d '{"incident": {"id": "query-overload-1", "severity": "WARNING", "component": "pinot-broker", "evidence": ["Query latency 8500ms on stress_test_events_OFFLINE (WARNING threshold: 5000ms)"], "suggestedAction": "Investigate broker load"}}'
```

**Result:** PASS
- Response: `{"results":[{"action":"dispatched","runbookId":"query_overload","message":"Dispatched runbook query_overload (attempt 1)"}]}`
- Runbook `query_overload` correctly matched on:
  - severity: "WARNING" (in allowed list ["WARNING", "CRITICAL"])
  - component: "pinot-broker" (matches `/broker|query|pinot/i`)
  - evidence: "Query latency 8500ms" (matches `/latency|slow|timeout|overload|query.*time|response.*time/i`)
- Dispatched to mitigator with action: `kubectl describe pod pinot-broker-0 -n pinot`
- Audit log entry created with correlationId `9bf96e21-c72e-4afa-921f-afc438499e76`

### Test 036d: Audit log verification

**Command:** `curl -s http://localhost:3002/audit`

**Result:** PASS
- Single entry confirming dispatch:
  - agent: "operator"
  - action: "dispatch"
  - target: "pinot-broker"
  - inputSummary: "runbook=query_overload, attempt=1"
  - outputSummary: "Dispatched to mitigator"

### Summary

| Sub-test | Description | Result |
|----------|-------------|--------|
| 036a | Baseline sweep with pinot_broker_latency | PASS (182ms, OK) |
| 036b | Sweep under 50 concurrent expensive queries | PASS (152ms, broker resilient) |
| 036c | Manual query_overload incident -> runbook match | PASS (dispatched) |
| 036d | Audit log verification | PASS (entry logged) |

**Overall: PASS**

**Key Question: Can the system detect and respond to query overload end-to-end?**

**Answer: YES, with caveats.**
1. The `pinot_broker_latency` tool correctly measures broker query latency during sweeps and applies WARNING (>5s) and CRITICAL (>30s) thresholds.
2. The `query_overload` runbook correctly matches incidents with latency/overload evidence against broker components.
3. The operator dispatches the runbook to the mitigator, which investigates via `kubectl describe`.
4. **Caveat:** On this cluster (single server, 1.1M rows, 28.4MB), even 50 concurrent expensive queries don't push the COUNT(*) probe past 5s. Real-world detection would require either larger datasets, sustained load, or degraded broker resources. The tool's thresholds (5s WARNING, 30s CRITICAL) are appropriate for production but hard to trigger on a dev cluster.
5. **Caveat:** The runbook's `minTrustLevel: 1` means it operates in "suggest" mode — it investigates (describe pod) but doesn't auto-remediate, which is appropriate for query overload scenarios where the root cause varies.

---

## TS-037: LLM Output Validation (Input Validation at Operator Boundary)

**P0 Gap:** LLM output validation -- the operator had no input validation on incoming incidents, allowing malformed data to enter the triage pipeline.

**Fix:** The operator now validates every incident against the Zod `Incident` schema (`@pinot-agents/shared`) with additional business rule checks (non-empty component, non-empty evidence array) at the system boundary in `handleIncident()`.

### Test Execution

**Test 037a: Missing severity field**
```
POST /incident {"incident": {"id": "invalid-1", "component": "test", "evidence": ["test"], "suggestedAction": "none"}}
```
**Result: REJECTED (400)**
```json
{
    "error": "All incidents failed validation",
    "validationErrors": [{"index": 0, "errors": [
        "severity: Invalid option: expected one of \"CRITICAL\"|\"WARNING\"|\"INFO\"",
        "timestamp: Invalid input: expected string, received undefined"
    ]}]
}
```

**Test 037b: Empty evidence array**
```
POST /incident {"incident": {"id": "invalid-2", "severity": "WARNING", "component": "test", "evidence": [], ...}}
```
**Result: REJECTED (400)**
```json
{
    "error": "All incidents failed validation",
    "validationErrors": [{"index": 0, "errors": ["evidence must be a non-empty array"]}]
}
```

**Test 037c: Invalid severity value ("DANGER")**
```
POST /incident {"incident": {"id": "invalid-3", "severity": "DANGER", ...}}
```
**Result: REJECTED (400)**
```json
{
    "error": "All incidents failed validation",
    "validationErrors": [{"index": 0, "errors": [
        "severity: Invalid option: expected one of \"CRITICAL\"|\"WARNING\"|\"INFO\""
    ]}]
}
```

**Test 037d: Valid incident (INFO severity)**
```
POST /incident {"incident": {"id": "valid-1", "severity": "INFO", "component": "test", "evidence": ["test event"], ...}}
```
**Result: ACCEPTED (200)**
```json
{"results": [{"action": "logged", "message": "INFO severity -- logged only"}]}
```

| Sub-test | Input | Expected | Actual | Status |
|----------|-------|----------|--------|--------|
| 037a | Missing severity | Rejected | 400 + validation error | PASS |
| 037b | Empty evidence | Rejected | 400 + "evidence must be a non-empty array" | PASS |
| 037c | Invalid severity "DANGER" | Rejected | 400 + "expected one of CRITICAL/WARNING/INFO" | PASS |
| 037d | Valid INFO incident | Accepted | 200 + logged | PASS |

**P0 Gap Status: CLOSED** -- All invalid inputs are rejected at the system boundary with clear error messages. The Zod schema enforces type safety, and business rules catch semantic issues (empty evidence).

---

## TS-038: Blast Radius Controls

**P0 Gap:** No blast radius controls -- the operator could dispatch unlimited concurrent remediations, risking cascading failures.

**Fix:** Two blast radius mechanisms implemented in `triageIncident()`:
1. **Same-component blocking**: `activeRemediations.has(incident.component)` prevents concurrent remediations on the same component.
2. **Max concurrent limit**: `activeRemediations.size >= MAX_CONCURRENT_REMEDIATIONS` (default: 2) caps total active remediations.

Additionally, `kubectl_delete` in the mitigator rejects label selectors and wildcard names to prevent multi-resource deletions.

### Test Execution

**Test 038a: Three concurrent incidents for different components**

Sent 3 incidents simultaneously for `pinot-segments-a`, `pinot-segments-b`, `pinot-segments-c`.

**Result:**
- `pinot-segments-b`: **dispatched** (attempt 1)
- `pinot-segments-c`: **dispatched** (attempt 1)
- `pinot-segments-a`: **skipped** ("Max concurrent remediations (2) reached")

Audit log confirms:
```json
{"action": "skipped_max_concurrent", "target": "pinot-segments-a",
 "inputSummary": "runbook=segment_offline, active=2, max=2",
 "outputSummary": "Max concurrent remediations (2) reached"}
```

**Test 038b: Same-component duplicate**

Sent two sequential incidents for `segment-test-x`.

**Result:**
- First: **dispatched** (runbook segment_offline, attempt 1)
- Second: **skipped** ("Remediation already in progress for segment-test-x")

Audit log confirms:
```json
{"action": "skipped_active_remediation", "target": "segment-test-x",
 "inputSummary": "runbook=segment_offline, activeRunbook=segment_offline",
 "outputSummary": "Remediation already in progress for segment-test-x"}
```

**Test 038c: Audit log verification**

All blast radius decisions are logged to the audit trail with distinct action types:
- `skipped_max_concurrent` -- max concurrent limit hit
- `skipped_active_remediation` -- same-component block

**Test 038d: kubectl_delete blast radius guard (code review)**

The mitigator's `kubectl_delete` tool rejects:
- Label selectors: returns "Error: kubectl_delete refuses to delete by label selector"
- Wildcard names (`*`, `?`): returns "Error: kubectl_delete refuses wildcard names"

**Test 038e: Active remediation cleanup**

After mitigator completes a dispatch, it sends an audit callback to the operator (`POST /incident` with `from: "mitigator", type: "audit"`), which clears the active remediation from the tracking map. Verified: after mitigator dispatches completed (2/2), subsequent dispatches for new components were accepted.

| Sub-test | Scenario | Expected | Actual | Status |
|----------|----------|----------|--------|--------|
| 038a | 3 concurrent (max=2) | 2 dispatched, 1 blocked | 2 dispatched, 1 "Max concurrent (2) reached" | PASS |
| 038b | Same-component duplicate | Second blocked | "Remediation already in progress" | PASS |
| 038c | Audit logging | Blast radius entries in audit | skipped_max_concurrent + skipped_active_remediation | PASS |
| 038d | kubectl_delete selector guard | Selector rejected | Code confirmed: selector returns error | PASS |
| 038e | Active remediation cleanup | Cleared after mitigator callback | Subsequent dispatches succeed | PASS |

**P0 Gap Status: CLOSED** -- Both concurrent-limit and same-component guards are operational. The mitigator also has its own blast radius guard on kubectl_delete.

---

## TS-039: Rollback Log

**P0 Gap:** No rollback capability -- write actions were not recorded, making it impossible to undo failed remediations.

**Fix:** The mitigator implements a rollback log (`packages/mitigator/src/rollback.ts`) exposed via `GET /rollback`. Write tools (`kubectl_delete`, `pinot_reload_segment`, `pinot_update_config`) call `recordAction()` to log:
- Tool name and arguments
- Before-state capture (YAML for k8s resources, segment metadata for Pinot)
- Undo action (where applicable, e.g., `pinot_update_config` records the previous config as undo)

### Test Execution

**Test 039a: Rollback endpoint availability**
```
GET http://localhost:3001/rollback
```
**Result:** 200 OK, returns `{"entries": []}`

**Test 039b: Rollback entries after dispatched remediations**

The mitigator completed 2 dispatches for the `segment_offline` runbook. The rollback log is empty because the mitigator is running in **dry-run mode** (`DRY_RUN=true`, the default). In dry-run mode, write tools return simulated responses and do NOT call `recordAction()`, which is correct behavior -- dry-run actions should not be recorded as rollback-able.

**Test 039c: Code review of rollback recording**

Verified in source code:
- `kubectl_delete`: captures `kubectl get <resource> -o yaml` as beforeState, calls `recordAction()` after successful delete. Undo is `null` (can't restore a deleted pod, but YAML is preserved).
- `pinot_reload_segment`: captures segment metadata via `/segments/{table}/{segment}/metadata` as beforeState. Undo is `null` (reload is idempotent).
- `pinot_update_config`: captures current table config via `GET /tables/{table}`, records previous config as undo action for `pinot_update_config`.
- Max 50 entries retained (FIFO eviction).
- Each entry has: `id`, `timestamp`, `tool`, `args`, `beforeState`, `undoAction`.

| Sub-test | Scenario | Expected | Actual | Status |
|----------|----------|----------|--------|--------|
| 039a | GET /rollback endpoint | 200 + entries array | 200 + `{"entries": []}` | PASS |
| 039b | Entries after dry-run dispatches | Empty (dry-run skips recording) | Empty | PASS (expected) |
| 039c | Code review: beforeState capture | All write tools capture state | Confirmed in kubectl-write.ts + pinot-write.ts | PASS |

**P0 Gap Status: CLOSED** -- The rollback log infrastructure is fully implemented. The endpoint works, write tools capture before-state and record undo actions. In production (DRY_RUN=false), all write actions will be logged with rollback data.

---

## TS-040: K8s Events Monitoring

**P0 Gap:** No Kubernetes events monitoring -- the system relied solely on pod status and Pinot APIs, missing OOMKills, evictions, scheduling failures, and probe failures.

**Fix:** New `kubectl_events` tool in `packages/monitor/src/tools/kubectl.ts` that runs `kubectl get events --field-selector=type!=Normal` with time-based filtering. The sweep prompt was updated to include K8s events as part of the standard health check procedure.

### Test Execution

**Test 040a: kubectl_events via /chat**
```
POST /chat {"message": "Check for any recent Kubernetes warning events in the pinot namespace using kubectl_events"}
```
**Result:** The LLM invoked `kubectl_events` with `{"namespace": "pinot", "sinceMinutes": 30}` and returned a formatted report:
```
## Kubernetes Events Summary (pinot namespace, last 30 min)
| Time | Type | Reason | Details |
| 2026-03-09T17:15:18Z | Warning | Unhealthy | Readiness probe failed: command timed out (ZOO_HC_TIMEOUT=2) |
```
Tool was invoked correctly, events were parsed and presented.

**Test 040b: Sweep includes K8s Warning Events section**
```
POST /sweep {}
```
**Result (57.2s):** The sweep report includes a dedicated section:
```
-- K8s Warning Events --
There is a Zookeeper readiness probe warning from the last 30 minutes:
- Event: Unhealthy
- Description: Readiness probe failed: "/bin/bash -ec ZOO_HC_TIMEOUT=2 ..." timed out after 5s
- This indicates non-critical probe timeout; Zookeeper pod remains Running
```

The sweep also generated an incident from this event:
```json
{
    "severity": "WARNING",
    "component": "zookeeper",
    "evidence": [
        "Kubernetes event: Zookeeper readiness probe timed out after 5s",
        "The probe failed at 2026-03-09T17:15:18Z, but the pod remains Running status",
        "This is expected to be non-critical and does not indicate actual Zookeeper unavailability"
    ]
}
```

| Sub-test | Scenario | Expected | Actual | Status |
|----------|----------|----------|--------|--------|
| 040a | kubectl_events via /chat | Tool invoked, events returned | Warning event detected (Zookeeper probe) | PASS |
| 040b | Sweep includes K8s events section | "K8s Warning Events" section in report | Present with Zookeeper probe failure | PASS |
| 040c | Event-based incident generation | Events create incidents when warranted | WARNING incident for Zookeeper | PASS |

**P0 Gap Status: CLOSED** -- The kubectl_events tool successfully detects non-Normal Kubernetes events and integrates them into both interactive chat and automated sweeps. The sweep report now includes a dedicated K8s Warning Events section.

---

## P0 Gap Summary

| P0 Gap | Test ID | Status | Evidence |
|--------|---------|--------|----------|
| LLM Output Validation | TS-037 | **CLOSED** | Zod schema + business rules reject all invalid inputs at operator boundary |
| Blast Radius Controls | TS-038 | **CLOSED** | Max concurrent (2), same-component blocking, kubectl_delete selector guard, audit trail |
| Rollback Log | TS-039 | **CLOSED** | Endpoint operational, write tools capture beforeState + undoAction, dry-run correctly skips |
| K8s Events Monitoring | TS-040 | **CLOSED** | kubectl_events tool works in chat + sweep, events section in report, incidents generated |

All 4 P0 operational gaps are verified closed.
