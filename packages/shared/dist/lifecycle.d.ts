/**
 * Shared lifecycle utilities for all agents:
 * - Graceful shutdown (SIGTERM/SIGINT handling)
 * - Request timeout middleware
 * - Rate limiting
 */
import http from "node:http";
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
export declare function registerGracefulShutdown(options: GracefulShutdownOptions): void;
/**
 * Wraps an async request handler with a timeout. If the handler does not
 * complete within `timeoutMs`, the response is ended with a 504 Gateway Timeout.
 * Returns an AbortSignal that the handler can check for early termination.
 */
export declare function withTimeout(handler: (req: http.IncomingMessage, res: http.ServerResponse, signal: AbortSignal) => Promise<void>, timeoutMs: number): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>;
export interface RateLimiterOptions {
    /** Maximum requests allowed in the window. Default: 10 */
    maxRequests?: number;
    /** Window duration in ms. Default: 60000 (1 minute) */
    windowMs?: number;
}
export declare class SlidingWindowRateLimiter {
    private timestamps;
    private readonly maxRequests;
    private readonly windowMs;
    constructor(options?: RateLimiterOptions);
    /** Returns true if the request is allowed, false if rate-limited. */
    tryAcquire(): boolean;
    /** Returns the number of remaining requests in the current window. */
    get remaining(): number;
}
