import http from "node:http";
import OpenAI from "openai";
import { config } from "./config.js";
import { getToolSpecs, MetricsRegistry, registerGracefulShutdown, withTimeout } from "@pinot-agents/shared";

const metrics = new MetricsRegistry();
const sweepCount = metrics.counter("monitor_sweeps_total", "Total sweeps executed");
const sweepErrors = metrics.counter("monitor_sweep_errors_total", "Sweep errors");
const incidentsDetected = metrics.counter("monitor_incidents_detected_total", "Total incidents detected");
const sweepDuration = metrics.histogram("monitor_sweep_duration_seconds", "Sweep duration", [1, 5, 10, 30, 60, 120, 300]);
const chatRequests = metrics.counter("monitor_chat_requests_total", "Chat requests");
// Import tool files to trigger registration via defineTool()
import "./tools/kubectl.js";
import "./tools/pinot-api.js";
import { MONITOR_SYSTEM_PROMPT } from "./prompts/monitor.js";
import { runAgentLoop } from "./agent.js";
import { getOrCreateSession, purgeExpired, sessionCount } from "./sessions.js";
import { parseIncidents, storeIncidents, getIncidents } from "./incidents.js";
import { recordSweep, getSweepHistory, getTrendSummary } from "./sweep-history.js";
import type { Incident, Severity } from "@pinot-agents/shared";

async function forwardToOperator(incidents: import("@pinot-agents/shared").Incident[]): Promise<void> {
  const url = `${config.services.operatorUrl}/incident`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ incidents }),
  });
  if (!res.ok) {
    console.error(`Operator returned ${res.status}: ${await res.text()}`);
  } else {
    console.log(`Forwarded ${incidents.length} incident(s) to operator`);
  }
}

const client = new OpenAI({
  baseURL: config.llm.baseUrl,
  apiKey: config.llm.apiKey,
});

const tools = getToolSpecs();
const model = config.llm.model;

function jsonResponse(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

function parseQueryString(url: string): URLSearchParams {
  const idx = url.indexOf("?");
  return new URLSearchParams(idx >= 0 ? url.slice(idx + 1) : "");
}

async function handleHealth(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  jsonResponse(res, 200, { ok: true });
}

async function handleSweepInner(_req: http.IncomingMessage, res: http.ServerResponse, _signal: AbortSignal): Promise<void> {
  sweepCount.inc();
  console.log("Starting sweep via /sweep endpoint...");
  const startTime = Date.now();

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: MONITOR_SYSTEM_PROMPT },
    { role: "user", content: "Perform a complete monitoring sweep of the Pinot cluster and produce the health report." },
  ];

  try {
    const result = await runAgentLoop(client, model, messages, tools, config.agent.maxTurns);
    const durationMs = Date.now() - startTime;
    const elapsedSec = durationMs / 1000;
    const elapsed = elapsedSec.toFixed(1);
    sweepDuration.observe(elapsedSec);
    const incidents = parseIncidents(result.response);
    incidentsDetected.inc(incidents.length);
    storeIncidents(incidents);

    // Record sweep in history for trend detection
    const trendSummary = getTrendSummary(incidents);
    recordSweep({
      timestamp: new Date(startTime).toISOString(),
      durationMs,
      incidentCount: incidents.length,
      incidents,
    });

    console.log(`Sweep completed in ${elapsed}s (${result.toolCalls.length} tool calls, ${incidents.length} incidents)`);
    if (trendSummary) {
      console.log(trendSummary);
    }

    // Forward incidents to Operator for triage (fire-and-forget)
    if (incidents.length > 0) {
      forwardToOperator(incidents).catch((err) =>
        console.error(`Failed to forward incidents to operator: ${err instanceof Error ? err.message : err}`),
      );
    }

    jsonResponse(res, 200, { report: result.response, incidents, trends: trendSummary || undefined });
  } catch (err: unknown) {
    sweepErrors.inc();
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Sweep failed: ${msg}`);
    jsonResponse(res, 500, { error: msg });
  }
}

const handleSweep = withTimeout(handleSweepInner, config.server.sweepTimeoutMs);

async function handleChatInner(req: http.IncomingMessage, res: http.ServerResponse, _signal: AbortSignal): Promise<void> {
  let body: { sessionId?: string; message?: string };
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    jsonResponse(res, 400, { error: "Invalid JSON body" });
    return;
  }

  if (!body.message || typeof body.message !== "string") {
    jsonResponse(res, 400, { error: "Missing or invalid 'message' field" });
    return;
  }

  const session = getOrCreateSession(body.sessionId);
  session.messages.push({ role: "user", content: body.message });

  chatRequests.inc();
  console.log(`Chat [${session.id}]: "${body.message.slice(0, 80)}"`);

  try {
    const result = await runAgentLoop(client, model, session.messages, tools, config.agent.maxTurns);
    jsonResponse(res, 200, {
      sessionId: session.id,
      response: result.response,
      toolCalls: result.toolCalls.map(({ name, args }) => ({ name, args })),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Chat failed [${session.id}]: ${msg}`);
    jsonResponse(res, 500, { error: msg });
  }
}

