#!/bin/bash
# Query stress test for Pinot
# Runs multiple concurrent queries against the broker

BROKER="http://pinot-broker.pinot.svc.cluster.local:8099/query/sql"
RESULTS_FILE="/tmp/query_stress_results.txt"
> "$RESULTS_FILE"

run_query() {
  local label="$1"
  local sql="$2"
  local start_ms=$(date +%s%3N)
  local result=$(curl -s -X POST "$BROKER" \
    -H 'Content-Type: application/json' \
    -d "{\"sql\":\"$sql\"}")
  local end_ms=$(date +%s%3N)
  local elapsed=$((end_ms - start_ms))
  local docs=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('numDocsScanned',0))" 2>/dev/null)
  local errs=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('exceptions',[])))" 2>/dev/null)
  echo "$label | ${elapsed}ms | docs_scanned=$docs | errors=$errs" | tee -a "$RESULTS_FILE"
}

echo "=== Sequential Query Stress Test ==="
echo ""

echo "--- Simple Queries ---"
run_query "COUNT_ALL" "SELECT COUNT(*) FROM stress_test_events"
run_query "COUNT_BY_TYPE" "SELECT eventType, COUNT(*) FROM stress_test_events GROUP BY eventType"
run_query "AVG_VALUE" "SELECT AVG(value) FROM stress_test_events"

echo ""
echo "--- Medium Queries ---"
run_query "GROUP_BY_USER_TOP100" "SELECT userId, COUNT(*), AVG(value) FROM stress_test_events GROUP BY userId ORDER BY COUNT(*) DESC LIMIT 100"
run_query "FILTER_PURCHASE" "SELECT COUNT(*), AVG(value) FROM stress_test_events WHERE eventType = 'purchase'"
run_query "TIME_RANGE" "SELECT COUNT(*) FROM stress_test_events WHERE timestamp > 1710000000000 AND timestamp < 1711000000000"

echo ""
echo "--- Heavy Queries ---"
run_query "GROUP_BY_USER_10K" "SELECT userId, COUNT(*), AVG(value) FROM stress_test_events GROUP BY userId ORDER BY COUNT(*) DESC LIMIT 10000"
run_query "DISTINCT_USERS" "SELECT DISTINCTCOUNT(userId) FROM stress_test_events"
run_query "MULTI_AGG" "SELECT eventType, COUNT(*), AVG(value), MIN(value), MAX(value), SUM(value) FROM stress_test_events GROUP BY eventType ORDER BY COUNT(*) DESC"
run_query "PERCENTILE" "SELECT PERCENTILEEST(value, 50), PERCENTILEEST(value, 95), PERCENTILEEST(value, 99) FROM stress_test_events"

echo ""
echo "=== Concurrent Query Stress Test (10 parallel) ==="
echo ""

CONCURRENT_START=$(date +%s%3N)
for i in $(seq 1 10); do
  run_query "CONCURRENT_$i" "SELECT userId, COUNT(*), AVG(value) FROM stress_test_events GROUP BY userId ORDER BY COUNT(*) DESC LIMIT 1000" &
done
wait
CONCURRENT_END=$(date +%s%3N)
echo ""
echo "Total wall time for 10 concurrent queries: $((CONCURRENT_END - CONCURRENT_START))ms"

echo ""
echo "=== Heavy Concurrent Stress (20 parallel mixed queries) ==="
echo ""

HEAVY_START=$(date +%s%3N)
for i in $(seq 1 5); do
  run_query "HEAVY_GRP_$i" "SELECT userId, eventType, COUNT(*), AVG(value) FROM stress_test_events GROUP BY userId, eventType ORDER BY COUNT(*) DESC LIMIT 5000" &
  run_query "HEAVY_DIST_$i" "SELECT DISTINCTCOUNT(userId), DISTINCTCOUNT(eventType), DISTINCTCOUNT(eventId) FROM stress_test_events" &
  run_query "HEAVY_FILT_$i" "SELECT userId, COUNT(*) FROM stress_test_events WHERE eventType = 'purchase' AND value > 500 GROUP BY userId LIMIT 5000" &
  run_query "HEAVY_PCTL_$i" "SELECT eventType, PERCENTILEEST(value, 95) FROM stress_test_events GROUP BY eventType" &
done
wait
HEAVY_END=$(date +%s%3N)
echo ""
echo "Total wall time for 20 heavy concurrent queries: $((HEAVY_END - HEAVY_START))ms"

echo ""
echo "=== Results Summary ==="
echo "Total queries run: $(wc -l < "$RESULTS_FILE")"
echo "Errors: $(grep -c 'errors=[^0]' "$RESULTS_FILE" || echo 0)"
echo ""
echo "All results:"
cat "$RESULTS_FILE"
