import { describe, expect, it } from 'vitest';
import { matchRunbook } from './definitions.js';

describe('matchRunbook', () => {
  it('matches pod_crashloop for a CRITICAL crashloop on kubernetes', () => {
    const rb = matchRunbook('kubernetes', ['CrashLoopBackOff detected'], 'CRITICAL');
    expect(rb?.id).toBe('pod_crashloop');
  });

  it('matches segment_offline for an offline segment', () => {
    const rb = matchRunbook('pinot-segments', ['segment offline'], 'CRITICAL');
    expect(rb?.id).toBe('segment_offline');
  });

  it('returns undefined when nothing matches', () => {
    expect(matchRunbook('unknown-thing', ['all good'], 'INFO')).toBeUndefined();
  });

  it('does not match when severity is not allowed by the runbook', () => {
    // pod_crashloop requires CRITICAL; an INFO crashloop should not match it
    const rb = matchRunbook('kubernetes', ['crashloop'], 'INFO');
    expect(rb?.id).not.toBe('pod_crashloop');
  });
});
