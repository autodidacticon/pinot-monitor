export declare const config: {
    readonly server: {
        readonly port: number;
    };
    readonly pinot: {
        readonly controllerHost: string;
        readonly controllerPort: number;
    };
    readonly services: {
        readonly monitorUrl: string;
        readonly operatorUrl: string;
    };
    readonly llm: {
        readonly baseUrl: string;
        readonly model: string;
        readonly apiKey: string;
    };
    readonly agent: {
        readonly maxTurns: number;
    };
    readonly dryRun: boolean;
    readonly namespaces: readonly ["pinot"];
    readonly dispatchTimeoutMs: number;
    readonly shutdownTimeoutMs: number;
};
export declare function controllerUrl(path: string): string;