const handleChat = withTimeout(handleChatInner, config.server.chatTimeoutMs);

async function handleIncidents(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const params = parseQueryString(req.url ?? "");
  const severity = params.get("severity")?.toUpperCase() as Severity | undefined;
  const valid: Severity[] = ["CRITICAL", "WARNING", "INFO"];
  if (severity && !valid.includes(severity)) {
    jsonResponse(res, 400, { error: `Invalid severity. Must be one of: ${valid.join(", ")}` });
    return;
  }
  jsonResponse(res, 200, { incidents: getIncidents(severity) });
}

async function handleHistory(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const params = parseQueryString(req.url ?? "");
  const hours = params.get("hours");
  const lastHours = hours ? parseInt(hours, 10) : undefined;
  if (hours && (isNaN(lastHours!) || lastHours! <= 0)) {
    jsonResponse(res, 400, { error: "Invalid 'hours' parameter. Must be a positive integer." });
    return;
  }
  const history = getSweepHistory(lastHours);
  jsonResponse(res, 200, { count: history.length, sweeps: history });
}

// --- SSE Watch Mode ---

const watchClients = new Set<http.ServerResponse>();

async function runMiniSweep(): Promise<{ report: string; incidents: Incident[]; trends?: string }> {
  const startTime = Date.now();
  sweepCount.inc();
  console.log("[watch] Running mini-sweep...");

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: MONITOR_SYSTEM_PROMPT },
    { role: "user", content: "Perform a complete monitoring sweep of the Pinot cluster and produce the health report." },
  ];

  const result = await runAgentLoop(client, model, messages, tools, config.agent.maxTurns);
  const durationMs = Date.now() - startTime;
  const elapsedSec = durationMs / 1000;
  sweepDuration.observe(elapsedSec);
  const incidents = parseIncidents(result.response);
  incidentsDetected.inc(incidents.length);
  storeIncidents(incidents);

  const trendSummary = getTrendSummary(incidents);
  recordSweep({
    timestamp: new Date(startTime).toISOString(),
    durationMs,
    incidentCount: incidents.length,
    incidents,
  });

  console.log(`[watch] Mini-sweep completed in ${elapsedSec.toFixed(1)}s (${incidents.length} incidents)`);

  // Forward incidents to Operator (fire-and-forget)
  if (incidents.length > 0) {
    forwardToOperator(incidents).catch((err) =>
      console.error(`Failed to forward incidents to operator: ${err instanceof Error ? err.message : err}`),
    );
  }

  return { report: result.response, incidents, trends: trendSummary || undefined };
}

function broadcastSSE(data: unknown): void {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of watchClients) {
    try {
      client.write(payload);
    } catch {
      watchClients.delete(client);
    }
  }
}

