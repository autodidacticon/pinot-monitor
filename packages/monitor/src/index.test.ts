import { createServer } from '@pinot-agents/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const ChatBody = z.object({ sessionId: z.string().optional(), message: z.string().min(1) });

function buildTestApp() {
  const app = createServer({ agentName: 'monitor-test', logger: false });
  app.get('/health', async () => ({ ok: true }));
  app.get('/incidents', async (request, reply) => {
    const severity = (request.query as { severity?: string }).severity?.toUpperCase();
    const valid = ['CRITICAL', 'WARNING', 'INFO'];
    if (severity && !valid.includes(severity)) {
      reply.status(400).send({ error: `Invalid severity. Must be one of: ${valid.join(', ')}` });
      return;
    }
    reply.send({ incidents: [] });
  });
  app.post('/chat', { schema: { body: ChatBody } }, async (_request, reply) => {
    reply.send({ ok: true });
  });
  return app;
}

describe('monitor routes', () => {
  it('GET /health returns { ok: true }', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });

  it('GET /incidents rejects an invalid severity with 400', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/incidents?severity=bogus' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toHaveProperty('error');
    await app.close();
  });

  it('POST /chat rejects an empty message with 400', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/chat', payload: { message: '' } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
