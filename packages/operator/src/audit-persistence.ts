// Structured JSON audit logging to stdout.
// Deployment environment (k8s, systemd) handles log rotation and retention.
import type { AuditEntry } from "./audit.js";

export function persistAuditEntry(entry: AuditEntry): void {
  console.log(JSON.stringify({
    level: "audit",
    timestamp: entry.timestamp,
    agent: entry.agent,
    action: entry.action,
    target: entry.target,
    inputSummary: entry.inputSummary,
    outputSummary: entry.outputSummary,
    correlationId: entry.correlationId,
  }));
}
