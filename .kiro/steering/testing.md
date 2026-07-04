---
inclusion: always
---

# Test Invocation Rules (MANDATORY for all agents and subagents)

These rules apply to EVERY agent and subagent operating in this workspace —
including spec task-execution subagents, verification steps, and ad-hoc test
runs. There are no exceptions. Tests MUST be invoked through the hardened
wrapper. Do not run the Vitest binary directly under any circumstances.

## The only allowed way to run tests

- Full suite: `npm test`
  (this runs `node scripts/run-tests.mjs`, the hardened wrapper).
- A single file or subset: forward args through the same wrapper, e.g.
  `npm test -- packages/engine/src/utils/formatting.test.ts`
- A name/pattern filter: `npm test -- -t "formats money"`

Any command you use to execute tests MUST start with `npm test`.

## Forbidden — never run these

- `vitest ...`, `npx vitest ...`, `./node_modules/.bin/vitest ...`
  (a bare Vitest run leaks the esbuild "service" child process; it inherits the
  shell's stdio and wedges the terminal even after a green run, and it can hang
  forever because Vitest v2 finishes the run but does not always exit).
- `npm run test:watch` (bare `vitest`, watch mode). Watch mode never terminates
  and will hang an automated session. It is for interactive human use only.
- Any wrapper/script that shells out to `vitest run` on its own.

## Why the wrapper is required

`scripts/run-tests.mjs` is the ONLY invocation path that guarantees a clean run:

- It runs Vitest in its own process group with piped stdio and force-kills the
  whole group (Vitest + esbuild + workers) when the run is done, so no orphan
  can hold the terminal's file descriptors open.
- It forces non-interactive mode (`CI=true`, colour off) so Vitest never emits
  an animated spinner — the thing that otherwise keeps a "finished" run alive.
- It returns the real pass/fail exit code.

Any other path risks a hung terminal and stale output for every subsequent
command, which has already broken task execution in this repo.

## Self-check before running tests

Before issuing a test command, confirm it begins with `npm test`. If it does
not, rewrite it so it does.
