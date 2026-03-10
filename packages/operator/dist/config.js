export const config = {
    server: {
        port: parseInt(process.env.PORT ?? "3002", 10),
    },
    services: {
        monitorUrl: process.env.MONITOR_URL ?? "http://localhost:3000",
        mitigatorUrl: process.env.MITIGATOR_URL ?? "http://localhost:3001",
    },
    alerts: {
        webhookUrl: process.env.ALERT_WEBHOOK_URL ?? "",
    },
    // Trust level: 0=observe, 1=suggest, 2=approve, 3=auto-remediate
    trustLevel: Math.min(3, Math.max(0, parseInt(process.env.TRUST_LEVEL ?? "0", 10))),
    // Rate limiting for POST /incident
    rateLimit: {
        maxRequests: parseInt(process.env.RATE_LIMIT_MAX ?? "10", 10),
        windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? "60000", 10),
    },
    // Pre-dispatch verification: cross-check incident with monitor before dispatching
    verifyBeforeDispatch: (process.env.VERIFY_BEFORE_DISPATCH ?? "true") === "true",
    // Timeout for verification call to monitor (ms)
    verifyTimeoutMs: parseInt(process.env.VERIFY_TIMEOUT_MS ?? "15000", 10),
    // Graceful shutdown timeout (ms)
    shutdownTimeoutMs: parseInt(process.env.SHUTDOWN_TIMEOUT_MS ?? "30000", 10),
};
