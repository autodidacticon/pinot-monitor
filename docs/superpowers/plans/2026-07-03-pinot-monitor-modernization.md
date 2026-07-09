# Pinot-monitor modernization implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modernize the pinot-monitor monorepo to artisan conventions: pnpm, a shared tsconfig base, Biome, Vitest, and Fastify 5 servers (replacing bare `node:http`), without changing agent behavior or inter-agent response contracts.

**Architecture:** Additive tooling first (pnpm, tsconfig base, Biome, Vitest), then a single behavior-surface change: the three `node:http` servers move to Fastify 5 behind a shared `createServer` factory in `packages/shared`, with Zod request validation via `fastify-type-provider-zod`. All business logic (agent loop, stores, runbooks, circuit breaker, metrics) is untouched.

**Tech Stack:** TypeScript 5.9 (ESM, `.js` import extensions), pnpm 10.28.2, Node 22, Biome 2.4.8, Vitest 4.0.18, Fastify 5.8.5, `fastify-type-provider-zod` 6.1.0, Zod 4.3.6, openai 4.96.

## Global Constraints

These apply to every task. Copy exact values.

- **Package manager:** pnpm, pinned `"packageManager": "pnpm@10.28.2"`. Never invoke `npm`/`yarn`. Run scripts with `pnpm ...`.
- **Node:** `.nvmrc` = `22`; `engines.node` = `>=22.0.0`.
- **Modules:** ESM everywhere (`"type": "module"`). Keep explicit `.js` extensions on relative imports.
- **Code style (Biome):** 2-space indent, line width 100, single quotes, semicolons always, es5 trailing commas, `bracketSpacing: true`. Write all NEW code in this style.
- **Dependency versions (caret, matching the repo convention):** `@biomejs/biome` `^2.4.8`, `vitest` `^4.0.18`, `fastify` `^5.8.5`, `fastify-type-provider-zod` `^6.1.0`, `@types/node` `^22.15.21`. Keep `typescript` `^5.9.3`, `tsx` `^4.21.0`, `openai` `^4.96.0`, `zod` `^4.3.6`.
- **Response contracts are frozen:** every route's JSON response shape and HTTP status must stay identical so the Monitor to Operator to Mitigator to Monitor loop keeps working. The only intentional drift: the exact `error` string for malformed JSON and schema-validation failures may change (status stays 400).
- **Monitor tools stay read-only.** Only the mitigator has write-capable tools.
- **Branch:** `modernize-tooling-fastify-biome` (already checked out).
- Each task ends with a green `pnpm typecheck` (from Task 2 onward, `pnpm lint` and `pnpm test` too) and a commit.

---

### Task 1: Repo hygiene (gitignore, untrack build artifacts)

The repo tracks 60 compiled `dist/*` files and 4 `*.tsbuildinfo` files, and `.gitignore` omits `node_modules` and `dist`. This must be fixed before Biome and pnpm run, or they will churn on build artifacts.

**Files:**
- Modify: `.gitignore`
- Untrack (git only, keep on disk): `packages/*/dist/**`, `packages/*/tsconfig.tsbuildinfo`

- [ ] **Step 1: Rewrite `.gitignore`**

Replace the entire contents of `.gitignore` with:

```gitignore
# Dependencies
node_modules/

# Build output
dist/
*.tsbuildinfo

# Agent tooling
.claude/
.claude-flow/

# Environment
.env
.env.*
```

- [ ] **Step 2: Untrack committed build artifacts (keep files on disk)**

Run:
```bash
git rm -r --cached --quiet packages/*/dist
git rm --cached --quiet packages/mitigator/tsconfig.tsbuildinfo packages/monitor/tsconfig.tsbuildinfo packages/operator/tsconfig.tsbuildinfo packages/shared/tsconfig.tsbuildinfo
```
Expected: git stages deletions of the cached copies only; `ls packages/shared/dist` still shows files locally.

- [ ] **Step 3: Verify nothing tracked remains under dist/ or tsbuildinfo**

Run: `git ls-files 'packages/*/dist/*' '*.tsbuildinfo' | wc -l`
Expected: `0`

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore: gitignore node_modules/dist and untrack build artifacts"
```

---

### Task 2: Migrate to pnpm

Replace npm workspaces with pnpm. Removes the `--legacy-peer-deps` requirement (pnpm's `strict-peer-dependencies=false` handles the zod4/openai peer mismatch).

**Files:**
- Modify: `package.json` (root), `packages/shared/package.json`, `packages/monitor/package.json`, `packages/operator/package.json`, `packages/mitigator/package.json`, `Dockerfile`
- Create: `pnpm-workspace.yaml`, `.npmrc`, `.nvmrc`
- Delete: `package-lock.json`

- [ ] **Step 1: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - 'packages/*'
```

- [ ] **Step 2: Create `.npmrc`**

```
auto-install-peers=true
strict-peer-dependencies=false
use-lockfile-v9=true
```

- [ ] **Step 3: Create `.nvmrc`**

```
22
```

- [ ] **Step 4: Rewrite root `package.json`**

Replace the whole file with:

```json
{
  "name": "pinot-agents",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.28.2",
  "engines": {
    "node": ">=22.0.0"
  },
  "scripts": {
    "start": "pnpm --filter @pinot-agents/monitor start",
    "start:operator": "pnpm --filter @pinot-agents/operator start",
    "start:mitigator": "pnpm --filter @pinot-agents/mitigator start",
    "start:all": "pnpm --filter @pinot-agents/monitor start & pnpm --filter @pinot-agents/operator start & pnpm --filter @pinot-agents/mitigator start & wait",
    "typecheck": "tsc -b packages/shared packages/monitor packages/operator packages/mitigator"
  },
  "devDependencies": {
    "@types/node": "^22.15.21",
    "tsx": "^4.21.0",
    "typescript": "^5.9.3"
  }
}
```

- [ ] **Step 5: Update the three internal deps to `workspace:*` and align `@types/node`**

In `packages/monitor/package.json`, `packages/operator/package.json`, and `packages/mitigator/package.json`:
- change `"@pinot-agents/shared": "*"` to `"@pinot-agents/shared": "workspace:*"`
- change `"@types/node": "^25.3.3"` to `"@types/node": "^22.15.21"`

In `packages/shared/package.json`:
- change `"@types/node": "^25.3.3"` to `"@types/node": "^22.15.21"`

- [ ] **Step 6: Delete the npm lockfile and install with pnpm**

Run:
```bash
rm package-lock.json
corepack enable
pnpm install
```
Expected: pnpm resolves and writes `pnpm-lock.yaml` with NO `--legacy-peer-deps` flag and no peer-dependency errors.

- [ ] **Step 7: Update the `Dockerfile` to use pnpm**

Replace the whole file with:

```dockerfile
FROM node:22-slim

# Install kubectl
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
  && curl -LO "https://dl.k8s.io/release/$(curl -Ls https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" \
  && install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl \
  && rm kubectl \
  && apt-get purge -y curl \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY packages/monitor/package.json packages/monitor/
COPY packages/operator/package.json packages/operator/
COPY packages/mitigator/package.json packages/mitigator/
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY packages/shared/ packages/shared/
COPY packages/monitor/ packages/monitor/
COPY packages/operator/ packages/operator/
COPY packages/mitigator/ packages/mitigator/

EXPOSE 3000 3001 3002

CMD ["pnpm", "start"]
```

