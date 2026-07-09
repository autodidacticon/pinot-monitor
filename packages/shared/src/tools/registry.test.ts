import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool, getToolHandler, getToolSpecs } from './registry.js';

describe('defineTool', () => {
  it('produces an OpenAI function spec from a Zod schema', () => {
    const def = defineTool(
      'test_echo_spec',
      'Echo the message back',
      z.object({ message: z.string() }),
      async ({ message }) => message
    );
    expect(def.spec.type).toBe('function');
    expect(def.spec.function.name).toBe('test_echo_spec');
    expect(def.spec.function.description).toBe('Echo the message back');
    const params = def.spec.function.parameters as Record<string, unknown>;
    expect(params).toHaveProperty('properties');
    expect(params).not.toHaveProperty('$schema');
  });

  it('registers the tool so getToolSpecs and getToolHandler find it', () => {
    defineTool('test_lookup_tool', 'desc', z.object({ n: z.number() }), async ({ n }) => String(n));
    expect(getToolSpecs().some((s) => s.function.name === 'test_lookup_tool')).toBe(true);
    expect(getToolHandler('test_lookup_tool')).toBeTypeOf('function');
    expect(getToolHandler('does_not_exist')).toBeUndefined();
  });

  it('validates args with Zod before calling the handler', async () => {
    defineTool(
      'test_validate_tool',
      'desc',
      z.object({ n: z.number() }),
      async ({ n }) => `got ${n}`
    );
    const handler = getToolHandler('test_validate_tool');
    await expect(handler?.({ n: 5 })).resolves.toBe('got 5');
    await expect(handler?.({ n: 'nope' })).rejects.toBeDefined();
  });
});
