import { describe, expect, it } from 'vitest';
import { kubectlGet } from './kubectl.js';

describe('kubectl_get security guard', () => {
  it('rejects dangerous flags without executing', async () => {
    const out = await kubectlGet.handler({
      subcommand: 'get',
      namespace: 'pinot',
      args: ['pods', '--force'],
    });
    expect(out).toBe('Error: flag "--force" is not allowed (read-only mode)');
  });

  it('rejects the -f delete flag', async () => {
    const out = await kubectlGet.handler({
      subcommand: 'get',
      namespace: 'pinot',
      args: ['-f'],
    });
    expect(out).toContain('is not allowed (read-only mode)');
  });

  it('rejects a namespace outside the whitelist at validation time', async () => {
    await expect(
      kubectlGet.handler({ subcommand: 'get', namespace: 'evil-ns', args: [] })
    ).rejects.toBeDefined();
  });
});
