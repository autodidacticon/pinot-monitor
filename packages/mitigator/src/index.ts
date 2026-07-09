import {
  createServer,
  getToolSpecs,
  MetricsRegistry,
  registerGracefulShutdown,
  runWithTimeout,
} from '@pinot-agents/shared';
import OpenAI from 'openai';
import { z } from 'zod';
import { runAgentLoop } from './agent.js';
import { config } from './config.js';
import { MITIGATOR_SYSTEM_PROMPT } from './prompts/mitigator.js';
import { getRollbackLog } from './rollback.js';
// Import tools for side-effect registration
import './tools/kubectl-write.js';
import './tools/pinot-write.js';
import './tools/monitor-verify.js';

const metrics = new MetricsRegistry();
const dispatchesReceived = metrics.counter(
  'mitigator_dispatches_received_total',
  'Total dispatches received'
);
const dispatchesCompleted = metrics.counter(
  'mitigator_dispatches_completed_total',
  'Dispatches completed successfully'
);
const dispatchErrors = metrics.counter('mitigator_dispatch_errors_total', 'Dispatch errors');
const dispatchDuration = metrics.histogram(
  'mitigator_dispatch_duration_seconds',
  'Dispatch execution time',
  [1, 5, 10, 30, 60, 120, 300]
);

const client = new OpenAI({ baseURL: config.llm.baseUrl, apiKey: config.llm.apiKey });
const tools = getToolSpecs();
const model = config.llm.model;

const DispatchBody = z.object({
  correlationId: z.string().optional(),
  payload: z
    .object({
      incident: z.unknown().optional(),
      runbookId: z.string().optional(),
    })
    .optional(),
});

async function runDispatch(
  body: z.infer<typeof DispatchBody>
): Promise<{ status: number; body: unknown }> {
  const incident = body.payload?.incident;
  const runbookId = body.payload?.runbookId ?? 'unknown';
  const correlationId = body.correlationId ?? 'none';

  if (!incident) {
    return { status: 400, body: { error: 'Missing payload.incident' } };
  }

  dispatchesReceived.inc();
  console.log(`[dispatch] runbook=${runbookId} correlation=${correlationId}`);
  const dispatchStart = Date.now();

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: MITIGATOR_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Execute runbook "${runbookId}" for the following incident:\n\n${JSON.stringify(incident, null, 2)}\n\nFollow the runbook procedure, capture before/after state, execute remediation, and verify.`,
    },
  ];

  try {
    const result = await runAgentLoop(client, model, messages, tools, config.agent.maxTurns);

    // Audit back to operator
    try {
      await fetch(`${config.services.operatorUrl}/incident`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'mitigator',
          to: 'operator',
          type: 'audit',
          correlationId,
          timestamp: new Date().toISOString(),
          payload: {
            action: 'remediation_complete',
            runbookId,
            response: result.response.slice(0, 500),
            toolCalls: result.toolCalls.length,
          },
        }),
      });
    } catch {
      console.error('[audit] Failed to send audit to operator');
    }

    dispatchesCompleted.inc();
    dispatchDuration.observe((Date.now() - dispatchStart) / 1000);
    console.log(
      `[dispatch] completed runbook=${runbookId} correlation=${correlationId} in ${((Date.now() - dispatchStart) / 1000).toFixed(1)}s`
    );
    return {
      status: 200,
      body: {
        correlationId,
        runbookId,
        response: result.response,
        toolCalls: result.toolCalls.map(({ name, args }) => ({ name, args })),
      },
    };
  } catch (err: unknown) {
    dispatchErrors.inc();
    dispatchDuration.observe((Date.now() - dispatchStart) / 1000);
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[dispatch] failed runbook=${runbookId}: ${msg}`);
    return { status: 500, body: { error: msg } };
  }
}

const app = createServer({ agentName: 'mitigator' });

app.get('/health', async () => ({ ok: true, agent: 'mitigator' }));

app.post('/dispatch', { schema: { body: DispatchBody } }, async (request, reply) => {
  const result = await runWithTimeout(() => runDispatch(request.body), config.dispatchTimeoutMs);
  reply.status(result.status).send(result.body);
});

app.get('/rollback', async () => ({ entries: getRollbackLog() }));

app.get('/metrics', async (_request, reply) => {
  reply.header('Content-Type', 'text/plain; version=0.0.4').send(metrics.toPrometheus());
});

const start = async () => {
  await app.listen({ port: config.server.port, host: '0.0.0.0' });
  console.log(`Mitigator service listening on port ${config.server.port}`);
  console.log(`Model: ${model} | Max turns: ${config.agent.maxTurns}`);
  console.log(`Dispatch timeout: ${config.dispatchTimeoutMs}ms`);
  console.log(`Monitor: ${config.services.monitorUrl} | Operator: ${config.services.operatorUrl}`);
  console.log(
    `Dry-run mode: ${config.dryRun ? 'ENABLED (write tools will simulate)' : 'DISABLED'}`
  );
  console.log('Routes: GET /health, POST /dispatch, GET /rollback, GET /metrics');
};
start();

registerGracefulShutdown({
  server: app.server,
  agentName: 'mitigator',
  forceTimeout: config.shutdownTimeoutMs,
});
