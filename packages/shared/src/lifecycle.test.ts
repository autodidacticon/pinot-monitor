import { describe, expect, it } from 'vitest';
import { SlidingWindowRateLimiter } from './lifecycle.js';

describe('SlidingWindowRateLimiter', () => {
  it('allows up to maxRequests then rejects', () => {
    const limiter = new SlidingWindowRateLimiter({ maxRequests: 2, windowMs: 60_000 });
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
  });

  it('reports remaining capacity', () => {
    const limiter = new SlidingWindowRateLimiter({ maxRequests: 3, windowMs: 60_000 });
    expect(limiter.remaining).toBe(3);
    limiter.tryAcquire();
    expect(limiter.remaining).toBe(2);
  });
});
