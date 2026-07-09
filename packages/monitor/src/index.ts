import type { ServerResponse } from 'node:http';
import type { Incident, Severity } from '@pinot-agents/shared';
import {
  createServer,
  getToolSpecs,
  MetricsRegistry,
  registerGracefulShutdown,
  runWithTimeout,
} from '@pinot-agents/shared';
import OpenAI from 'openai';
import { z } from 'zod';
import { config } from './config.js';
// Import tool files to trigger registration via defineTool()
import './tools/kubectl.js';
import './tools/pinot-api.js';
import { runAgentLoop } from './agent.js';
import { getIncidents, parseIncidents, storeIncidents } from './incidents.js';
import { MONITOR_SYSTEM_PROMPT } from './prompts/monitor.js';
import { getOrCreateSession, purgeExpired, sessionCount } from './sessions.js';
import { getSweepHistory, getTrendSummary, recordSweep } from './sweep-history.js';

const metrics = new MetricsRegistry();
const sweepCount = metrics.counter('monitor_sweeps_total', 'Total sweeps executed');
const sweepErrors = metrics.counter('monitor_sweep_errors_total', 'Sweep errors');
const incidentsDetected = metrics.counter(
  'monitor_incidents_detected_total',
  'Total incidents detected'
);
const sweepDuration = metrics.histogram(
  'monitor_sweep_duration_seconds',
  'Sweep duration',
  [1, 5, 10, 30, 60, 120, 300]
);
const chatRequests = metrics.counter('monitor_chat_requests_total', 'Chat requests');

const client = new OpenAI({ baseURL: config.llm.baseUrl, apiKey: config.llm.apiKey });
const tools = getToolSpecs();
const model = config.llm.model;

async function forwardToOperator(incidents: Incident[]): Promise<void> {
  const url = `${config.services.operatorUrl}/incident`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ incidents }),
  });
  if (!res.ok) {
    console.error(`Operator returned ${res.status}: ${await res.text()}`);
  } else {
    console.log(`Forwarded ${incidents.length} incident(s) to operator`);
  }
}

async function runSweep(): Promise<{ status: number; body: unknown }> {
  sweepCount.inc();
  console.log('Starting sweep via /sweep endpoint...');
  const startTime = Date.now();

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: MONITOR_SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        'Perform a complete monitoring sweep of the Pinot cluster and produce the health report.',
    },
  ];

  try {
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

    console.log(
      `Sweep completed in ${elapsedSec.toFixed(1)}s (${result.toolCalls.length} tool calls, ${incidents.length} incidents)`
    );
    if (trendSummary) {
      console.log(trendSummary);
    }

    if (incidents.length > 0) {
      forwardToOperator(incidents).catch((err) =>
        console.error(
          `Failed to forward incidents to operator: ${err instanceof Error ? err.message : err}`
        )
      );
    }

    return {
      status: 200,
      body: { report: result.response, incidents, trends: trendSummary || undefined },
    };
  } catch (err: unknown) {
    sweepErrors.inc();
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Sweep failed: ${msg}`);
    return { status: 500, body: { error: msg } };
  }
}

const ChatBody = z.object({
  sessionId: z.string().optional(),
  message: z.string().min(1),
});

async function runChat(body: z.infer<typeof ChatBody>): Promise<{ status: number; body: unknown }> {
  const session = getOrCreateSession(body.sessionId);
  session.messages.push({ role: 'user', content: body.message });

  chatRequests.inc();
  console.log(`Chat [${session.id}]: "${body.message.slice(0, 80)}"`);

  try {
    const result = await runAgentLoop(
      client,
      model,
      session.messages,
      tools,
      config.agent.maxTurns
    );
    return {
      status: 200,
      body: {
        sessionId: session.id,
        response: result.response,
        toolCalls: result.toolCalls.map(({ name, args }) => ({ name, args })),
      },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Chat failed [${session.id}]: ${msg}`);
    return { status: 500, body: { error: msg } };
  }
}

// --- SSE Watch Mode ---

const watchClients = new Set<ServerResponse>();

