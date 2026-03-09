export function registerGracefulShutdown(options) {
    const { server, agentName, forceTimeout = 30_000, onShutdown } = options;
    let shuttingDown = false;
    const shutdown = async (signal) => {
        if (shuttingDown)
            return;
        shuttingDown = true;
        console.log(`[${agentName}] Received ${signal}, starting graceful shutdown...`);
        // Stop accepting new connections
        server.close(() => {
            console.log(`[${agentName}] Server closed, all in-flight requests completed`);
        });
        // Run optional cleanup
        if (onShutdown) {
            try {
                await onShutdown();
            }
            catch (err) {
                console.error(`[${agentName}] Cleanup error:`, err);
            }
        }
        // Force exit after timeout
        const forceTimer = setTimeout(() => {
            console.error(`[${agentName}] Force shutdown after ${forceTimeout}ms timeout`);
            process.exit(1);
        }, forceTimeout);
        forceTimer.unref();
        console.log(`[${agentName}] Waiting up to ${forceTimeout}ms for in-flight requests...`);
    };
    process.on("SIGTERM", () => { shutdown("SIGTERM"); });
    process.on("SIGINT", () => { shutdown("SIGINT"); });
}
// ─── Request Timeout ─────────────────────────────────────────────────────────
/**
 * Wraps an async request handler with a timeout. If the handler does not
 * complete within `timeoutMs`, the response is ended with a 504 Gateway Timeout.
 * Returns an AbortSignal that the handler can check for early termination.
 */
export function withTimeout(handler, timeoutMs) {
    return async (req, res) => {
        const controller = new AbortController();
        const timer = setTimeout(() => {
            controller.abort();
            if (!res.headersSent) {
                res.writeHead(504, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: `Request timed out after ${timeoutMs}ms` }));
            }
            else if (!res.writableEnded) {
                res.end();
            }
        }, timeoutMs);
        try {
            await handler(req, res, controller.signal);
        }
        finally {
            clearTimeout(timer);
        }
    };
}
export class SlidingWindowRateLimiter {
    timestamps = [];
    maxRequests;
    windowMs;
    constructor(options = {}) {
        this.maxRequests = options.maxRequests ?? 10;
        this.windowMs = options.windowMs ?? 60_000;
    }
    /** Returns true if the request is allowed, false if rate-limited. */
    tryAcquire() {
        const now = Date.now();
        const windowStart = now - this.windowMs;
        // Remove expired timestamps
        while (this.timestamps.length > 0 && this.timestamps[0] <= windowStart) {
            this.timestamps.shift();
        }
        if (this.timestamps.length >= this.maxRequests) {
            return false;
        }
        this.timestamps.push(now);
        return true;
    }
    /** Returns the number of remaining requests in the current window. */
    get remaining() {
        const windowStart = Date.now() - this.windowMs;
        while (this.timestamps.length > 0 && this.timestamps[0] <= windowStart) {
            this.timestamps.shift();
        }
        return Math.max(0, this.maxRequests - this.timestamps.length);
    }
}
