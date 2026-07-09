import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createServer, HandlerTimeoutError, runWithTimeout } from './server.js';

describe('createServer', () => {
  it('validates request bodies with Zod and returns 400 on failure', async () => {
    const app = createServer({ agentName: 'test', logger: false });
    app.post(
      '/echo',
      { schema: { body: z.object({ name: z.string() }) } },
      async (req) => req.body
    );
    const bad = await app.inject({ method: 'POST', url: '/echo', payload: { name: 123 } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toHaveProperty('error');
    const ok = await app.inject({ method: 'POST', url: '/echo', payload: { name: 'x' } });
    expect(ok.statusCode).toBe(200);
    await app.close();
  });

  it('renders unhandled errors as 500 { error }', async () => {
    const app = createServer({ agentName: 'test', logger: false });
    app.get('/boom', async () => {
      throw new Error('kaboom');
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Internal server error' });
    await app.close();
  });

  it('renders unknown routes as 404 { error: "Not found" }', async () => {
    const app = createServer({ agentName: 'test', logger: false });
    app.get('/known', async () => ({ ok: true }));
    const res = await app.inject({ method: 'GET', url: '/unknown' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Not found' });
    await app.close();
  });
});

describe('runWithTimeout', () => {
  it('rejects with HandlerTimeoutError when fn exceeds the deadline', async () => {
    await expect(
      runWithTimeout(() => new Promise((r) => setTimeout(r, 50)), 5)
    ).rejects.toBeInstanceOf(HandlerTimeoutError);
  });

  it('resolves with the value when fn finishes in time', async () => {
    await expect(runWithTimeout(async () => 42, 1000)).resolves.toBe(42);
  });
});
