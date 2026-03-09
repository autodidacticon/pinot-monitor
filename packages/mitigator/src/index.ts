import http from "node:http";
import OpenAI from "openai";
import { getToolSpecs, MetricsRegistry, registerGracefulShutdown, withTimeout } from "@pinot-agents/shared";
import { config } from "./config.js";

const metrics = new MetricsRegistry();
const dispatchesReceived = metrics.counter("mitigator_dispatches_received_total", "Total dispatches received");
const dispatchesCompleted = metrics.counter("mitigator_dispatches_completed_total", "Dispatches completed successfully");
const dispatchErrors = metrics.counter("mitigator_dispatch_errors_total", "Dispatch errors");
const dispatchDuration = metrics.histogram("mitigator_dispatch_duration_seconds", "Dispatch execution time", [1, 5, 10, 30, 60, 120, 300]);
import { runAgentLoop } from "./agent.js";
import { MITIGATOR_SYSTEM_PROMPT } from "./prompts/mitigator.js";
import { getRollbackLog } from "./rollback.js";
// Import tools for side-effect registration
import "./tools/kubectl-write.js";
import "./tools/pinot-write.js";
import "./tools/monitor-verify.js";

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

async function handleDispatchInner(req: http.IncomingMessage, res: http.ServerResponse, _signal: AbortSignal): Promise<void> {
  let body: { correlationId?: string; payload?: { incident?: unknown; runbookId?: string } };
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    jsonResponse(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const incident = body.payload?.incident;
  const runbookId = body.payload?.runbookId ?? "unknown";
  const correlationId = body.correlationId ?? "none";

  if (!incident) {
    jsonResponse(res, 400, { error: "Missing payload.incident" });
    return;
  }

  dispatchesReceived.inc();
  console.log(`[dispatch] runbook=${runbookId} correlation=${correlationId}`);
  const dispatchStart = Date.now();

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: MITIGATOR_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Execute runbook "${runbookId}" for the following incident:\n\n${JSON.stringify(incident, null, 2)}\n\nFollow the runbook procedure, capture before/after state, execute remediation, and verify.`,
    },
  ];

  try {
    const result = await runAgentLoop(client, model, messages, tools, config.agent.maxTurns);

    // Audit back to operator
    try {
      await fetch(`${config.services.operatorUrl}/incident`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "mitigator",
          to: "operator",
          type: "audit",
          correlationId,
          timestamp: new Date().toISOString(),
          payload: {
            action: "remediation_complete",
            runbookId,
            response: result.response.slice(0, 500),
            toolCalls: result.toolCalls.length,
          },
        }),
      });
    } catch {
      console.error("[audit] Failed to send audit to operator");
    }

    dispatchesCompleted.inc();
    dispatchDuration.observe((Date.now() - dispatchStart) / 1000);
    console.log(`[dispatch] completed runbook=${runbookId} correlation=${correlationId} in ${((Date.now() - dispatchStart) / 1000).toFixed(1)}s`);
    jsonResponse(res, 200, {
      correlationId,
      runbookId,
      response: result.response,
      toolCalls: result.toolCalls.map(({ name, args }) => ({ name, args })),
    });
  } catch (err: unknown) {
    dispatchErrors.inc();
    dispatchDuration.observe((Date.now() - dispatchStart) / 1000);
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[dispatch] failed runbook=${runbookId}: ${msg}`);
    jsonResponse(res, 500, { error: msg });
  }
}

const handleDispatch = withTimeout(handleDispatchInner, config.dispatchTimeoutMs);

async function handleHealth(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  jsonResponse(res, 200, { ok: true, agent: "mitigator" });
}

const server = http.createServer(async (req, res) => {
  const { method, url } = req;
  const path = url?.split("?")[0];

  try {
    if (method === "GET" && path === "/health") {
      await handleHealth(req, res);
    } else if (method === "POST" && path === "/dispatch") {
      await handleDispatch(req, res);
    } else if (method === "GET" && path === "/rollback") {
      jsonResponse(res, 200, { entries: getRollbackLog() });
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

server.listen(config.server.port, () => {
  console.log(`Mitigator service listening on port ${config.server.port}`);
  console.log(`Model: ${model} | Max turns: ${config.agent.maxTurns}`);
  console.log(`Dispatch timeout: ${config.dispatchTimeoutMs}ms`);
  console.log(`Monitor: ${config.services.monitorUrl} | Operator: ${config.services.operatorUrl}`);
  console.log(`Dry-run mode: ${config.dryRun ? "ENABLED (write tools will simulate)" : "DISABLED"}`);
  console.log("Routes: GET /health, POST /dispatch, GET /rollback");
});

registerGracefulShutdown({
  server,
  agentName: "mitigator",
  forceTimeout: config.shutdownTimeoutMs,
});