- [ ] **Step 8: Verify typecheck passes under pnpm**

Run: `pnpm typecheck`
Expected: exits 0 (may print `tsc -b` build output; no errors).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "build: migrate from npm to pnpm workspaces"
```

---

### Task 3: Add shared tsconfig base

Kill the 4x duplicated compiler options; centralize in `tsconfig.base.json`. Bump to ESNext and add low-churn safety flags. (The higher-churn `noUncheckedIndexedAccess` is deferred to Task 11.)

**Files:**
- Create: `tsconfig.base.json`
- Modify: `packages/shared/tsconfig.json`, `packages/monitor/tsconfig.json`, `packages/operator/tsconfig.json`, `packages/mitigator/tsconfig.json`

**Interfaces:**
- Produces: `tsconfig.base.json` with all shared `compilerOptions`; each package tsconfig extends it and keeps only package-local settings.

- [ ] **Step 1: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "moduleDetection": "force",
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "strict": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

- [ ] **Step 2: Rewrite `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "composite": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 3: Rewrite `packages/monitor/tsconfig.json`, `packages/operator/tsconfig.json`, `packages/mitigator/tsconfig.json`**

Each of the three gets this identical content:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true
  },
  "references": [{ "path": "../shared" }],
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 4: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: exits 0. (If any error appears from `moduleDetection: force` or the new flags, fix it before continuing; none are expected in this codebase since there are no inheritance `override`s or fallthrough switches.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "build: add shared tsconfig base, bump to ESNext"
```

---

### Task 4: Add Biome and reformat

Introduce Biome as the single lint+format tool. One config-add commit, then one repo-wide reformat commit.

**Files:**
- Create: `biome.json`
- Modify: `package.json` (root, add devDep + scripts), `packages/operator/src/index.ts` (remove one unused import), plus every source file (reformatted by Biome)

- [ ] **Step 1: Add Biome and lint/format scripts to root `package.json`**

Add `"@biomejs/biome": "^2.4.8"` to `devDependencies`, and add these to `scripts` (keep the existing `start*`/`typecheck` scripts):

```json
"lint": "biome check .",
"lint:fix": "biome check --write .",
"format": "biome format --write .",
"format:check": "biome format ."
```

Then run: `pnpm install`

- [ ] **Step 2: Create `biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/2.4.8/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": { "includes": ["**", "!**/dist", "!**/*.tsbuildinfo", "!src", "!data", "!k8s"] },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "javascript": {
    "formatter": {
      "semicolons": "always",
      "quoteStyle": "single",
      "trailingCommas": "es5",
      "bracketSpacing": true,
      "bracketSameLine": false
    }
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": { "noExplicitAny": "warn" },
      "correctness": { "noUnusedVariables": "error", "noUnusedImports": "error" },
      "complexity": { "useArrowFunction": "warn" }
    }
  }
}
```

Note: `"!src"` excludes the legacy top-level `src/` directory (pre-monorepo code, not in the build). The active code is under `packages/*/src`.

- [ ] **Step 3: Remove the one known unused import**

In `packages/operator/src/index.ts`, the import of `acknowledgeNovelIncident` is unused and will fail `noUnusedImports`. Change:

```ts
import { recordNovelIncident, getNovelIncidents, acknowledgeNovelIncident } from "./novel-incidents.js";
```
to:
```ts
import { recordNovelIncident, getNovelIncidents } from "./novel-incidents.js";
```

- [ ] **Step 4: Commit the Biome config (before reformatting)**

```bash
git add biome.json package.json pnpm-lock.yaml packages/operator/src/index.ts
git commit -m "build: add Biome config and lint/format scripts"
```

- [ ] **Step 5: Apply formatting and safe autofixes across the repo**

Run: `pnpm lint:fix`
Expected: Biome rewrites files (double to single quotes, etc.) and prints a summary. It may print `warn` diagnostics (e.g. `noExplicitAny`) which do NOT fail the command.

- [ ] **Step 6: Verify `biome check` is clean (no errors)**

Run: `pnpm lint`
Expected: exits 0. Warnings are allowed; errors are not. If an error remains (e.g. an unused local variable Biome could not auto-remove), delete that variable/import, then re-run.

- [ ] **Step 7: Verify typecheck still passes after reformat**

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 8: Commit the reformat**

```bash
git add -A
git commit -m "style: apply Biome formatting across the repo"
```

---

### Task 5: Set up Vitest with the first two unit tests

Stand up Vitest and prove it runs by testing two pure targets (tool registry, config URL builders). These are characterization tests over existing code, so they pass on first run.

**Files:**
- Create: `vitest.config.ts`, `packages/shared/src/tools/registry.test.ts`, `packages/monitor/src/config.test.ts`
- Modify: `package.json` (root: add devDep + test scripts)

**Interfaces:**
- Consumes (from existing code): `defineTool`, `getToolSpecs`, `getToolHandler` (`packages/shared/src/tools/registry.ts`); `controllerUrl`, `brokerUrl`, `serverUrl` (`packages/monitor/src/config.ts`).

- [ ] **Step 1: Add Vitest and test scripts to root `package.json`**

Add `"vitest": "^4.0.18"` to `devDependencies`, and add to `scripts`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

Then run: `pnpm install`

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks',
    include: ['packages/*/src/**/*.test.ts'],
  },
});
```

- [ ] **Step 3: Write `packages/shared/src/tools/registry.test.ts`**

```ts
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
    defineTool('test_validate_tool', 'desc', z.object({ n: z.number() }), async ({ n }) => `got ${n}`);
    const handler = getToolHandler('test_validate_tool');
    await expect(handler?.({ n: 5 })).resolves.toBe('got 5');
    await expect(handler?.({ n: 'nope' })).rejects.toBeDefined();
  });
});
```

- [ ] **Step 4: Write `packages/monitor/src/config.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { brokerUrl, controllerUrl, serverUrl } from './config.js';

describe('config URL builders', () => {
  it('builds the controller URL from host and port defaults', () => {
    expect(controllerUrl('/health')).toBe(
      'http://pinot-controller.pinot.svc.cluster.local:9000/health'
    );
  });

  it('builds the broker URL', () => {
    expect(brokerUrl('/query/sql')).toBe(
      'http://pinot-broker.pinot.svc.cluster.local:8099/query/sql'
    );
  });

  it('builds the server URL', () => {
    expect(serverUrl('/')).toBe('http://pinot-server.pinot.svc.cluster.local:80/');
  });
});
```

Note: these assume no `PINOT_MONITOR_*` env vars are set (the default in CI/local). If your shell exports them, unset them for the test run.

- [ ] **Step 5: Run the tests**

Run: `pnpm test`
Expected: PASS (2 files, 6 tests). If `@pinot-agents/shared` fails to resolve inside a test, add `vite-tsconfig-paths` to `vitest.config.ts` plugins; this is unlikely because pnpm symlinks the workspace package.

- [ ] **Step 6: Verify lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "test: set up Vitest with registry and config unit tests"
```

---

### Task 6: Add the remaining unit tests

Cover the rest of the pure, high-value logic: incident parsing, circuit breaker, rate limiter, runbook matching, and the kubectl security guard.

**Files:**
- Create: `packages/monitor/src/incidents.test.ts`, `packages/operator/src/circuit-breaker.test.ts`, `packages/shared/src/lifecycle.test.ts`, `packages/operator/src/runbooks/definitions.test.ts`, `packages/monitor/src/tools/kubectl.test.ts`

**Interfaces:**
- Consumes: `parseIncidents` (`monitor/src/incidents.ts`); `canAttempt`, `recordAttempt`, `getAttemptCount` (`operator/src/circuit-breaker.ts`); `SlidingWindowRateLimiter` (`@pinot-agents/shared`); `matchRunbook` (`operator/src/runbooks/definitions.ts`); `kubectlGet` (`monitor/src/tools/kubectl.ts`).

- [ ] **Step 1: Write `packages/monitor/src/incidents.test.ts`**

```ts
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
```

- [ ] **Step 2: Write `packages/operator/src/circuit-breaker.test.ts`**

Use unique runbook/component keys per test (the store is module-level state).

```ts
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
```

- [ ] **Step 3: Write `packages/shared/src/lifecycle.test.ts`**

```ts
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
```

- [ ] **Step 4: Write `packages/operator/src/runbooks/definitions.test.ts`**

```ts
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
```

- [ ] **Step 5: Write `packages/monitor/src/tools/kubectl.test.ts`**

Tests the security guard without spawning `kubectl` (the dangerous-flag check returns before `execFile`, and invalid enums reject at schema validation).

```ts
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
```

- [ ] **Step 6: Run the full suite**

Run: `pnpm test`
Expected: PASS (7 files total, all green).

- [ ] **Step 7: Verify lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "test: add incident, circuit-breaker, rate-limiter, runbook, kubectl tests"
```

---

### Task 7: Add the shared Fastify factory

Create the `createServer` factory (Fastify + Zod type provider + shared error handler) and a `runWithTimeout` helper in `packages/shared`. Additive only; the old `withTimeout` stays until its consumers are migrated (removed in Task 11/12).

**Files:**
- Create: `packages/shared/src/server.ts`, `packages/shared/src/server.test.ts`
- Modify: `packages/shared/src/index.ts`, `packages/shared/package.json`

**Interfaces:**
- Produces:
  - `createServer(options: CreateServerOptions)` returns a Fastify instance with the `ZodTypeProvider` and a shared error handler installed.
  - `type CreateServerOptions = { agentName: string; bodyLimit?: number; logger?: boolean }`
  - `type AppInstance = ReturnType<typeof createServer>`
  - `class HandlerTimeoutError extends Error` (has `readonly timeoutMs: number`)
  - `runWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T>` (rejects with `HandlerTimeoutError` on timeout)
  - Error-handler contract: `HandlerTimeoutError` to `504 { error }`; schema-validation / bad-JSON (`error.validation` or `statusCode === 400`) to `400 { error }`; anything else logged and returned as `500 { error: 'Internal server error' }`.

- [ ] **Step 1: Add Fastify deps to `packages/shared/package.json`**

Add to `dependencies` (alongside `openai`, `zod`):

```json
"fastify": "^5.8.5",
"fastify-type-provider-zod": "^6.1.0"
```

Then run: `pnpm install`

- [ ] **Step 2: Write the failing factory test `packages/shared/src/server.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createServer, HandlerTimeoutError, runWithTimeout } from './server.js';

describe('createServer', () => {
  it('validates request bodies with Zod and returns 400 on failure', async () => {
    const app = createServer({ agentName: 'test', logger: false });
    app.post('/echo', { schema: { body: z.object({ name: z.string() }) } }, async (req) => req.body);
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
```

- [ ] **Step 3: Run the test to confirm it fails**

Run: `pnpm test -- server.test`
Expected: FAIL (cannot resolve `./server.js` — module not yet created).

- [ ] **Step 4: Write `packages/shared/src/server.ts`**

```ts
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

/** Thrown by runWithTimeout; the shared error handler renders it as a 504. */
export class HandlerTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = 'HandlerTimeoutError';
  }
}

export interface CreateServerOptions {
  /** Agent name, used for log context. */
  agentName: string;
  /** Max request body size in bytes. Default: 1 MiB. */
  bodyLimit?: number;
  /** Enable Fastify's built-in logger. Default: true. */
  logger?: boolean;
}

/**
 * Build a Fastify instance wired with the Zod type provider and a shared error
 * handler. Routes declared with `schema.body`/`schema.querystring` are validated
 * with Zod; failures are rendered as 400 { error }.
 */
export function createServer(options: CreateServerOptions) {
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: options.bodyLimit ?? 1_048_576,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HandlerTimeoutError) {
      reply.status(504).send({ error: error.message });
      return;
    }
    // Zod schema-validation failures and malformed JSON bodies both surface here.
    if (error.validation || error.statusCode === 400) {
      reply.status(400).send({ error: error.message });
      return;
    }
    request.log.error(error, `[${options.agentName}] Unhandled error`);
    reply.status(500).send({ error: 'Internal server error' });
  });

  return app;
}

export type AppInstance = ReturnType<typeof createServer>;

/**
 * Race an async function against a timeout. Rejects with HandlerTimeoutError if
 * `fn` does not settle within `timeoutMs`. The underlying work is not cancelled.
 */
export async function runWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new HandlerTimeoutError(timeoutMs)), timeoutMs);
  });
  try {
    return await Promise.race([fn(), timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
```

- [ ] **Step 5: Export the new API from `packages/shared/src/index.ts`**

Add these lines to `packages/shared/src/index.ts` (keep all existing exports):

```ts
// Fastify server factory
export { createServer, runWithTimeout, HandlerTimeoutError } from './server.js';
export type { CreateServerOptions, AppInstance } from './server.js';
```

- [ ] **Step 6: Run the test to confirm it passes**

Run: `pnpm test -- server.test`
Expected: PASS (4 tests).

- [ ] **Step 7: Verify lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(shared): add Fastify server factory and runWithTimeout"
```

---

### Task 8: Migrate the mitigator to Fastify

Smallest server; proves the factory end to end. Delete the hand-rolled `readBody`/`jsonResponse`/`http` code; register routes on the factory instance.

**Files:**
- Modify: `packages/mitigator/src/index.ts`, `packages/mitigator/package.json`
- Create: `packages/mitigator/src/index.test.ts`

**Interfaces:**
- Consumes: `createServer`, `runWithTimeout`, `registerGracefulShutdown`, `MetricsRegistry`, `getToolSpecs` (from `@pinot-agents/shared`).
- Routes and shapes (unchanged): `GET /health` to `{ ok, agent }`; `POST /dispatch` to `{ correlationId, runbookId, response, toolCalls }` (200), `{ error }` (400/500/504); `GET /rollback` to `{ entries }`; `GET /metrics` to Prometheus text.

- [ ] **Step 1: Add Fastify deps to `packages/mitigator/package.json`**

Add to `dependencies`:
```json
"fastify": "^5.8.5",
"fastify-type-provider-zod": "^6.1.0"
```
Then run: `pnpm install`

- [ ] **Step 2: Rewrite `packages/mitigator/src/index.ts`**

```ts
import OpenAI from 'openai';
import { z } from 'zod';
import {
  createServer,
  getToolSpecs,
  MetricsRegistry,
  registerGracefulShutdown,
  runWithTimeout,
} from '@pinot-agents/shared';
import { config } from './config.js';
import { runAgentLoop } from './agent.js';
import { MITIGATOR_SYSTEM_PROMPT } from './prompts/mitigator.js';
import { getRollbackLog } from './rollback.js';
// Import tools for side-effect registration
import './tools/kubectl-write.js';
import './tools/pinot-write.js';
import './tools/monitor-verify.js';

const metrics = new MetricsRegistry();
const dispatchesReceived = metrics.counter(
  'mitigator_dispatches_received_total',
  'Total dispatches received'
);
const dispatchesCompleted = metrics.counter(
  'mitigator_dispatches_completed_total',
  'Dispatches completed successfully'
);
const dispatchErrors = metrics.counter('mitigator_dispatch_errors_total', 'Dispatch errors');
const dispatchDuration = metrics.histogram(
  'mitigator_dispatch_duration_seconds',
  'Dispatch execution time',
  [1, 5, 10, 30, 60, 120, 300]
);

const client = new OpenAI({ baseURL: config.llm.baseUrl, apiKey: config.llm.apiKey });
const tools = getToolSpecs();
const model = config.llm.model;

const DispatchBody = z.object({
  correlationId: z.string().optional(),
  payload: z
    .object({
      incident: z.unknown().optional(),
      runbookId: z.string().optional(),
    })
    .optional(),
});

async function runDispatch(
  body: z.infer<typeof DispatchBody>
): Promise<{ status: number; body: unknown }> {
  const incident = body.payload?.incident;
  const runbookId = body.payload?.runbookId ?? 'unknown';
  const correlationId = body.correlationId ?? 'none';

  if (!incident) {
    return { status: 400, body: { error: 'Missing payload.incident' } };
  }

  dispatchesReceived.inc();
  console.log(`[dispatch] runbook=${runbookId} correlation=${correlationId}`);
  const dispatchStart = Date.now();

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: MITIGATOR_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Execute runbook "${runbookId}" for the following incident:\n\n${JSON.stringify(incident, null, 2)}\n\nFollow the runbook procedure, capture before/after state, execute remediation, and verify.`,
    },
  ];

  try {
    const result = await runAgentLoop(client, model, messages, tools, config.agent.maxTurns);

    // Audit back to operator
    try {
      await fetch(`${config.services.operatorUrl}/incident`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'mitigator',
          to: 'operator',
          type: 'audit',
          correlationId,
          timestamp: new Date().toISOString(),
          payload: {
            action: 'remediation_complete',
            runbookId,
            response: result.response.slice(0, 500),
            toolCalls: result.toolCalls.length,
          },
        }),
      });
    } catch {
      console.error('[audit] Failed to send audit to operator');
    }

    dispatchesCompleted.inc();
    dispatchDuration.observe((Date.now() - dispatchStart) / 1000);
    console.log(
      `[dispatch] completed runbook=${runbookId} correlation=${correlationId} in ${((Date.now() - dispatchStart) / 1000).toFixed(1)}s`
    );
    return {
      status: 200,
      body: {
        correlationId,
        runbookId,
        response: result.response,
        toolCalls: result.toolCalls.map(({ name, args }) => ({ name, args })),
      },
    };
  } catch (err: unknown) {
    dispatchErrors.inc();
    dispatchDuration.observe((Date.now() - dispatchStart) / 1000);
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[dispatch] failed runbook=${runbookId}: ${msg}`);
    return { status: 500, body: { error: msg } };
  }
}

