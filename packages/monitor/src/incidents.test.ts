import { describe, expect, it } from 'vitest';
import { parseIncidents } from './incidents.js';

describe('parseIncidents', () => {
  it('parses incidents from a JSON code block', () => {
    const response = [
      'Here is the report.',
      '```json',
      JSON.stringify({
        incidents: [
          {
            id: 'i1',
            severity: 'CRITICAL',
            component: 'pinot-broker',
            evidence: ['broker unreachable'],
            suggestedAction: 'restart broker',
            timestamp: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
      '```',
    ].join('\n');

    const incidents = parseIncidents(response);
    expect(incidents).toHaveLength(1);
    expect(incidents[0].component).toBe('pinot-broker');
    expect(incidents[0].severity).toBe('CRITICAL');
  });

  it('returns [] when the report says HEALTHY and has no JSON block', () => {
    expect(parseIncidents('Overall Status: HEALTHY\nNothing to report.')).toEqual([]);
  });

  it('drops JSON-block incidents that fail validation (empty evidence)', () => {
    const response = [
      '```json',
      JSON.stringify({
        incidents: [
          {
            id: 'i2',
            severity: 'WARNING',
            component: 'pinot-server',
            evidence: [],
            suggestedAction: '',
            timestamp: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
      '```',
    ].join('\n');
    expect(parseIncidents(response)).toEqual([]);
  });
});
