import { createServer } from '@pinot-agents/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const DispatchBody = z.object({
  correlationId: z.string().optional(),
  payload: z
    .object({ incident: z.unknown().optional(), runbookId: z.string().optional() })
    .optional(),
});

function buildTestApp() {
  const app = createServer({ agentName: 'mitigator-test', logger: false });
  app.get('/health', async () => ({ ok: true, agent: 'mitigator' }));
  app.post('/dispatch', { schema: { body: DispatchBody } }, async (request, reply) => {
    const incident = request.body.payload?.incident;
    if (!incident) {
      reply.status(400).send({ error: 'Missing payload.incident' });
      return;
    }
    reply.send({ ok: true });
  });
  return app;
}

describe('mitigator routes', () => {
  it('GET /health returns { ok, agent }', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, agent: 'mitigator' });
    await app.close();
  });

  it('POST /dispatch without an incident returns 400 { error }', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/dispatch', payload: { payload: {} } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Missing payload.incident' });
    await app.close();
  });
});