const app = createServer({ agentName: 'mitigator' });

app.get('/health', async () => ({ ok: true, agent: 'mitigator' }));

app.post('/dispatch', { schema: { body: DispatchBody } }, async (request, reply) => {
  const result = await runWithTimeout(() => runDispatch(request.body), config.dispatchTimeoutMs);
  reply.status(result.status).send(result.body);
});

app.get('/rollback', async () => ({ entries: getRollbackLog() }));

app.get('/metrics', async (_request, reply) => {
  reply.header('Content-Type', 'text/plain; version=0.0.4').send(metrics.toPrometheus());
});

const start = async () => {
  await app.listen({ port: config.server.port, host: '0.0.0.0' });
  console.log(`Mitigator service listening on port ${config.server.port}`);
  console.log(`Model: ${model} | Max turns: ${config.agent.maxTurns}`);
  console.log(`Dispatch timeout: ${config.dispatchTimeoutMs}ms`);
  console.log(`Monitor: ${config.services.monitorUrl} | Operator: ${config.services.operatorUrl}`);
  console.log(`Dry-run mode: ${config.dryRun ? 'ENABLED (write tools will simulate)' : 'DISABLED'}`);
  console.log('Routes: GET /health, POST /dispatch, GET /rollback, GET /metrics');
};
start();

