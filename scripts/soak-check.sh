#!/usr/bin/env bash
# soak-check.sh — read-only verification of the local unattended soak environment.
# Spec: openspec/specs/soak-environment/spec.md ("One-command re-verification").
# Exits non-zero naming the failed check. Requires: kubectl, curl, node.

set -u

CTX="orbstack"
NS="pinot"
RELEASE="pinot-agents"
# Latest sweep must be newer than this many minutes (1.5x the 30-min cadence).
MAX_SWEEP_AGE_MIN="${MAX_SWEEP_AGE_MIN:-45}"

FAILED=()
PF_PID=""

cleanup() { [[ -n "$PF_PID" ]] && kill "$PF_PID" 2>/dev/null; }
trap cleanup EXIT

pass() { printf 'PASS: %s\n' "$1"; }
fail() {
  printf 'FAIL: %s%s\n' "$1" "${2:+ ($2)}"
  FAILED+=("$1")
}

port_forward() {
  local svc="$1" local_port="$2" remote_port="$3"
  kubectl --context "$CTX" port-forward -n "$NS" "svc/$svc" "$local_port:$remote_port" >/dev/null 2>&1 &
  PF_PID=$!
  disown "$PF_PID" 2>/dev/null || true
  sleep 3
}

stop_forward() {
  [[ -n "$PF_PID" ]] && kill "$PF_PID" 2>/dev/null
  PF_PID=""
}

fetch() { curl -s --max-time 10 "$1"; }

# 1. All pods in the namespace Ready (completed CronJob pods excluded; Failed pods still count)
if kubectl --context "$CTX" wait --for=condition=Ready pods --all -n "$NS" \
    --field-selector=status.phase!=Succeeded --timeout=15s >/dev/null 2>&1; then
  pass "all pods Ready in namespace $NS"
else
  fail "all pods Ready in namespace $NS" "kubectl wait timed out"
fi

# 2-4. Per-agent: /health and /metrics
check_agent() {
  local name="$1" port="$2" lp="$3" health_expect="$4"
  port_forward "$RELEASE-$name" "$lp" "$port"
  local health metrics
  health=$(fetch "http://localhost:$lp/health")
  if [[ "$health" == *"$health_expect"* ]]; then
    pass "$name /health"
  else
    fail "$name /health" "got: ${health:-no response}"
  fi
  metrics=$(fetch "http://localhost:$lp/metrics")
  if [[ "$metrics" == *"# HELP"* ]]; then
    pass "$name /metrics scrapeable"
  else
    fail "$name /metrics scrapeable"
  fi
  # Agent-specific endpoint checks while the forward is up
  case "$name" in
    monitor)
      local history
      history=$(fetch "http://localhost:$lp/history")
      local verdict
      verdict=$(printf '%s' "$history" | node -e '
        let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
          try{
            const j=JSON.parse(d);
            if(!j||typeof j.count!=="number"||j.count<1){console.log("FAIL:no sweeps recorded");return;}
            const latest=j.sweeps[j.sweeps.length-1];
            const ageMin=(Date.now()-new Date(latest.timestamp).getTime())/60000;
            const max=Number(process.env.MAX_SWEEP_AGE_MIN||45);
            console.log(ageMin<=max?`PASS:${j.count} sweeps, latest ${ageMin.toFixed(0)}m ago`:`FAIL:latest sweep ${ageMin.toFixed(0)}m ago (max ${max}m)`);
          }catch{console.log("FAIL:unparseable /history response")}
        })' MAX_SWEEP_AGE_MIN="$MAX_SWEEP_AGE_MIN" 2>/dev/null || echo "FAIL:node parse error")
      if [[ "$verdict" == PASS:* ]]; then
        pass "monitor sweep history advancing (${verdict#PASS:})"
      else
        fail "monitor sweep history advancing" "${verdict#FAIL:}"
      fi
      ;;
    operator)
      local audit
      audit=$(fetch "http://localhost:$lp/audit")
      if [[ "$audit" == *'"entries"'* ]]; then
        pass "operator /audit returns entries array"
      else
        fail "operator /audit returns entries array"
      fi
      if [[ "$audit" == *'"action":"dispatch"'* || "$audit" == *'"action":"dispatch_approved"'* ]]; then
        fail "zero-write posture: no dispatch audit actions"
      else
        pass "zero-write posture: no dispatch audit actions"
      fi
      ;;
    mitigator)
      local rollback
      rollback=$(fetch "http://localhost:$lp/rollback")
      if [[ "$rollback" == '{"entries":[]}' ]]; then
        pass "zero-write posture: rollback log empty"
      else
        fail "zero-write posture: rollback log empty" "got: ${rollback:-no response}"
      fi
      ;;
  esac
  stop_forward
}

check_agent monitor 3000 13000 '"ok":true'
check_agent operator 3002 13002 '"agent":"operator"'
check_agent mitigator 3001 13001 '"agent":"mitigator"'

# 5. Sweep CronJob exists; most recent job (if any) succeeded
if kubectl --context "$CTX" get cronjob "$RELEASE-sweep" -n "$NS" >/dev/null 2>&1; then
  pass "sweep CronJob exists"
  last_job=$(kubectl --context "$CTX" get jobs -n "$NS" --sort-by=.metadata.creationTimestamp -o name 2>/dev/null | tail -1)
  if [[ -n "$last_job" ]]; then
    succeeded=$(kubectl --context "$CTX" get "$last_job" -n "$NS" -o jsonpath='{.status.succeeded}' 2>/dev/null)
    if [[ "$succeeded" == "1" ]]; then
      pass "most recent sweep job succeeded"
    else
      fail "most recent sweep job succeeded" "$last_job status.succeeded=$succeeded"
    fi
  else
    pass "no CronJob runs yet (first cycle pending)"
  fi
else
  fail "sweep CronJob exists"
fi

echo ""
if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo "SOAK CHECK FAILED (${#FAILED[@]}): ${FAILED[*]}"
  exit 1
fi
echo "SOAK CHECK PASSED"
