import type { Incident } from "@pinot-agents/shared";
export interface SweepRecord {
    timestamp: string;
    durationMs: number;
    incidentCount: number;
    incidents: Incident[];
}
/** Record a sweep in-memory and emit a structured JSON log to stdout. */
export declare function recordSweep(record: SweepRecord): void;
/** Get sweep history, optionally limited to the last N hours. */
export declare function getSweepHistory(lastHours?: number): SweepRecord[];
/**
 * Build trend summary for incidents found in current sweep.
 * Returns a string describing recurring incidents, or empty string if none.
 */
export declare function getTrendSummary(currentIncidents: Incident[], lookbackHours?: number): string;
