// Centralized config with env var overrides.
// Defaults use K8s service DNS names discovered after Helm install.
export const config = {
    // Pinot service endpoints (K8s DNS or localhost for port-forward)
    pinot: {
        controllerHost: process.env.PINOT_MONITOR_CONTROLLER_HOST ?? "pinot-controller.pinot.svc.cluster.local",
        controllerPort: parseInt(process.env.PINOT_MONITOR_CONTROLLER_PORT ?? "9000", 10),
        brokerHost: process.env.PINOT_MONITOR_BROKER_HOST ?? "pinot-broker.pinot.svc.cluster.local",
        brokerPort: parseInt(process.env.PINOT_MONITOR_BROKER_PORT ?? "8099", 10),
        serverHost: process.env.PINOT_MONITOR_SERVER_HOST ?? "pinot-server.pinot.svc.cluster.local",
        serverPort: parseInt(process.env.PINOT_MONITOR_SERVER_PORT ?? "80", 10),
    },
    // K8s namespaces the agent may inspect
    namespaces: ["pinot", "openclaw", "kube-system"],
    // LLM provider settings (supports Ollama, OpenAI, Groq, Together, OpenRouter, etc.)
    llm: {
        baseUrl: process.env.LLM_BASE_URL ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
        model: process.env.LLM_MODEL ?? process.env.OLLAMA_MODEL ?? "glm-4.7-flash",
        apiKey: process.env.LLM_API_KEY ?? "ollama",
    },
    // Agent settings
    agent: {
        maxTurns: parseInt(process.env.AGENT_MAX_TURNS ?? "25", 10),
    },
    // HTTP server settings
    server: {
        port: parseInt(process.env.PORT ?? "3000", 10),
        /** Request timeout for sweep requests (ms). Default: 15 minutes */
        sweepTimeoutMs: parseInt(process.env.SWEEP_TIMEOUT_MS ?? "900000", 10),
        /** Request timeout for chat requests (ms). Default: 10 minutes */
        chatTimeoutMs: parseInt(process.env.CHAT_TIMEOUT_MS ?? "600000", 10),
        /** Graceful shutdown timeout (ms). Default: 30 seconds */
        shutdownTimeoutMs: parseInt(process.env.SHUTDOWN_TIMEOUT_MS ?? "30000", 10),
    },
    // Session settings
    session: {
        ttlMs: parseInt(process.env.SESSION_TTL_MS ?? "3600000", 10), // 1 hour
    },
    // Watch mode settings (SSE continuous monitoring)
    watch: {
        /** Interval between mini-sweeps in watch mode (ms). Default: 60 seconds */
        intervalMs: parseInt(process.env.WATCH_INTERVAL_MS ?? "60000", 10),
    },
    // Inter-agent service URLs
    services: {
        operatorUrl: process.env.OPERATOR_URL ?? "http://localhost:3002",
    },
};
export function controllerUrl(path) {
    return `http://${config.pinot.controllerHost}:${config.pinot.controllerPort}${path}`;
}
export function brokerUrl(path) {
    return `http://${config.pinot.brokerHost}:${config.pinot.brokerPort}${path}`;
}
export function serverUrl(path) {
    return `http://${config.pinot.serverHost}:${config.pinot.serverPort}${path}`;
}
