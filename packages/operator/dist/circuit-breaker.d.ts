export declare function canAttempt(runbookId: string, component: string, maxRetries: number, cooldownMs: number): boolean;
export declare function recordAttempt(runbookId: string, component: string, cooldownMs: number): number;
export declare function getAttemptCount(runbookId: string, component: string): number;
