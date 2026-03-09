export interface AuditEntry {
    timestamp: string;
    agent: string;
    action: string;
    target: string;
    inputSummary: string;
    outputSummary: string;
    correlationId: string;
}
export declare function logAudit(entry: AuditEntry): void;
export declare function getAuditLog(limit?: number): AuditEntry[];
