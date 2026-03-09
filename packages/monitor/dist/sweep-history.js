const MAX_IN_MEMORY = 1000;
const sweepStore = [];
/** Record a sweep in-memory and emit a structured JSON log to stdout. */
export function recordSweep(record) {
    // In-memory
    sweepStore.push(record);
    if (sweepStore.length > MAX_IN_MEMORY) {
        sweepStore.splice(0, sweepStore.length - MAX_IN_MEMORY);
    }
    // Structured log to stdout
    console.log(JSON.stringify({
        level: "sweep",
        timestamp: record.timestamp,
        durationMs: record.durationMs,
        incidentCount: record.incidentCount,
        incidents: record.incidents,
    }));
}
/** Get sweep history, optionally limited to the last N hours. */
export function getSweepHistory(lastHours) {
    if (!lastHours)
        return [...sweepStore];
    const cutoff = new Date(Date.now() - lastHours * 3600_000).toISOString();
    return sweepStore.filter((r) => r.timestamp >= cutoff);
}
/**
 * Build trend summary for incidents found in current sweep.
 * Returns a string describing recurring incidents, or empty string if none.
 */
export function getTrendSummary(currentIncidents, lookbackHours = 24) {
    const cutoff = new Date(Date.now() - lookbackHours * 3600_000).toISOString();
    const recentSweeps = sweepStore.filter((r) => r.timestamp >= cutoff);
    if (recentSweeps.length === 0)
        return "";
    const lines = [];
    for (const incident of currentIncidents) {
        // Count how many past sweeps had an incident for the same component with similar severity
        let occurrences = 0;
        for (const sweep of recentSweeps) {
            if (sweep.incidents.some((i) => i.component === incident.component && i.severity === incident.severity)) {
                occurrences++;
            }
        }
        if (occurrences > 0) {
            lines.push(`${incident.component} (${incident.severity}): seen in ${occurrences} sweep(s) in last ${lookbackHours}h`);
        }
    }
    if (lines.length === 0)
        return "";
    return "Trend data:\n" + lines.join("\n");
}