registerGracefulShutdown({
  server: app.server,
  agentName: 'mitigator',
  forceTimeout: config.shutdownTimeoutMs,
});
```

- [ ] **Step 3: Write a smoke test `packages/mitigator/src/index.test.ts`**

This builds an isolated Fastify app that mirrors the non-LLM routes, to prove routing/validation/response shapes without invoking the model. (The live `index.ts` calls `app.listen` at import time, so we do not import it directly in the test.)

```ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createServer } from '@pinot-agents/shared';

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
```

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `pnpm test && pnpm lint && pnpm typecheck`
Expected: all green.

- [ ] **Step 5: Manually smoke-boot the service**

Run: `PORT=3999 timeout 5 pnpm --filter @pinot-agents/mitigator start & sleep 2 && curl -s localhost:3999/health && curl -s localhost:3999/metrics | head -1`
Expected: `{"ok":true,"agent":"mitigator"}` then a Prometheus `# HELP` line. (The `timeout` kills the server after 5s.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(mitigator): migrate node:http server to Fastify"
```

---

### Task 9: Migrate the monitor to Fastify (including SSE)

Convert the monitor, including the SSE `/watch` route (kept via `reply.hijack()` + `reply.raw`) and the session-purge interval cleanup on shutdown.

**Files:**
- Modify: `packages/monitor/src/index.ts`, `packages/monitor/package.json`
- Create: `packages/monitor/src/index.test.ts`

**Interfaces:**
- Routes and shapes (unchanged): `GET /health` to `{ ok: true }`; `POST /sweep` to `{ report, incidents, trends? }`; `POST /chat` to `{ sessionId, response, toolCalls }`; `GET /incidents` to `{ incidents }`; `GET /history` to `{ count, sweeps }`; `GET /watch` SSE (`text/event-stream`, `data: {...}` frames); `GET /metrics` to Prometheus text.

- [ ] **Step 1: Add Fastify deps to `packages/monitor/package.json`**

Add to `dependencies`:
```json
"fastify": "^5.8.5",
"fastify-type-provider-zod": "^6.1.0"
```
Then run: `pnpm install`

- [ ] **Step 2: Rewrite `packages/monitor/src/index.ts`**

```ts
import type { ServerResponse } from 'node:http';
import OpenAI from 'openai';
import { z } from 'zod';
import {
  createServer,
  getToolSpecs,
  MetricsRegistry,
  registerGracefulShutdown,
  runWithTimeout,
} from '@pinot-agents/shared';
import type { Incident, Severity } from '@pinot-agents/shared';
import { config } from './config.js';
// Import tool files to trigger registration via defineTool()
import './tools/kubectl.js';
import './tools/pinot-api.js';
import { MONITOR_SYSTEM_PROMPT } from './prompts/monitor.js';
import { runAgentLoop } from './agent.js';
import { getOrCreateSession, purgeExpired, sessionCount } from './sessions.js';
import { getIncidents, parseIncidents, storeIncidents } from './incidents.js';
import { getSweepHistory, getTrendSummary, recordSweep } from './sweep-history.js';

