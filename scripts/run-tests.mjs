#!/usr/bin/env node
// Hardened test runner.
//
// Why this wrapper exists
// -----------------------
// Running `vitest run` directly can wedge the invoking terminal even though the
// test run itself completes successfully with exit code 0. Two independent
// failure modes combine to cause this:
//
//   1. Vite spawns an esbuild "service" child process to transform TypeScript.
//      If that child outlives Vitest while holding a stdio pipe, a non-TTY
//      parent (an agent shell or CI runner that waits for the whole process
//      tree's file descriptors to close) never receives EOF and hangs forever.
//
//   2. When Vitest believes stdout is a TTY it renders an ANIMATED spinner.
//      Those spinner frames are emitted continuously with no newline. Any
//      "wait until output goes quiet" watchdog is therefore reset forever and
//      can never fire, so a run that has actually finished still never exits.
//
// This wrapper removes both failure modes structurally:
//   * Vitest runs in its OWN process group (`detached: true`) with PIPED stdio,
//     so we can SIGKILL the entire tree (Vitest + esbuild + workers) as a unit
//     and no descendant ever holds the real terminal's fds.
//   * The child is forced into non-interactive mode (`CI=true`, colour off) so
//     it emits deterministic, newline-terminated, finite output and NEVER an
//     animated spinner. Once the run is done, output truly stops.
//
// Termination is then guaranteed by three independent mechanisms (strongest to
// weakest); whichever fires first wins:
//   (1) Idle watchdog  — force-kill once output has been quiet for IDLE_MS.
//                        Spinner-proof: only newline-bearing output counts as
//                        activity, so a stray carriage-return frame can never
//                        keep it alive.
//   (2) Fast path      — as soon as the end-of-run summary is seen, shut down
//                        after a short flush grace. ANSI is stripped first so a
//                        colourised summary still matches. Optimisation only.
//   (3) Child 'exit'   — if Vitest exits on its own, propagate its real code.
//
// The result: `npm test` streams normal output, exits with the real pass/fail
// code, and can never leave a background process attached to the terminal.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const vitestBin = path.resolve(
    process.cwd(),
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'vitest.cmd' : 'vitest',
);

if (!existsSync(vitestBin)) {
    console.error(`[run-tests] Could not find vitest binary at ${vitestBin}`);
    process.exit(1);
}

// Forward any extra CLI args (e.g. a file path or --reporter) after "run".
const forwardedArgs = process.argv.slice(2);

const child = spawn(vitestBin, ['run', ...forwardedArgs], {
    // New process group: lets us kill Vitest AND its esbuild service together.
    detached: true,
    // Pipe (don't inherit) so descendants never hold the shell's terminal fds.
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
        ...process.env,
        // Force non-interactive mode: no animated spinner, deterministic
        // newline-terminated output, and a cleaner shutdown. This is the single
        // most important line — an animated spinner is what defeats any
        // "output went quiet" watchdog and keeps a finished run alive forever.
        CI: 'true',
        // Belt-and-suspenders: strip colour so summary parsing is trivial and
        // no escape sequences can interleave with the tokens we match on.
        NO_COLOR: '1',
        FORCE_COLOR: '0',
    },
});

child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);

let settled = false;

// Retain a rolling tail of combined output so we can derive the real pass/fail
// exit code from Vitest's summary. A small cap keeps memory bounded.
let tail = '';
const TAIL_LIMIT = 16_384;

// Strip ANSI escape sequences so summary/exit-code detection is robust even if
// colour ever leaks through despite NO_COLOR.
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
function clean(s) {
    return s.replace(ANSI, '');
}

/**
 * Derive the process exit code from Vitest's summary text.
 * Vitest only prints " failed" in its summary when something actually failed,
 * so its absence after a completed run means success.
 */
function exitCodeFromSummary() {
    return /\bfailed\b/i.test(clean(tail)) ? 1 : 0;
}

/** Kill the whole child process group, then exit with the given code. */
function shutdown(code) {
    if (settled) {
        return;
    }
    settled = true;
    clearTimeout(fastPathTimer);
    clearTimeout(watchdog);
    clearTimeout(backstop);
    if (child.pid !== undefined) {
        try {
            // Negative PID targets the entire process group (esbuild included).
            process.kill(-child.pid, 'SIGKILL');
        } catch {
            // Group already gone — nothing to clean up.
        }
    }
    process.exit(code);
}

// --- Termination guarantees, strongest to weakest ---------------------------

// (1) Idle watchdog — the guaranteed backstop. Armed from process start and
//     reset only on MEANINGFUL output (a chunk containing a newline). Because
//     CI mode disables the animated spinner there is no continuous output, so
//     once the run ends the stream goes quiet and this fires. Making it immune
//     to non-newline "frames" means even an unexpected spinner cannot keep the
//     wrapper alive.
const IDLE_MS = 8_000;
let watchdog;
function armWatchdog() {
    if (settled) {
        return;
    }
    clearTimeout(watchdog);
    watchdog = setTimeout(() => shutdown(exitCodeFromSummary()), IDLE_MS);
}

// (2) Fast path — as soon as we see the end-of-run "Duration" summary, results
//     are final; grant a short grace for the last bytes to flush, then shut
//     down. Optimisation only: if it never matches, the idle watchdog fires.
let fastPathTimer;
function onData(chunk) {
    const text = chunk.toString();
    tail = (tail + text).slice(-TAIL_LIMIT);
    // Only reset the idle timer on newline-bearing output so a bare spinner
    // frame (carriage-return, no newline) can never hold the wrapper open.
    if (text.includes('\n')) {
        armWatchdog();
    }
    if (!fastPathTimer && /Duration\s+[\d.]+\s*m?s/i.test(clean(tail))) {
        fastPathTimer = setTimeout(() => shutdown(exitCodeFromSummary()), 500);
    }
}
child.stdout.on('data', onData);
child.stderr.on('data', onData);
armWatchdog(); // arm immediately, before any output arrives

// (3) Hard backstop — absolute upper bound on total runtime.
const backstop = setTimeout(() => shutdown(exitCodeFromSummary() || 1), 600_000);

child.on('exit', (code, signal) => {
    // Fast path: Vitest actually exited on its own. A signalled exit (or null
    // code) is treated as failure.
    shutdown(signal !== null ? 1 : code ?? 0);
});

child.on('error', (err) => {
    console.error(`[run-tests] Failed to launch vitest: ${err.message}`);
    shutdown(1);
});

// Propagate interactive interrupts to the whole group so Ctrl-C is clean too.
for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => shutdown(1));
}
