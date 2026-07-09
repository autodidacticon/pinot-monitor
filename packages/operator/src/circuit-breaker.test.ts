import { describe, expect, it, vi } from 'vitest';
import { canAttempt, getAttemptCount, recordAttempt } from './circuit-breaker.js';

describe('circuit breaker', () => {
  it('allows attempts until maxRetries is reached', () => {
    const rb = 'cb_test_a';
    const comp = 'comp_a';
    expect(canAttempt(rb, comp, 2, 60_000)).toBe(true);
    recordAttempt(rb, comp, 60_000);
    expect(canAttempt(rb, comp, 2, 60_000)).toBe(true);
    recordAttempt(rb, comp, 60_000);
    expect(canAttempt(rb, comp, 2, 60_000)).toBe(false);
  });

  it('tracks attempt counts per runbook+component key', () => {
    const rb = 'cb_test_b';
    const comp = 'comp_b';
    expect(getAttemptCount(rb, comp)).toBe(0);
    expect(recordAttempt(rb, comp, 60_000)).toBe(1);
    expect(recordAttempt(rb, comp, 60_000)).toBe(2);
    expect(getAttemptCount(rb, comp)).toBe(2);
  });

  it('resets after the cooldown elapses', () => {
    // The reset check is `Date.now() - lastAttemptAt > cooldownMs`, so this must
    // advance the clock deterministically rather than rely on wall time.
    vi.useFakeTimers();
    try {
      const rb = 'cb_test_c';
      const comp = 'comp_c';
      recordAttempt(rb, comp, 1000); // cooldown 1s, attempts = 1
      expect(canAttempt(rb, comp, 1, 1000)).toBe(false); // maxRetries reached, cooldown active
      vi.advanceTimersByTime(1001); // cooldown elapsed
      expect(canAttempt(rb, comp, 1, 1000)).toBe(true); // record reset
    } finally {
      vi.useRealTimers();
    }
  });
});
