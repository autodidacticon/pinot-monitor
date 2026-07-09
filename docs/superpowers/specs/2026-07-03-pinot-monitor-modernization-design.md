# Modernize pinot-monitor to artisan conventions

Date: 2026-07-03
Status: Approved (design), pending spec review

## Summary

Modernize the pinot-monitor TypeScript monorepo to match the tooling and web-framework
conventions of the artisan repo (`~/git/artisan`). The stacks already agree on the
fundamentals (ESM, TypeScript strict, `moduleResolution: bundler`, Zod v4, run-via-`tsx`
with no bundler build), so this is mostly additive tooling plus one real code migration
(the three HTTP servers move from bare `node:http` to Fastify).

Five workstreams, in order:

1. pnpm migration (foundation)
2. tsconfig base consolidation
3. Biome (lint + format)
4. Vitest (test framework + starter suite)
5. Fastify migration (the one behavior-surface change)

Explicitly out of scope (decided with the user): git hooks (husky/lint-staged),
commitlint, and CI (GitHub Actions). Also explicitly not adopted from artisan: the
`tsgo` native compiler, the no-project-references / path-alias model, and self-hosted
CI runners. These are large-codebase decisions with no payoff for a 4-package repo.

## Current state (pinot-monitor)

- npm workspaces, single root `package-lock.json`. Requires `npm install --legacy-peer-deps`
  because `zod ^4.3.6` violates the zod v3 peer range declared by `openai ^4.96.0`.
- 4 packages: `@pinot-agents/shared`, `@pinot-agents/monitor`, `@pinot-agents/operator`,
  `@pinot-agents/mitigator`. ESM everywhere (`"type": "module"`). Internal deps pinned as `"*"`.
- TypeScript: root is solution-style (`files: []` + `references`); typecheck is `tsc -b`.
  All four package tsconfigs duplicate an identical `compilerOptions` block (target ES2022,
  module ES2022, moduleResolution bundler, strict, esModuleInterop, skipLibCheck,
  resolveJsonModule, declaration, outDir dist). `composite: true` only on `shared`.
  No shared base tsconfig, so the four copies can drift.
- Runtime: services run straight off `.ts` via `tsx src/index.ts`; `main`/`types` point at
  raw `src/index.ts`. No build artifact is consumed at runtime. `@types/node` is `^25.3.3`,
  but there is no `.nvmrc` / `engines` pin.
- No linter, no formatter, no test framework. Root `test` script is `echo "..." && exit 1`.
- Three servers hand-rolled on bare `node:http`:
  - monitor `src/index.ts` (~356 lines): `GET /health`, `POST /sweep`, `POST /chat`,
    `GET /incidents`, `GET /history`, `GET /watch` (SSE), `GET /metrics`.
  - operator `src/index.ts` (~564 lines, most is triage logic): `GET /health`,
    `POST /incident`, `GET /audit`, `GET /metrics`, `GET /novel-incidents`,
    `GET /pending-approvals`, `POST /approve/:id`, `POST /reject/:id`.
  - mitigator `src/index.ts` (~161 lines): `GET /health`, `POST /dispatch`,
    `GET /rollback`, `GET /metrics`.
  - `readBody`, `jsonResponse`, and the outer try/catch error handler are copy-pasted
    verbatim across all three files. No body size limits, no content-type checks.
  - Operator does string-prefix path params (`startsWith('/approve/')` + `slice`).
  - Only operator validates with Zod (`IncidentSchema.safeParse`); monitor and mitigator
    do ad-hoc field checks.
  - Cross-cutting concerns are custom shared utilities, not middleware: `withTimeout` HOF
    (passes an `AbortSignal` handlers currently ignore), `SlidingWindowRateLimiter`
    (operator `POST /incident` only), `registerGracefulShutdown` (assumes `http.Server`),
    `MetricsRegistry` (`toPrometheus()`).
  - Monitor `/watch` grabs the raw `ServerResponse`, keeps clients in a `Set`, writes SSE
    frames by hand, cleans up on `req.on('close')`.

## Target conventions (artisan), the parts that apply

- Package manager: `pnpm@10.28.2`, lockfile v9, `.npmrc` with `auto-install-peers=true`
  and `strict-peer-dependencies=false`, `.nvmrc` = `22`, `engines.node >= 22.0.0`.
