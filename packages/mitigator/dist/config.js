export const config = {
    server: {
        port: parseInt(process.env.PORT ?? "3001", 10),
    },
    pinot: {
        controllerHost: process.env.PINOT_MONITOR_CONTROLLER_HOST ?? "pinot-controller.pinot.svc.cluster.local",
        controllerPort: parseInt(process.env.PINOT_MONITOR_CONTROLLER_PORT ?? "9000", 10),
    },
    services: {
        monitorUrl: process.env.MONITOR_URL ?? "http://localhost:3000",
        operatorUrl: process.env.OPERATOR_URL ?? "http://localhost:3002",
    },
    // LLM provider settings (supports Ollama, OpenAI, Groq, Together, OpenRouter, etc.)
    llm: {
        baseUrl: process.env.LLM_BASE_URL ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
        model: process.env.LLM_MODEL ?? process.env.OLLAMA_MODEL ?? "glm-4.7-flash",
        apiKey: process.env.LLM_API_KEY ?? "ollama",
    },
    agent: {
        maxTurns: parseInt(process.env.AGENT_MAX_TURNS ?? "10", 10),
    },
    // Dry-run mode: when true, all write tools log actions but do not execute
    dryRun: (process.env.DRY_RUN ?? "true").toLowerCase() === "true",
    namespaces: ["pinot"],
    // Request timeout for dispatch requests (ms). Default: 10 minutes
    dispatchTimeoutMs: parseInt(process.env.DISPATCH_TIMEOUT_MS ?? "600000", 10),
    // Graceful shutdown timeout (ms). Default: 30 seconds
    shutdownTimeoutMs: parseInt(process.env.SHUTDOWN_TIMEOUT_MS ?? "30000", 10),
};
export function controllerUrl(path) {
    return `http://${config.pinot.controllerHost}:${config.pinot.controllerPort}${path}`;
}
