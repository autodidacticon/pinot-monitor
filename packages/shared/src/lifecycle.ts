/**
 * Shared lifecycle utilities for all agents:
 * - Graceful shutdown (SIGTERM/SIGINT handling)
 * - Rate limiting
 */
import type http from 'node:http';

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

export interface GracefulShutdownOptions {
  /** Server to shut down */
  server: http.Server;
  /** Agent name for logging */
  agentName: string;
  /** Max time (ms) to wait for in-flight requests before force-closing. Default: 30000 */
  forceTimeout?: number;
  /** Optional cleanup callback run before server close */
  onShutdown?: () => void | Promise<void>;
}

export function registerGracefulShutdown(options: GracefulShutdownOptions): void {
  const { server, agentName, forceTimeout = 30_000, onShutdown } = options;
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
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
      } catch (err) {
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

  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
}

// ─── Rate Limiter ────────────────────────────────────────────────────────────

export interface RateLimiterOptions {
  /** Maximum requests allowed in the window. Default: 10 */
  maxRequests?: number;
  /** Window duration in ms. Default: 60000 (1 minute) */
  windowMs?: number;
}

export class SlidingWindowRateLimiter {
  private timestamps: number[] = [];
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(options: RateLimiterOptions = {}) {
    this.maxRequests = options.maxRequests ?? 10;
    this.windowMs = options.windowMs ?? 60_000;
  }

  /** Returns true if the request is allowed, false if rate-limited. */
  tryAcquire(): boolean {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    // Remove expired timestamps
    while (this.timestamps.length > 0 && (this.timestamps[0] ?? Infinity) <= windowStart) {
      this.timestamps.shift();
    }

    if (this.timestamps.length >= this.maxRequests) {
      return false;
    }

    this.timestamps.push(now);
    return true;
  }

  /** Returns the number of remaining requests in the current window. */
  get remaining(): number {
    const windowStart = Date.now() - this.windowMs;
    while (this.timestamps.length > 0 && (this.timestamps[0] ?? Infinity) <= windowStart) {
      this.timestamps.shift();
    }
    return Math.max(0, this.maxRequests - this.timestamps.length);
  }
}