- Lint + format: Biome 2.4.8 as the single tool (no ESLint/Prettier). Formatter: space
  indent width 2, line width 100; JS/TS `semicolons: always`, `quoteStyle: single`,
  `trailingCommas: es5`, `bracketSpacing: true`, `bracketSameLine: false`. Linter
  recommended-on with `noUnusedVariables: error`, `noUnusedImports: error`,
  `noExplicitAny: warn`, `useArrowFunction: warn`. `vcs.useIgnoreFile: true`.
- Tests: Vitest 4.0.18, `pool: 'forks'`, `environment: 'node'`, `globals: true`.
  Convention: `*.test.ts` collocated with source; no coverage thresholds defined.
- Web framework: Fastify 5.8.5 uniformly, behind a shared factory
  `createFastifyInstance()` in `libs/api-core` that builds the instance, wires the Pino
  logger, sets up the `fastify-type-provider-zod` (6.1.0) validator/serializer, and
  registers common plugins. Routes are Fastify plugins (`FastifyPluginAsync` /
  `FastifyPluginAsyncZod`) under `src/routes/`, registered with `fastify.register()`;
  `server.ts` adds global hooks and a shared error handler, then `fastify.listen()`.
- TypeScript: a `tsconfig.base.json` with ESNext target/module/lib, `moduleResolution:
  bundler`, `noEmit`, `strict`, plus `noUncheckedIndexedAccess`, `noImplicitOverride`,
  `noFallthroughCasesInSwitch`, `moduleDetection: force`.

## Workstream 1: pnpm migration

Goal: replace npm with pnpm, deleting the `--legacy-peer-deps` requirement and aligning
the command surface with artisan.

Changes:

- Root `package.json`: add `"packageManager": "pnpm@10.28.2"` and
  `"engines": { "node": ">=22.0.0" }`. Remove the `workspaces` field (pnpm uses
  `pnpm-workspace.yaml`). Rewrite scripts:
  - `start`: `pnpm --filter @pinot-agents/monitor start`
  - `start:operator`: `pnpm --filter @pinot-agents/operator start`
  - `start:mitigator`: `pnpm --filter @pinot-agents/mitigator start`
  - `start:all`: keep the existing background-and-wait shape, translated to pnpm
    (`pnpm --filter @pinot-agents/monitor start & pnpm --filter @pinot-agents/operator start & pnpm --filter @pinot-agents/mitigator start & wait`).
  - `typecheck`: keep `tsc -b packages/shared packages/monitor packages/operator packages/mitigator`.
- Add `pnpm-workspace.yaml`:
  ```yaml
  packages:
    - 'packages/*'
  ```
- Add `.npmrc`:
  ```
  auto-install-peers=true
  strict-peer-dependencies=false
  use-lockfile-v9=true
  ```
- Add `.nvmrc` containing `22`.
- Change internal deps in monitor/operator/mitigator: `"@pinot-agents/shared": "*"` to
  `"@pinot-agents/shared": "workspace:*"`.
- Reconcile `@types/node` from `^25.3.3` to `^22` (match the pinned Node 22 runtime) in
  every package that declares it.
- Delete `package-lock.json`; run `pnpm install` to generate `pnpm-lock.yaml`.
- Dockerfile: switch the install to pnpm (enable corepack or pin pnpm, copy
  `pnpm-lock.yaml`, `pnpm install --frozen-lockfile`), drop `--legacy-peer-deps`. Read the
  current Dockerfile during implementation and adapt precisely.
- Update the Commands section of `CLAUDE.md` to pnpm (`pnpm install`, `pnpm start`, etc.)
  and remove the `--legacy-peer-deps` note.

Risk: pnpm's strict isolation can surface a package relying on npm flat hoisting. Given the
only runtime deps are openai, zod, @types/node, tsx, typescript, this is low; fix by
declaring any missing dep explicitly.

Verify: `pnpm install` clean (no peer-dep flag), `pnpm typecheck` green, each service boots
and answers `GET /health`.

## Workstream 2: tsconfig base consolidation

Goal: one source of truth for compiler options; align with artisan's stricter settings;
keep project references.

Changes:

- Create `tsconfig.base.json` at repo root:
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
      "noFallthroughCasesInSwitch": true,
      "noUncheckedIndexedAccess": true
    }
  }
  ```
- Each package `tsconfig.json`: `"extends": "../../tsconfig.base.json"` and keep only
  package-local settings: `outDir`, `rootDir`, `declaration`, `composite` (shared only),
  `references` (monitor/operator/mitigator to shared), `include`.
- Root `tsconfig.json` stays solution-style (`files: []` + `references`). Keep `tsc -b`.

Decision: keep project references and stock `tsc`. Do not adopt artisan's no-references /
path-alias model or its `tsgo` compiler.

Risk: `noUncheckedIndexedAccess` will surface real type errors across index/array access.
Do the fix pass. If the churn is disproportionate to the value, defer this one flag (keep
`noImplicitOverride` and `noFallthroughCasesInSwitch`, which are low churn) and note it.

Verify: `tsc -b` green after the fix pass.

## Workstream 3: Biome

Goal: introduce a single lint + format tool matching artisan's style.

Changes:

- Add `@biomejs/biome@2.4.8` as a root devDependency.
- Add `biome.json`:
  ```json
  {
    "$schema": "https://biomejs.dev/schemas/2.4.8/schema.json",
    "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
    "files": { "includes": ["**", "!**/dist", "!data", "!k8s"] },
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
- Add root scripts:
  ```json
  "lint": "biome check .",
  "lint:fix": "biome check --write .",
  "format": "biome format --write .",
  "format:check": "biome format ."
  ```
- Run `biome check --write .` once and land the reformat + safe autofixes as a single
  isolated "apply biome formatting" commit so it does not pollute later diffs.

Notes: the trimmed config drops artisan's `overrides` (frontend/backend import boundaries),
`css`, and `jsxRuntime` blocks, none of which apply here. `noUnusedVariables`/
`noUnusedImports` are errors; the currently-ignored `_signal` params are underscore-prefixed
so Biome treats them as intentional, but verify on the first run.

Verify: `biome check .` clean (warnings allowed, errors not).

## Workstream 4: Vitest

Goal: add a test framework and a starter suite over the high-value pure logic.

Changes:

- Add `vitest@4.0.18` as a root devDependency (add `@vitest/coverage-v8@4.0.18` only if a
  coverage number is wanted later).
- Add `vitest.config.ts`:
  ```ts
  import { defineConfig } from 'vitest/config';

  export default defineConfig({
    test: {
      globals: true,
      environment: 'node',
      pool: 'forks',
      include: ['packages/*/src/**/*.test.ts', 'tests/**/*.test.ts'],
    },
  });
  ```
- Replace the root `test` placeholder script with `vitest run`; add `test:watch` = `vitest`.
- Seed unit tests (collocated `*.test.ts`) over the pure, dependency-free logic:
  - `shared/src/tools/registry.ts`: Zod-to-OpenAI JSON schema conversion, spec/handler lookup.
  - `monitor/src/incidents.ts`: parsing structured incidents from LLM sweep text.
  - `operator/src/circuit-breaker.ts`: attempt tracking + cooldown transitions.
  - shared `SlidingWindowRateLimiter`: window acquire/expire behavior.
  - `operator/src/runbooks/definitions.ts`: pattern matching selects the right runbook.
  - `monitor/src/config.ts`: URL builders.
  - `monitor/src/tools/kubectl.ts`: whitelist enforcement and dangerous-flag rejection
    (security-critical).

Single-config rationale: artisan's multi-project/shard vitest config exists for its
integration/temporal/frontend suites and live services (Postgres/OpenSearch); a 4-package
repo needs one config. If cross-package imports fail to resolve under Vitest, add
`vite-tsconfig-paths` or run with `NODE_OPTIONS='--import tsx'` as a fallback (artisan
documents that Node 22 type-stripping can choke on cross-package `.ts` imports).

Verify: `vitest run` green.

## Workstream 5: Fastify migration

Goal: move the three servers from bare `node:http` to Fastify 5.x behind a shared factory,
preserving every JSON response shape so the Monitor to Operator to Mitigator to Monitor
loop keeps working. Done service by service, smallest first.

### Shared factory (`packages/shared`)

- Add `fastify@5.8.5` and `fastify-type-provider-zod@6.1.0` (and `@fastify/sensible`) to
  `shared` dependencies, and to each service that declares Fastify route types.
- Build `createServer(opts)` mirroring artisan's `createFastifyInstance`:
  - create the Fastify instance with a logger option,
  - call a `setupZodTypeProvider()` helper that sets the validator and serializer compilers
    from `fastify-type-provider-zod`,
  - register `@fastify/sensible` (for `httpErrors`),
  - return the typed instance.
- Add a shared error handler helper (mirroring artisan's `createFastifyErrorHandler`) that
  preserves the current response contract: unhandled errors return `500 { error: "..." }`,
  and validation errors return `400 { error: "..." }`.
- Export a `FastifyPluginAsyncZod` type alias for schema-validated route plugins.

### Per-service migration (each service)

- Delete the copy-pasted `readBody`, `jsonResponse`, and outer try/catch. Use native JSON
  body parsing (set a `bodyLimit` on the instance; there is none today) and `reply.send()`.
- Convert the `if/else` method+path ladder into Fastify route plugins under `src/routes/`,
  registered via `app.register()` from the service entrypoint.
- Add Zod `schema.body` and `schema.response.<status>` where a request has a body. This
  finally validates monitor `/chat` and `/sweep` and mitigator `/dispatch`, which today do
  only ad-hoc checks. Operator already has `IncidentSchema`; move it into `schema.body`.
- Keep `MetricsRegistry`, config, and all business logic unchanged.

### Tricky spots (explicit)

- Monitor SSE `/watch`: keep the existing client-`Set` + `broadcastSSE` logic by taking
  over the raw response with `reply.hijack()` and writing frames to `reply.raw`. Clean up
  on `reply.raw.on('close')`. This is the smallest-change port.
- `/metrics` (all services): `reply.type('text/plain; version=0.0.4').send(metrics.toPrometheus())`.
- Graceful shutdown: `registerGracefulShutdown` assumes an `http.Server`. Wire it to
  `app.server` and call `app.close()` for connection draining, keeping the existing
  `onShutdown` hooks (monitor clears the session-purge interval, stops the watch loop, and
  closes SSE clients).
- Rate limiting: keep the tested `SlidingWindowRateLimiter` as a route-scoped `preHandler`
  on operator `POST /incident`, returning `429` with a `Retry-After` header. Do not swap in
  a plugin.
- Timeouts: preserve the sweep/chat/dispatch timeout values (`config.server.sweepTimeoutMs`
  900000, `chatTimeoutMs` 600000, mitigator `dispatchTimeoutMs`) via a small per-route
  timeout wrapper. Drop the currently-unused `AbortSignal` plumbing.
- Operator path params: `startsWith('/approve/')` + `slice` becomes real `:id` route params
  (`POST /approve/:id`, `POST /reject/:id`).

### Migration order

1. Shared factory + error handler + zod type provider.
2. mitigator (161 lines, no SSE): proves the factory end to end.
3. monitor (SSE + metrics + sessions + watch loop): solves the SSE port.
4. operator (largest logic, smallest HTTP shell): rate limit, path params, approvals.

Add route-level smoke tests as each service is migrated: `GET /health` and the main POST
per service, asserting status and response shape.

Risk: response-contract drift breaking the inter-agent loop. Mitigate by preserving JSON
shapes exactly and by the smoke tests. `fastify-type-provider-zod` 6.x is proven against
Zod v4 in artisan (Zod 4.1.13), so the Zod 4.3.6 here is compatible.

Verify: `tsc -b` + `biome check` + `vitest run` green; each service boots and answers its
routes; a manual pass of the incident dispatch loop still round-trips.

## What does not change

The agent tool-calling loop, incident store, sessions, audit log, runbooks, circuit breaker,
config, metrics registry, and all tool implementations are framework-agnostic and stay as
is. This is a tooling and HTTP-shell modernization, not a rewrite of the agent behavior.

## Overall verification (end state)

- `pnpm install` with no peer-dep flags.
- `pnpm typecheck` (`tsc -b`) green.
- `pnpm lint` (`biome check .`) clean.
- `pnpm test` (`vitest run`) green.
- All three services boot and answer their routes; the Monitor to Operator to Mitigator to
  Monitor dispatch loop round-trips unchanged.
- `CLAUDE.md` commands section reflects pnpm and the new stack.

## Consolidated risk register

- Fastify response-contract drift breaking the inter-agent loop. Severity: medium.
  Mitigation: preserve JSON shapes exactly; smoke tests per route.
- `noUncheckedIndexedAccess` fix churn. Severity: medium. Mitigation: do the fix pass;
  deferrable as a single flag if disproportionate.
- SSE `/watch` port and graceful-shutdown coupling to `http.Server`. Severity: medium.
  Mitigation: `reply.hijack()` + `reply.raw`; wire shutdown to `app.server` + `app.close()`.
- pnpm strict isolation surfacing an undeclared dependency. Severity: low. Mitigation:
  declare it.
- Vitest cross-package `.ts` resolution under Node 22. Severity: low. Mitigation:
  `vite-tsconfig-paths` or `--import tsx` fallback.
