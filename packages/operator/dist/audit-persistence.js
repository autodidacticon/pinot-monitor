export function persistAuditEntry(entry) {
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
