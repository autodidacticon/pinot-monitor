export interface RunbookAction {
  tool: string;
  args: Record<string, string>;
  waitMs?: number;
}

export interface Runbook {
  id: string;
  name: string;
  incidentPattern: {
    severity?: string[];
    componentPattern?: RegExp;
    evidencePattern?: RegExp;
  };
  actions: RunbookAction[];
  verifyPrompt: string;
  maxRetries: number;
  escalateAfterRetries: boolean;
  cooldownMs: number;
  // Minimum trust level required to auto-dispatch this runbook.
  // 0=observe only, 1=suggest, 2=approve (wait for human), 3=auto-remediate
  minTrustLevel: 0 | 1 | 2 | 3;
}

export const runbooks: Runbook[] = [
  {
    id: "pod_crashloop",
    name: "Pod CrashLoopBackOff Recovery",
    incidentPattern: {
      severity: ["CRITICAL"],
      componentPattern: /kubernetes|pinot-.*\d+/i,
      evidencePattern: /crashloop|crash.?loop|restart/i,
    },
    actions: [
      { tool: "kubectl_delete", args: { resource: "pod", name: "${pod}", namespace: "pinot" } },
    ],
    verifyPrompt: "Check if pod ${pod} in namespace pinot is Running and Ready",
    maxRetries: 2,
    escalateAfterRetries: true,
    cooldownMs: 300_000, // 5 minutes
    minTrustLevel: 2,
  },
  {
    id: "segment_offline",
    name: "Offline Segment Recovery",
    incidentPattern: {
      severity: ["CRITICAL", "WARNING"],
      componentPattern: /segment/i,
      evidencePattern: /offline|error/i,
    },
    actions: [
      { tool: "pinot_reload_segment", args: { table: "${table}", segment: "${segment}" } },
      { tool: "wait", args: {}, waitMs: 30_000 },
    ],
    verifyPrompt: "Check if segments for table ${table} are all ONLINE",
    maxRetries: 2,
    escalateAfterRetries: true,
    cooldownMs: 600_000, // 10 minutes
    minTrustLevel: 3,
  },
  {
    id: "broker_unreachable",
    name: "Broker Unreachable Recovery",
    incidentPattern: {
      severity: ["CRITICAL"],
      componentPattern: /broker/i,
      evidencePattern: /unreachable|timeout|connection refused|FAIL/i,
    },
    actions: [
      { tool: "kubectl_delete", args: { resource: "pod", name: "${pod}", namespace: "pinot", selector: "component=broker" } },
    ],
    verifyPrompt: "Check if Pinot broker is healthy and responding to health checks",
    maxRetries: 2,
    escalateAfterRetries: true,
    cooldownMs: 300_000,
    minTrustLevel: 2,
  },
  {
    id: "controller_down",
    name: "Controller Down Recovery",
    incidentPattern: {
      severity: ["CRITICAL"],
      componentPattern: /controller/i,
      evidencePattern: /down|unreachable|timeout|FAIL/i,
    },
    actions: [
      { tool: "kubectl_delete", args: { resource: "pod", name: "${pod}", namespace: "pinot", selector: "component=controller" } },
    ],
    verifyPrompt: "Check if Pinot controller is healthy and responding to health checks",
    maxRetries: 2,
    escalateAfterRetries: true,
    cooldownMs: 600_000,
    minTrustLevel: 3,
  },
  {
    id: "high_restart_count",
    name: "High Restart Count Investigation",
    incidentPattern: {
      severity: ["WARNING"],
      componentPattern: /kubernetes|pinot-.*\d+/i,
      evidencePattern: /restart/i,
    },
    actions: [
      { tool: "kubectl_get", args: { subcommand: "describe", resource: "pod", name: "${pod}", namespace: "pinot" } },
    ],
    verifyPrompt: "Check if pod ${pod} restart count has stabilized",
    maxRetries: 1,
    escalateAfterRetries: false,
    cooldownMs: 1_800_000, // 30 minutes
    minTrustLevel: 1,
  },
  {
    id: "query_overload",
    name: "Query Overload Response",
    incidentPattern: {
      severity: ["WARNING", "CRITICAL"],
      componentPattern: /broker|query|pinot/i,
      evidencePattern: /latency|slow|timeout|overload|query.*time|response.*time/i,
    },
    actions: [
      { tool: "kubectl_get", args: { subcommand: "describe", resource: "pod", name: "pinot-broker-0", namespace: "pinot" } },
    ],
    verifyPrompt: "Check if Pinot broker query latency has returned to normal",
    maxRetries: 2,
    escalateAfterRetries: true,
    cooldownMs: 300_000, // 5 minutes
    minTrustLevel: 1, // suggest mode — don't auto-remediate query issues
  },
  {
    id: "ingestion_lag",
    name: "Ingestion Lag Response",
    incidentPattern: {
      severity: ["WARNING", "CRITICAL"],
      componentPattern: /ingestion|consumer|realtime|kafka/i,
      evidencePattern: /lag|stuck|consuming|behind|offset|partition/i,
    },
    actions: [
      { tool: "kubectl_get", args: { subcommand: "describe", resource: "pod", name: "pinot-server-0", namespace: "pinot" } },
    ],
    verifyPrompt: "Check if ingestion lag for the affected REALTIME table has decreased",
    maxRetries: 2,
    escalateAfterRetries: true,
    cooldownMs: 600_000, // 10 minutes
    minTrustLevel: 1, // suggest mode
  },
  {
    id: "storage_pressure",
    name: "Storage Pressure Response",
    incidentPattern: {
      severity: ["WARNING", "CRITICAL"],
      componentPattern: /storage|table|segment/i,
      evidencePattern: /storage|disk|quota|capacity|full|space|pressure|size/i,
    },
    actions: [
      { tool: "pinot_rebalance", args: { table: "${table}" } },
    ],
    verifyPrompt: "Check storage usage for table ${table}",
    maxRetries: 1,
    escalateAfterRetries: true,
    cooldownMs: 1_800_000, // 30 minutes
    minTrustLevel: 2, // require human approval
  },
];

export function matchRunbook(component: string, evidence: string[], severity?: string): Runbook | undefined {
  const evidenceText = evidence.join(" ");
  for (const rb of runbooks) {
    const { severity: allowedSeverities, componentPattern, evidencePattern } = rb.incidentPattern;
    if (allowedSeverities && severity && !allowedSeverities.includes(severity)) continue;
    if (componentPattern && !componentPattern.test(component)) continue;
    if (evidencePattern && !evidencePattern.test(evidenceText)) continue;
    return rb;
  }
  return undefined;
}