const metrics = new MetricsRegistry();
const sweepCount = metrics.counter('monitor_sweeps_total', 'Total sweeps executed');
const sweepErrors = metrics.counter('monitor_sweep_errors_total', 'Sweep errors');
const incidentsDetected = metrics.counter(
  'monitor_incidents_detected_total',
  'Total incidents detected'
);
const sweepDuration = metrics.histogram('monitor_sweep_duration_seconds', 'Sweep duration', [
  1, 5, 10, 30, 60, 120, 300,
]);
const chatRequests = metrics.counter('monitor_chat_requests_total', 'Chat requests');

const client = new OpenAI({ baseURL: config.llm.baseUrl, apiKey: config.llm.apiKey });
const tools = getToolSpecs();
const model = config.llm.model;

async function forwardToOperator(incidents: Incident[]): Promise<void> {
  const url = `${config.services.operatorUrl}/incident`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ incidents }),
  });
  if (!res.ok) {
    console.error(`Operator returned ${res.status}: ${await res.text()}`);
  } else {
    console.log(`Forwarded ${incidents.length} incident(s) to operator`);
  }
}

async function runSweep(): Promise<{ status: number; body: unknown }> {
  sweepCount.inc();
  console.log('Starting sweep via /sweep endpoint...');
  const startTime = Date.now();

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: MONITOR_SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        'Perform a complete monitoring sweep of the Pinot cluster and produce the health report.',
    },
  ];

  try {
    const result = await runAgentLoop(client, model, messages, tools, config.agent.maxTurns);
    const durationMs = Date.now() - startTime;
    const elapsedSec = durationMs / 1000;
    sweepDuration.observe(elapsedSec);
    const incidents = parseIncidents(result.response);
    incidentsDetected.inc(incidents.length);
    storeIncidents(incidents);

    const trendSummary = getTrendSummary(incidents);
    recordSweep({
      timestamp: new Date(startTime).toISOString(),
      durationMs,
      incidentCount: incidents.length,
      incidents,
    });

    console.log(
      `Sweep completed in ${elapsedSec.toFixed(1)}s (${result.toolCalls.length} tool calls, ${incidents.length} incidents)`
    );
    if (trendSummary) {
      console.log(trendSummary);
    }

    if (incidents.length > 0) {
      forwardToOperator(incidents).catch((err) =>
        console.error(
          `Failed to forward incidents to operator: ${err instanceof Error ? err.message : err}`
        )
      );
    }

    return {
      status: 200,
      body: { report: result.response, incidents, trends: trendSummary || undefined },
    };
  } catch (err: unknown) {
    sweepErrors.inc();
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Sweep failed: ${msg}`);
    return { status: 500, body: { error: msg } };
  }
}

const ChatBody = z.object({
  sessionId: z.string().optional(),
  message: z.string().min(1),
});

async function runChat(body: z.infer<typeof ChatBody>): Promise<{ status: number; body: unknown }> {
  const session = getOrCreateSession(body.sessionId);
  session.messages.push({ role: 'user', content: body.message });

  chatRequests.inc();
  console.log(`Chat [${session.id}]: "${body.message.slice(0, 80)}"`);

  try {
    const result = await runAgentLoop(
      client,
      model,
      session.messages,
      tools,
      config.agent.maxTurns
    );
    return {
      status: 200,
      body: {
        sessionId: session.id,
        response: result.response,
        toolCalls: result.toolCalls.map(({ name, args }) => ({ name, args })),
      },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Chat failed [${session.id}]: ${msg}`);
    return { status: 500, body: { error: msg } };
  }
}

// --- SSE Watch Mode ---

const watchClients = new Set<ServerResponse>();

async function runMiniSweep(): Promise<{ report: string; incidents: Incident[]; trends?: string }> {
  const startTime = Date.now();
  sweepCount.inc();
  console.log('[watch] Running mini-sweep...');

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: MONITOR_SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        'Perform a complete monitoring sweep of the Pinot cluster and produce the health report.',
    },
  ];

  const result = await runAgentLoop(client, model, messages, tools, config.agent.maxTurns);
  const durationMs = Date.now() - startTime;
  const elapsedSec = durationMs / 1000;
  sweepDuration.observe(elapsedSec);
  const incidents = parseIncidents(result.response);
  incidentsDetected.inc(incidents.length);
  storeIncidents(incidents);

  const trendSummary = getTrendSummary(incidents);
  recordSweep({
    timestamp: new Date(startTime).toISOString(),
    durationMs,
    incidentCount: incidents.length,
    incidents,
  });

  console.log(`[watch] Mini-sweep completed in ${elapsedSec.toFixed(1)}s (${incidents.length} incidents)`);

  if (incidents.length > 0) {
    forwardToOperator(incidents).catch((err) =>
      console.error(
        `Failed to forward incidents to operator: ${err instanceof Error ? err.message : err}`
      )
    );
  }

  return { report: result.response, incidents, trends: trendSummary || undefined };
}

function broadcastSSE(data: unknown): void {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of watchClients) {
    try {
      client.write(payload);
    } catch {
      watchClients.delete(client);
    }
  }
}

let watchInterval: ReturnType<typeof setInterval> | null = null;