async function runMiniSweep(): Promise<{ report: string; incidents: Incident[]; trends?: string }> {
  const startTime = Date.now();
  sweepCount.inc();
  console.log('[watch] Running mini-sweep...');

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: MONITOR_SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        'Perform a complete monitoring sweep of the Pinot cluster and produce the health report.',
    },
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

  console.log(
    `[watch] Mini-sweep completed in ${elapsedSec.toFixed(1)}s (${incidents.length} incidents)`
  );

  if (incidents.length > 0) {
    forwardToOperator(incidents).catch((err) =>
      console.error(
        `Failed to forward incidents to operator: ${err instanceof Error ? err.message : err}`
      )
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
  if (watchInterval) {
    return;
  }
  console.log(`[watch] Starting watch loop (interval: ${config.watch.intervalMs}ms)`);
  watchInterval = setInterval(async () => {
    if (watchClients.size === 0) {
      stopWatchLoop();
      return;
    }
    try {
      const result = await runMiniSweep();
      broadcastSSE({
        type: 'sweep',
        timestamp: new Date().toISOString(),
        incidentCount: result.incidents.length,
        incidents: result.incidents,
        trends: result.trends,
      });
    } catch (err: unknown) {
      sweepErrors.inc();
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[watch] Mini-sweep failed: ${msg}`);
      broadcastSSE({ type: 'error', timestamp: new Date().toISOString(), error: msg });
    }
  }, config.watch.intervalMs);
}

function stopWatchLoop(): void {
  if (watchInterval) {
    console.log('[watch] No clients connected, stopping watch loop');
    clearInterval(watchInterval);
    watchInterval = null;
  }
}

const app = createServer({ agentName: 'monitor' });

app.get('/health', async () => ({ ok: true }));

app.post('/sweep', async (_request, reply) => {
  const result = await runWithTimeout(() => runSweep(), config.server.sweepTimeoutMs);
  reply.status(result.status).send(result.body);
});

app.post('/chat', { schema: { body: ChatBody } }, async (request, reply) => {
  const result = await runWithTimeout(() => runChat(request.body), config.server.chatTimeoutMs);
  reply.status(result.status).send(result.body);
});

app.get('/incidents', async (request, reply) => {
  const severity = (request.query as { severity?: string }).severity?.toUpperCase() as
    | Severity
    | undefined;
  const valid: Severity[] = ['CRITICAL', 'WARNING', 'INFO'];
  if (severity && !valid.includes(severity)) {
    reply.status(400).send({ error: `Invalid severity. Must be one of: ${valid.join(', ')}` });
    return;
  }
  reply.send({ incidents: getIncidents(severity) });
});

app.get('/history', async (request, reply) => {
  const hours = (request.query as { hours?: string }).hours;
  const lastHours = hours ? Number.parseInt(hours, 10) : undefined;
  if (hours && (Number.isNaN(lastHours) || (lastHours ?? 0) <= 0)) {
    reply.status(400).send({ error: "Invalid 'hours' parameter. Must be a positive integer." });
    return;
  }
  const history = getSweepHistory(lastHours);
  reply.send({ count: history.length, sweeps: history });
});

app.get('/watch', (request, reply) => {
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  raw.write(
    `data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`
  );

  watchClients.add(raw);
  console.log(`[watch] Client connected (${watchClients.size} total)`);
  startWatchLoop();

  request.raw.on('close', () => {
    watchClients.delete(raw);
    console.log(`[watch] Client disconnected (${watchClients.size} remaining)`);
    if (watchClients.size === 0) {
      stopWatchLoop();
    }
  });
});

app.get('/metrics', async (_request, reply) => {
  reply.header('Content-Type', 'text/plain; version=0.0.4').send(metrics.toPrometheus());
});

// Purge expired sessions every 10 minutes
const purgeInterval = setInterval(() => {
  const purged = purgeExpired();
  if (purged > 0) {
    console.log(`Purged ${purged} expired session(s), ${sessionCount()} remaining`);
  }
}, 600_000);
purgeInterval.unref();

const start = async () => {
  await app.listen({ port: config.server.port, host: '0.0.0.0' });
  console.log(`Pinot Monitor server listening on port ${config.server.port}`);
  console.log(
    `Model: ${model} | Max turns: ${config.agent.maxTurns} | Endpoint: ${config.llm.baseUrl}`
  );
  console.log(
    `Timeouts: sweep=${config.server.sweepTimeoutMs}ms, chat=${config.server.chatTimeoutMs}ms`
  );
  console.log(`Watch interval: ${config.watch.intervalMs}ms`);
  console.log(
    'Routes: GET /health, POST /sweep, POST /chat, GET /incidents, GET /history, GET /watch, GET /metrics'
  );
};
start();

registerGracefulShutdown({
  server: app.server,
  agentName: 'monitor',
  forceTimeout: config.server.shutdownTimeoutMs,
  onShutdown: () => {
    clearInterval(purgeInterval);
    stopWatchLoop();
    for (const client of watchClients) {
      client.end();
    }
    watchClients.clear();
  },
});
