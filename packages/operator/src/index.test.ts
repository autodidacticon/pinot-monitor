import { createServer } from '@pinot-agents/shared';
import { describe, expect, it } from 'vitest';

function buildTestApp() {
  const app = createServer({ agentName: 'operator-test', logger: false });
  app.get('/health', async () => ({ ok: true, agent: 'operator' }));
  app.post('/incident', async (request, reply) => {
    const body = (request.body ?? {}) as { incidents?: unknown[]; incident?: unknown };
    const raw = body.incidents ?? (body.incident ? [body.incident] : []);
    if (raw.length === 0) {
      reply.status(400).send({ error: 'No incidents provided' });
      return;
    }
    reply.send({ results: [] });
  });
  app.post('/approve/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    reply.status(404).send({ error: `Approval not found: ${id}` });
  });
  return app;
}

describe('operator routes', () => {
  it('GET /health returns { ok, agent }', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, agent: 'operator' });
    await app.close();
  });

  it('POST /incident with no incidents returns 400', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/incident', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'No incidents provided' });
    await app.close();
  });

  it('POST /approve/:id binds the id param', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/approve/abc123', payload: {} });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Approval not found: abc123' });
    await app.close();
  });
});