function startWatchLoop(): void {
  if (watchInterval) {
    return;
  }
  console.log(`[watch] Starting watch loop (interval: ${config.watch.intervalMs}ms)`);
  watchInterval = setInterval(async () => {
    if (watchClients.size === 0) {
      stopWatchLoop();
      return;
    }
    try {
      const result = await runMiniSweep();
      broadcastSSE({
        type: 'sweep',
        timestamp: new Date().toISOString(),
        incidentCount: result.incidents.length,
        incidents: result.incidents,
        trends: result.trends,
      });
    } catch (err: unknown) {
      sweepErrors.inc();
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[watch] Mini-sweep failed: ${msg}`);
      broadcastSSE({ type: 'error', timestamp: new Date().toISOString(), error: msg });
    }
  }, config.watch.intervalMs);
}

function stopWatchLoop(): void {
  if (watchInterval) {
    console.log('[watch] No clients connected, stopping watch loop');
    clearInterval(watchInterval);
    watchInterval = null;
  }
}

const app = createServer({ agentName: 'monitor' });

app.get('/health', async () => ({ ok: true }));

app.post('/sweep', async (_request, reply) => {
  const result = await runWithTimeout(() => runSweep(), config.server.sweepTimeoutMs);
  reply.status(result.status).send(result.body);
});

app.post('/chat', { schema: { body: ChatBody } }, async (request, reply) => {
  const result = await runWithTimeout(() => runChat(request.body), config.server.chatTimeoutMs);
  reply.status(result.status).send(result.body);
});

app.get('/incidents', async (request, reply) => {
  const severity = (request.query as { severity?: string }).severity?.toUpperCase() as
    | Severity
    | undefined;
  const valid: Severity[] = ['CRITICAL', 'WARNING', 'INFO'];
  if (severity && !valid.includes(severity)) {
    reply.status(400).send({ error: `Invalid severity. Must be one of: ${valid.join(', ')}` });
    return;
  }
  reply.send({ incidents: getIncidents(severity) });
});

app.get('/history', async (request, reply) => {
  const hours = (request.query as { hours?: string }).hours;
  const lastHours = hours ? Number.parseInt(hours, 10) : undefined;
  if (hours && (Number.isNaN(lastHours) || (lastHours ?? 0) <= 0)) {
    reply.status(400).send({ error: "Invalid 'hours' parameter. Must be a positive integer." });
    return;
  }
  const history = getSweepHistory(lastHours);
  reply.send({ count: history.length, sweeps: history });
});

app.get('/watch', (request, reply) => {
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  raw.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);

  watchClients.add(raw);
  console.log(`[watch] Client connected (${watchClients.size} total)`);
  startWatchLoop();

  request.raw.on('close', () => {
    watchClients.delete(raw);
    console.log(`[watch] Client disconnected (${watchClients.size} remaining)`);
    if (watchClients.size === 0) {
      stopWatchLoop();
    }
  });
});

app.get('/metrics', async (_request, reply) => {
  reply.header('Content-Type', 'text/plain; version=0.0.4').send(metrics.toPrometheus());
});

// Purge expired sessions every 10 minutes
const purgeInterval = setInterval(() => {
  const purged = purgeExpired();
  if (purged > 0) {
    console.log(`Purged ${purged} expired session(s), ${sessionCount()} remaining`);
  }
}, 600_000);
purgeInterval.unref();

const start = async () => {
  await app.listen({ port: config.server.port, host: '0.0.0.0' });
  console.log(`Pinot Monitor server listening on port ${config.server.port}`);
  console.log(`Model: ${model} | Max turns: ${config.agent.maxTurns} | Endpoint: ${config.llm.baseUrl}`);
  console.log(`Timeouts: sweep=${config.server.sweepTimeoutMs}ms, chat=${config.server.chatTimeoutMs}ms`);
  console.log(`Watch interval: ${config.watch.intervalMs}ms`);
  console.log(
    'Routes: GET /health, POST /sweep, POST /chat, GET /incidents, GET /history, GET /watch, GET /metrics'
  );
};
start();

registerGracefulShutdown({
  server: app.server,
  agentName: 'monitor',
  forceTimeout: config.server.shutdownTimeoutMs,
  onShutdown: () => {
    clearInterval(purgeInterval);
    stopWatchLoop();
    for (const client of watchClients) {
      client.end();
    }
    watchClients.clear();
  },
});
```

Note: `parseQueryString` and the `import http` are gone (Fastify parses query strings into `request.query`). The `_signal` AbortSignal plumbing is dropped; the timeout is enforced by `runWithTimeout`.

- [ ] **Step 3: Write a smoke test `packages/monitor/src/index.test.ts`**

Covers the non-LLM routes and validation. (Does not import `index.ts`, which listens at import time.)

```ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createServer } from '@pinot-agents/shared';

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
```

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `pnpm test && pnpm lint && pnpm typecheck`
Expected: all green.

- [ ] **Step 5: Manually smoke-boot the service (including SSE)**

Run:
```bash
PORT=3998 timeout 6 pnpm --filter @pinot-agents/monitor start & sleep 2 \
  && curl -s localhost:3998/health \
  && curl -s localhost:3998/incidents \
  && curl -s --max-time 2 localhost:3998/watch | head -1
```
Expected: `{"ok":true}`, then `{"incidents":[]}`, then an SSE line `data: {"type":"connected",...}`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(monitor): migrate node:http server to Fastify with SSE"
```

---

### Task 10: Migrate the operator to Fastify

Convert the operator. All triage business logic is preserved verbatim; only the HTTP shell, the two request-handling functions (`handleIncident`, `handleApproval`), and the small handlers change. Rate limiting becomes a route `preHandler`; `/approve/:id` and `/reject/:id` become real params.

**Files:**
- Modify: `packages/operator/src/index.ts`, `packages/operator/package.json`
- Create: `packages/operator/src/index.test.ts`

**Interfaces:**
- Preserve UNCHANGED: `dispatchToMitigator`, `sendAlert`, `verifyIncidentState`, `triageIncident`, `TriageResult`, `PendingApproval`, all module-level state (`metrics`, `incidentRateLimiter`, `activeRemediations`, `pendingApprovals`, `MAX_CONCURRENT_REMEDIATIONS`) and all imports except: drop `http`, add `createServer`.
- Routes and shapes (unchanged): `GET /health` to `{ ok, agent }`; `POST /incident` to `{ results, validationErrors? }` (200) / `{ error }` (400) / `{ error }` (429 with `Retry-After`) / `{ received, type }` (audit callback); `GET /audit` to `{ entries }`; `GET /metrics` Prometheus; `GET /novel-incidents` to `{ incidents }`; `GET /pending-approvals` to `{ approvals }`; `POST /approve/:id` and `POST /reject/:id` to `{ status, ... }` / `{ error }` (404/409).

- [ ] **Step 1: Add Fastify deps to `packages/operator/package.json`**

Add to `dependencies`:
```json
"fastify": "^5.8.5",
"fastify-type-provider-zod": "^6.1.0"
```
Then run: `pnpm install`

- [ ] **Step 2: Update the imports at the top of `packages/operator/src/index.ts`**

Replace the first import lines. Current:
```ts
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { Incident as IncidentSchema } from '@pinot-agents/shared';
import type { Incident } from '@pinot-agents/shared';
import { MetricsRegistry, registerGracefulShutdown, SlidingWindowRateLimiter } from '@pinot-agents/shared';
```
New:
```ts
import { randomUUID } from 'node:crypto';
import { Incident as IncidentSchema } from '@pinot-agents/shared';
import type { Incident } from '@pinot-agents/shared';
import {
  createServer,
  MetricsRegistry,
  registerGracefulShutdown,
  SlidingWindowRateLimiter,
} from '@pinot-agents/shared';
```

- [ ] **Step 3: Delete the `jsonResponse` and `readBody` helper functions**

Remove these two functions entirely (they are no longer used):
```ts
function jsonResponse(res: http.ServerResponse, status: number, body: unknown): void { ... }
function readBody(req: http.IncomingMessage): Promise<string> { ... }
```

- [ ] **Step 4: Replace `handleIncident` with a body-in / result-out version**

Replace the whole `async function handleIncident(req, res) { ... }` with:

```ts
async function handleIncident(body: {
  from?: string;
  type?: string;
  payload?: { action?: string; runbookId?: string };
  incidents?: Incident[];
  incident?: Incident;
}): Promise<{ status: number; body: unknown }> {
  // Handle audit callback from mitigator: clear active remediation for the component
  if (body.from === 'mitigator' && body.type === 'audit') {
    const runbookId = body.payload?.runbookId;
    for (const [component, active] of activeRemediations) {
      if (active.runbookId === runbookId) {
        activeRemediations.delete(component);
        console.log(`[blast-radius] Cleared active remediation for ${component} (runbook=${runbookId})`);
        break;
      }
    }
    return { status: 200, body: { received: true, type: 'audit' } };
  }

  const rawIncidents = body.incidents ?? (body.incident ? [body.incident] : []);
  if (rawIncidents.length === 0) {
    return { status: 400, body: { error: 'No incidents provided' } };
  }

  // Validate each incident at the system boundary
  const validIncidents: Incident[] = [];
  const validationErrors: { index: number; errors: string[] }[] = [];

  for (let i = 0; i < rawIncidents.length; i++) {
    const parsed = IncidentSchema.safeParse(rawIncidents[i]);
    if (!parsed.success) {
      validationErrors.push({
        index: i,
        errors: parsed.error.issues.map((iss) => `${iss.path.join('.')}: ${iss.message}`),
      });
      continue;
    }
    const incident = parsed.data;
    if (!incident.component.trim()) {
      validationErrors.push({ index: i, errors: ['component must be a non-empty string'] });
      continue;
    }
    if (incident.evidence.length === 0) {
      validationErrors.push({ index: i, errors: ['evidence must be a non-empty array'] });
      continue;
    }
    validIncidents.push(incident);
  }

  if (validIncidents.length === 0) {
    return { status: 400, body: { error: 'All incidents failed validation', validationErrors } };
  }

  const results: TriageResult[] = [];
  for (const incident of validIncidents) {
    const result = await triageIncident(incident);
    results.push(result);
  }

  return {
    status: 200,
    body: { results, ...(validationErrors.length > 0 ? { validationErrors } : {}) },
  };
}
```

- [ ] **Step 5: Replace `handleAuditLog`, `handleHealth`, and `handleApproval`**

Replace all three with:

```ts
function getAuditResponse() {
  return { entries: getAuditLog() };
}

async function handleApproval(
  approvalId: string,
  approve: boolean
): Promise<{ status: number; body: unknown }> {
  const pending = pendingApprovals.get(approvalId);
  if (!pending) {
    return { status: 404, body: { error: 'Approval not found' } };
  }
  if (pending.status !== 'pending') {
    return { status: 409, body: { error: `Already ${pending.status}` } };
  }

  pending.status = approve ? 'approved' : 'rejected';

  if (approve) {
    incidentsDispatched.inc();
    const result = await dispatchToMitigator(pending.incident, pending.runbookId, pending.correlationId);
    const entry = {
      timestamp: new Date().toISOString(),
      agent: 'operator',
      action: 'dispatch_approved',
      target: pending.incident.component,
      inputSummary: `runbook=${pending.runbookId}, approvalId=${approvalId}`,
      outputSummary: result.success
        ? 'Dispatched after human approval'
        : `Dispatch failed: ${result.message}`,
      correlationId: pending.correlationId,
    };
    logAudit(entry);
    persistAuditEntry(entry);
    return { status: 200, body: { status: 'approved', dispatch: result } };
  }

  const entry = {
    timestamp: new Date().toISOString(),
    agent: 'operator',
    action: 'dispatch_rejected',
    target: pending.incident.component,
    inputSummary: `runbook=${pending.runbookId}, approvalId=${approvalId}`,
    outputSummary: 'Rejected by human',
    correlationId: pending.correlationId,
  };
  logAudit(entry);
  persistAuditEntry(entry);
  return { status: 200, body: { status: 'rejected' } };
}
```

(`handleHealth` is inlined into the route below; `handleAuditLog` is replaced by `getAuditResponse`.)

- [ ] **Step 6: Replace the `http.createServer(...)` block, `server.listen(...)`, and `registerGracefulShutdown(...)` with the Fastify bootstrap**

Replace everything from `const server = http.createServer(...)` to the end of the file with:

```ts
const TRUST_LABELS = ['observe', 'suggest', 'approve', 'auto-remediate'] as const;

const app = createServer({ agentName: 'operator' });

app.get('/health', async () => ({ ok: true, agent: 'operator' }));

app.post(
  '/incident',
  {
    preHandler: async (_request, reply) => {
      if (!incidentRateLimiter.tryAcquire()) {
        rateLimitRejections.inc();
        console.warn(`[rate-limit] Rejected POST /incident (remaining: ${incidentRateLimiter.remaining})`);
        reply.header('Retry-After', String(Math.ceil(config.rateLimit.windowMs / 1000)));
        return reply.status(429).send({ error: 'Rate limit exceeded. Try again later.' });
      }
    },
  },
  async (request, reply) => {
    const result = await handleIncident(
      (request.body ?? {}) as Parameters<typeof handleIncident>[0]
    );
    reply.status(result.status).send(result.body);
  }
);

app.get('/audit', async () => getAuditResponse());

app.get('/metrics', async (_request, reply) => {
  reply.header('Content-Type', 'text/plain; version=0.0.4').send(metrics.toPrometheus());
});

app.get('/novel-incidents', async () => ({ incidents: getNovelIncidents() }));

app.get('/pending-approvals', async () => ({
  approvals: Array.from(pendingApprovals.values()).filter((a) => a.status === 'pending'),
}));

app.post('/approve/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const result = await handleApproval(id, true);
  reply.status(result.status).send(result.body);
});

app.post('/reject/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const result = await handleApproval(id, false);
  reply.status(result.status).send(result.body);
});

const start = async () => {
  await app.listen({ port: config.server.port, host: '0.0.0.0' });
  console.log(`Operator service listening on port ${config.server.port}`);
  console.log(`Trust level: ${config.trustLevel} (${TRUST_LABELS[config.trustLevel]})`);
  console.log(`Rate limit: ${config.rateLimit.maxRequests} req/${config.rateLimit.windowMs}ms`);
  console.log(`Monitor: ${config.services.monitorUrl} | Mitigator: ${config.services.mitigatorUrl}`);
  console.log(
    'Routes: GET /health, POST /incident, GET /audit, GET /metrics, GET /novel-incidents, GET /pending-approvals, POST /approve/:id, POST /reject/:id'
  );
};
start();

registerGracefulShutdown({
  server: app.server,
  agentName: 'operator',
  forceTimeout: config.shutdownTimeoutMs,
});
```

- [ ] **Step 7: Write a smoke test `packages/operator/src/index.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { createServer } from '@pinot-agents/shared';

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
```

- [ ] **Step 8: Run tests, lint, typecheck**

Run: `pnpm test && pnpm lint && pnpm typecheck`
Expected: all green (10 test files).

- [ ] **Step 9: Manually smoke-boot the service**

Run:
```bash
PORT=3997 timeout 5 pnpm --filter @pinot-agents/operator start & sleep 2 \
  && curl -s localhost:3997/health \
  && curl -s -X POST localhost:3997/incident -H 'content-type: application/json' -d '{}' \
  && curl -s -X POST localhost:3997/approve/nope
```
Expected: `{"ok":true,"agent":"operator"}`, then `{"error":"No incidents provided"}`, then `{"error":"Approval not found"}`.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor(operator): migrate node:http server to Fastify"
```

---

### Task 11: Enable `noUncheckedIndexedAccess` and fix hotspots (deferrable)

Turn on the last strict flag and fix the type errors it surfaces. This is a self-contained hardening task; if the churn is judged not worth it during review, skip it and note the decision. It only ships if it lands green.

**Files:**
- Modify: `tsconfig.base.json`, plus files reported by `tsc -b` (known hotspots: `packages/shared/src/metrics.ts`, `packages/shared/src/lifecycle.ts`, `packages/monitor/src/incidents.ts`, `packages/monitor/src/tools/kubectl.ts`)

- [ ] **Step 1: Enable the flag**

In `tsconfig.base.json`, add to `compilerOptions`:
```json
"noUncheckedIndexedAccess": true
```

- [ ] **Step 2: Run typecheck to see the errors**

Run: `pnpm typecheck`
Expected: FAIL with a list of `possibly 'undefined'` errors. Note which files/lines.

- [ ] **Step 3: Fix the known hotspots**

Apply guards/narrowing at each reported site. Representative fixes:

In `packages/shared/src/metrics.ts`, the `Histogram.observe` and `toPrometheus` loops index `this.buckets[i]` / `this.bucketCounts[i]`. Narrow with a local:
```ts
// observe():
for (let i = 0; i < this.buckets.length; i++) {
  const bucket = this.buckets[i];
  const bucketCount = this.bucketCounts[i];
  if (bucket !== undefined && bucketCount !== undefined && value <= bucket) {
    this.bucketCounts[i] = bucketCount + 1;
  }
}
```
Apply the same `const bucket = this.buckets[i]` narrowing in `toPrometheus`.

In `packages/shared/src/lifecycle.ts`, `this.timestamps[0]` is `number | undefined`. In both `while` loops change:
```ts
while (this.timestamps.length > 0 && (this.timestamps[0] ?? Infinity) <= windowStart) {
  this.timestamps.shift();
}
```

In `packages/monitor/src/incidents.ts`, regex-match group access (`jsonBlockMatch[1]`, `issuesMatch[1]`) is `string | undefined`. Guard each:
```ts
const jsonBlock = jsonBlockMatch[1];
if (jsonBlock === undefined) {
  return extractFromReport(response);
}
const parsed = JSON.parse(jsonBlock);
```
and
```ts
const issuesText = (issuesMatch[1] ?? '').trim();
```

In `packages/monitor/src/tools/kubectl.ts`, `tsMatch[1]` in the date filter is `string | undefined`:
```ts
const tsMatch = line.match(/^(\S+)/);
if (!tsMatch || tsMatch[1] === undefined) {
  return false;
}
const ts = new Date(tsMatch[1]);
```

Fix any additional sites the compiler reports using the same pattern (narrow to a local `const`, guard `undefined`, or use `?? fallback`).

- [ ] **Step 4: Re-run typecheck until green**

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 5: Run tests and lint**

Run: `pnpm test && pnpm lint`
Expected: both green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "build: enable noUncheckedIndexedAccess and fix index-access sites"
```

---

### Task 12: Update docs, remove dead code, final verification

Update `CLAUDE.md` to the new stack, remove the now-unused `withTimeout`, and run the full gate.

**Files:**
- Modify: `CLAUDE.md`, `packages/shared/src/lifecycle.ts`, `packages/shared/src/index.ts`

- [ ] **Step 1: Remove the now-unused `withTimeout`**

In `packages/shared/src/lifecycle.ts`, delete the entire `withTimeout` function and its `// ─── Request Timeout ───` comment block. Keep `registerGracefulShutdown` and `SlidingWindowRateLimiter` (and the `import http from 'node:http'`, still used by `registerGracefulShutdown`).

In `packages/shared/src/index.ts`, remove `withTimeout` from the lifecycle export so it reads:
```ts
export { registerGracefulShutdown, SlidingWindowRateLimiter } from './lifecycle.js';
export type { GracefulShutdownOptions, RateLimiterOptions } from './lifecycle.js';
```

- [ ] **Step 2: Verify nothing still imports `withTimeout`**

Run: `grep -rn "withTimeout" packages/*/src`
Expected: no matches (only `runWithTimeout` may appear, which is a different symbol; confirm no bare `withTimeout` remains).

- [ ] **Step 3: Update the Commands section of `CLAUDE.md`**

Replace the fenced Commands block with:
```bash
pnpm install                     # Install dependencies
pnpm start                       # Run monitor on :3000
pnpm start:operator              # Run operator on :3002
pnpm start:mitigator             # Run mitigator on :3001
pnpm start:all                   # Run all 3 services
pnpm typecheck                   # Type-check all packages (tsc -b)
pnpm lint                        # Lint + format check (Biome)
pnpm lint:fix                    # Auto-fix lint + format (Biome)
pnpm test                        # Run unit tests (Vitest)
docker build -t pinot-monitor .  # Build container image
```
Then replace the line `No test framework is configured. No linter is configured.` with:
`Tests run with Vitest (`pnpm test`). Lint and format use Biome (`pnpm lint`).`

- [ ] **Step 4: Update stack references in `CLAUDE.md`**

- In the Architecture section, change the description of the servers from "bare `node:http` server" to "Fastify 5 server built via the shared `createServer` factory" (monitor `src/index.ts` line reference).
- In `packages/shared`, add a bullet: "`src/server.ts` — Fastify factory (`createServer`), `runWithTimeout`, and shared error handler."
- In Key Conventions, add: "HTTP servers are built with Fastify 5 via `createServer()` from `@pinot-agents/shared`; request bodies are validated with Zod through `fastify-type-provider-zod`."
- Remove the `--legacy-peer-deps` note wherever it appears (it is no longer needed under pnpm).

- [ ] **Step 5: Full verification gate**

Run: `pnpm install && pnpm lint && pnpm typecheck && pnpm test`
Expected: all four exit 0.

- [ ] **Step 6: Boot all three services and confirm health**

Run:
```bash
pnpm start:all & sleep 3 \
  && curl -s localhost:3000/health \
  && curl -s localhost:3001/health \
  && curl -s localhost:3002/health \
  && kill %1
```
Expected: `{"ok":true}`, `{"ok":true,"agent":"mitigator"}`, `{"ok":true,"agent":"operator"}`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "docs: update CLAUDE.md for pnpm/Biome/Vitest/Fastify; drop unused withTimeout"
```

---

## Notes on deviations from the spec

- **Routes are registered inline in each service's `index.ts`** on the shared `createServer` instance, rather than in separate `src/routes/` plugin files. The handlers close over module-level singletons (metrics, OpenAI client, in-memory stores, SSE client set), so inline registration is lower-risk and avoids threading all that state through a plugin. The core modernization (Fastify factory, Zod validation, native body parsing, shared error handling) is fully delivered.
- **`@fastify/sensible` is not added.** The custom error handler in `createServer` covers the `{ error }` response contract; `httpErrors` are not needed.
- **Two intentional response drifts** (status codes unchanged): the `error` message string for malformed JSON and for schema-validation failures now comes from Fastify/Zod rather than the old hand-written strings.
