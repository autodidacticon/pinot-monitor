import http from "node:http";
import OpenAI from "openai";
import { config } from "./config.js";
import { getToolSpecs } from "./tools/registry.js";
// Import tool files to trigger registration via defineTool()
import "./tools/kubectl.js";
import "./tools/pinot-api.js";
import { MONITOR_SYSTEM_PROMPT } from "./prompts/monitor.js";
import { runAgentLoop } from "./agent.js";
import { getOrCreateSession, purgeExpired, sessionCount } from "./sessions.js";

const client = new OpenAI({
  baseURL: config.ollama.baseUrl,
  apiKey: "ollama", // Ollama doesn't require auth but the SDK needs a value
});

const tools = getToolSpecs();
const model = config.ollama.model;

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

async function handleHealth(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  jsonResponse(res, 200, { ok: true });
}

async function handleSweep(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  console.log("Starting sweep via /sweep endpoint...");
  const startTime = Date.now();

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: MONITOR_SYSTEM_PROMPT },
    { role: "user", content: "Perform a complete monitoring sweep of the Pinot cluster and produce the health report." },
  ];

  try {
    const result = await runAgentLoop(client, model, messages, tools, config.agent.maxTurns);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`Sweep completed in ${elapsed}s (${result.toolCalls.length} tool calls)`);
    jsonResponse(res, 200, { report: result.response });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Sweep failed: ${msg}`);
    jsonResponse(res, 500, { error: msg });
  }
}

async function handleChat(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
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

const server = http.createServer(async (req, res) => {
  const { method, url } = req;

  try {
    if (method === "GET" && url === "/health") {
      await handleHealth(req, res);
    } else if (method === "POST" && url === "/sweep") {
      await handleSweep(req, res);
    } else if (method === "POST" && url === "/chat") {
      await handleChat(req, res);
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
  console.log(`Model: ${model} | Max turns: ${config.agent.maxTurns} | Endpoint: ${config.ollama.baseUrl}`);
  console.log("Routes: GET /health, POST /sweep, POST /chat");
});
