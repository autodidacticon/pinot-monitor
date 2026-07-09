// Tool framework

export type { GracefulShutdownOptions, RateLimiterOptions } from './lifecycle.js';
// Lifecycle utilities (graceful shutdown, rate limiting)
export { registerGracefulShutdown, SlidingWindowRateLimiter } from './lifecycle.js';
// Metrics
export { Counter, Gauge, Histogram, MetricsRegistry } from './metrics.js';
export type { AppInstance, CreateServerOptions } from './server.js';
// Fastify server factory
export { createServer, HandlerTimeoutError, runWithTimeout } from './server.js';
export type { ToolDefinition, ToolHandler } from './tools/registry.js';
export { defineTool, getToolHandler, getToolSpecs } from './tools/registry.js';
// Incident types
export { Incident, IncidentReport, Severity } from './types/incident.js';
// Message protocol types
export {
  AgentMessage,
  AgentName,
  AlertMessage,
  AuditMessage,
  DispatchMessage,
  IncidentMessage,
  MessageType,
  VerifyMessage,
  VerifyResultMessage,
} from './types/messages.js';
