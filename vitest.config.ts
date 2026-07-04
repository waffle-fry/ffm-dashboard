import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        include: ['packages/*/src/**/*.{test,spec}.{ts,tsx}'],
        // Run tests in worker threads rather than forked child processes.
        // Worker threads live inside the runner process and are torn down with
        // it, so the test pool itself cannot leak an OS process.
        //
        // NOTE: this alone does NOT prevent the terminal-wedge problem. Vite
        // spawns an esbuild "service" child process to transform TypeScript
        // regardless of the pool, and that child inherits the shell's stdio.
        // If it briefly outlives the runner it holds the terminal's stdout pipe
        // open and the parent shell hangs. That failure mode is handled
        // structurally by `scripts/run-tests.mjs` (the `npm test` entrypoint),
        // which runs Vitest in its own process group with piped stdio and hard-
        // kills the whole group on exit. Prefer `npm test` over a bare
        // `vitest run` so descendants can never wedge the terminal.
        pool: 'threads',
        // Fail fast instead of hanging if a test leaves work pending, and cap
        // teardown so a lingering handle can't stall the run indefinitely.
        testTimeout: 10_000,
        hookTimeout: 10_000,
        teardownTimeout: 5_000,
    },
});
