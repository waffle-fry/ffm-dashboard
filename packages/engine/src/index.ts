// Dashboard Engine entry point.
//
// Re-exports the server factory for programmatic use and starts the HTTP
// server when run directly (via `npm start` -> `node dist/index.js`).
//
// IMPORTANT: the `startServer` call is guarded so it only runs when this file
// is executed as the process entry point. Importing this module (e.g. from a
// test via the package's `main` entry) must NOT bind a port. An unguarded
// listen leaves an open handle that prevents Vitest workers from exiting,
// which is what produces orphaned, CPU-spinning Node processes.

import { pathToFileURL } from 'node:url';
import { startServer, DEFAULT_PORT } from './server.js';

export * from './server.js';

/** True when this module is the file node was invoked with (not an import). */
function isMainModule(): boolean {
    const entry = process.argv[1];
    return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (isMainModule()) {
    const port = Number(process.env.PORT) || DEFAULT_PORT;
    startServer(port);
}
