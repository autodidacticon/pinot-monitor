export type TrustLevel = 0 | 1 | 2 | 3;
export declare const config: {
    readonly server: {
        readonly port: number;
    };
    readonly services: {
        readonly monitorUrl: string;
        readonly mitigatorUrl: string;
    };
    readonly alerts: {
        readonly webhookUrl: string;
    };
    readonly trustLevel: TrustLevel;
    readonly rateLimit: {
        readonly maxRequests: number;
        readonly windowMs: number;
    };
    readonly verifyBeforeDispatch: boolean;
    readonly verifyTimeoutMs: number;
    readonly shutdownTimeoutMs: number;
};
