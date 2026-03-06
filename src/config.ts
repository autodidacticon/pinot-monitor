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
  namespaces: ["pinot", "openclaw", "kube-system"] as const,

  // Ollama settings
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
    model: process.env.OLLAMA_MODEL ?? "qwen3:32b",
  },

  // Agent settings
  agent: {
    maxTurns: parseInt(process.env.AGENT_MAX_TURNS ?? "15", 10),
  },

  // HTTP server settings
  server: {
    port: parseInt(process.env.PORT ?? "3000", 10),
  },

  // Session settings
  session: {
    ttlMs: parseInt(process.env.SESSION_TTL_MS ?? "3600000", 10), // 1 hour
  },
} as const;

export function controllerUrl(path: string): string {
  return `http://${config.pinot.controllerHost}:${config.pinot.controllerPort}${path}`;
}

export function brokerUrl(path: string): string {
  return `http://${config.pinot.brokerHost}:${config.pinot.brokerPort}${path}`;
}

export function serverUrl(path: string): string {
  return `http://${config.pinot.serverHost}:${config.pinot.serverPort}${path}`;
}