let watchInterval: ReturnType<typeof setInterval> | null = null;

function startWatchLoop(): void {
  if (watchInterval) return;
  console.log(`[watch] Starting watch loop (interval: ${config.watch.intervalMs}ms)`);
  watchInterval = setInterval(async () => {
    if (watchClients.size === 0) {
      stopWatchLoop();
      return;
    }
    try {
      const result = await runMiniSweep();
      broadcastSSE({
        type: "sweep",
        timestamp: new Date().toISOString(),
        incidentCount: result.incidents.length,
        incidents: result.incidents,
        trends: result.trends,
      });
    } catch (err: unknown) {
      sweepErrors.inc();
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[watch] Mini-sweep failed: ${msg}`);
      broadcastSSE({ type: "error", timestamp: new Date().toISOString(), error: msg });
    }
  }, config.watch.intervalMs);
}

function stopWatchLoop(): void {
  if (watchInterval) {
    console.log("[watch] No clients connected, stopping watch loop");
    clearInterval(watchInterval);
    watchInterval = null;
  }
}

function handleWatch(_req: http.IncomingMessage, res: http.ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  // Send initial connected event
  res.write(`data: ${JSON.stringify({ type: "connected", timestamp: new Date().toISOString() })}\n\n`);

  watchClients.add(res);
  console.log(`[watch] Client connected (${watchClients.size} total)`);

  // Start the watch loop if not already running
  startWatchLoop();

  // Clean up on disconnect
  _req.on("close", () => {
    watchClients.delete(res);
    console.log(`[watch] Client disconnected (${watchClients.size} remaining)`);
    if (watchClients.size === 0) {
      stopWatchLoop();
    }
  });
}

const server = http.createServer(async (req, res) => {
  const { method, url } = req;
  const path = url?.split("?")[0];

  try {
    if (method === "GET" && path === "/health") {
      await handleHealth(req, res);
    } else if (method === "POST" && path === "/sweep") {
      await handleSweep(req, res);
    } else if (method === "POST" && path === "/chat") {
      await handleChat(req, res);
    } else if (method === "GET" && path === "/incidents") {
      await handleIncidents(req, res);
    } else if (method === "GET" && path === "/history") {
      await handleHistory(req, res);
    } else if (method === "GET" && path === "/watch") {
      handleWatch(req, res);
    } else if (method === "GET" && path === "/metrics") {
      res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4" });
      res.end(metrics.toPrometheus());
    } else {
      jsonResponse(res, 404, { error: "Not found" });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Unhandled error: ${msg}`);
    if (!res.headersSent) {
      jsonResponse(res, 500, { error: "Internal server error" });
    }
  }
});

// Purge expired sessions every 10 minutes
const purgeInterval = setInterval(() => {
  const purged = purgeExpired();
  if (purged > 0) {
    console.log(`Purged ${purged} expired session(s), ${sessionCount()} remaining`);
  }
}, 600_000);
purgeInterval.unref();

server.listen(config.server.port, () => {
  console.log(`Pinot Monitor server listening on port ${config.server.port}`);
  console.log(`Model: ${model} | Max turns: ${config.agent.maxTurns} | Endpoint: ${config.llm.baseUrl}`);
  console.log(`Timeouts: sweep=${config.server.sweepTimeoutMs}ms, chat=${config.server.chatTimeoutMs}ms`);
  console.log(`Watch interval: ${config.watch.intervalMs}ms`);
  console.log("Routes: GET /health, POST /sweep, POST /chat, GET /incidents, GET /history, GET /watch");
});

registerGracefulShutdown({
  server,
  agentName: "monitor",
  forceTimeout: config.server.shutdownTimeoutMs,
  onShutdown: () => {
    clearInterval(purgeInterval);
    stopWatchLoop();
    // Close all SSE clients
    for (const client of watchClients) {
      client.end();
    }
    watchClients.clear();
  },
});
