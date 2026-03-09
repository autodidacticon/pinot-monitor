import type { Incident } from "@pinot-agents/shared";
export interface NovelIncident {
    id: string;
    pattern: string;
    component: string;
    severity: string;
    occurrences: number;
    firstSeen: string;
    lastSeen: string;
    examples: Array<{
        timestamp: string;
        evidence: string[];
    }>;
    status: "new" | "acknowledged" | "runbook_created";
}
export declare function recordNovelIncident(incident: Incident): NovelIncident;
export declare function getNovelIncidents(): NovelIncident[];
export declare function acknowledgeNovelIncident(id: string): boolean;
export declare function markRunbookCreated(id: string): boolean;
