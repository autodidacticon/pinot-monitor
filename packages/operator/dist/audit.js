// TODO: Phase 3 — Persist audit log to a Pinot table for self-monitoring.
// Schema: timestamp (TIMESTAMP), agent (STRING), action (STRING), target (STRING),
// inputSummary (STRING), outputSummary (STRING), correlationId (STRING).
// This would allow the system to query its own remediation history via the Monitor's
// pinot_query tool, enabling self-awareness ("when did we last restart this pod?").
// See EVOLUTION.md "Audit persistence" open question for retention policy discussion.
const MAX_ENTRIES = 1000;
const auditLog = [];
export function logAudit(entry) {
    auditLog.push(entry);
    console.log(`[AUDIT] ${entry.timestamp} | ${entry.agent} | ${entry.action} | ${entry.target} | ${entry.outputSummary}`);
    if (auditLog.length > MAX_ENTRIES) {
        auditLog.splice(0, auditLog.length - MAX_ENTRIES);
    }
}
export function getAuditLog(limit = 100) {
    return auditLog.slice(-limit);
}
