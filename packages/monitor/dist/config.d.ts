export declare const config: {
    readonly pinot: {
        readonly controllerHost: string;
        readonly controllerPort: number;
        readonly brokerHost: string;
        readonly brokerPort: number;
        readonly serverHost: string;
        readonly serverPort: number;
    };
    readonly namespaces: readonly ["pinot", "openclaw", "kube-system"];
    readonly llm: {
        readonly baseUrl: string;
        readonly model: string;
        readonly apiKey: string;
    };
    readonly agent: {
        readonly maxTurns: number;
    };
    readonly server: {
        readonly port: number;
        /** Request timeout for sweep requests (ms). Default: 15 minutes */
        readonly sweepTimeoutMs: number;
        /** Request timeout for chat requests (ms). Default: 10 minutes */
        readonly chatTimeoutMs: number;
        /** Graceful shutdown timeout (ms). Default: 30 seconds */
        readonly shutdownTimeoutMs: number;
    };
    readonly session: {
        readonly ttlMs: number;
    };
    readonly watch: {
        /** Interval between mini-sweeps in watch mode (ms). Default: 60 seconds */
        readonly intervalMs: number;
    };
    readonly services: {
        readonly operatorUrl: string;
    };
};
export declare function controllerUrl(path: string): string;
export declare function brokerUrl(path: string): string;
export declare function serverUrl(path: string): string;
