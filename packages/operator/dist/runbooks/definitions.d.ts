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
    minTrustLevel: 0 | 1 | 2 | 3;
}
export declare const runbooks: Runbook[];
export declare function matchRunbook(component: string, evidence: string[], severity?: string): Runbook | undefined;
