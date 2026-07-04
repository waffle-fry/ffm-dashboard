// Minimal structured logger for the Dashboard Engine.
//
// Emits one JSON object per line to stdout (info/debug) or stderr (warn/error),
// which is what the K8s logging stack collects. Kept dependency-free and tiny.
//
// Two implementations are provided:
//   - `consoleLogger`  — writes JSON lines; used by the running server.
//   - `silentLogger`   — a no-op; the DataAggregator's default so unit/property
//                        tests don't spew refresh output.
//
// Logging convention: every entry has a stable `event` string plus arbitrary
// structured `fields`. Do NOT log secrets or PII — pass only safe values
// (source names, metric keys, durations, error messages). Error messages from
// upstream SDKs may contain a masked key fragment (e.g. Stripe's "sk_..*ummy")
// but never full credentials.

/** Structured fields attached to a log entry. */
export type LogFields = Record<string, unknown>;

/** The logging surface the engine depends on. */
export interface Logger {
    info(event: string, fields?: LogFields): void;
    warn(event: string, fields?: LogFields): void;
    error(event: string, fields?: LogFields): void;
}

/** Builds a single JSON log line. */
function line(level: string, event: string, fields: LogFields): string {
    return JSON.stringify({
        level,
        time: new Date().toISOString(),
        event,
        ...fields,
    });
}

/** JSON-line logger used by the running server. */
export const consoleLogger: Logger = {
    info(event, fields = {}) {
        // eslint-disable-next-line no-console
        console.log(line('info', event, fields));
    },
    warn(event, fields = {}) {
        // eslint-disable-next-line no-console
        console.warn(line('warn', event, fields));
    },
    error(event, fields = {}) {
        // eslint-disable-next-line no-console
        console.error(line('error', event, fields));
    },
};

/** No-op logger (default in tests / when logging is not desired). */
export const silentLogger: Logger = {
    info() { },
    warn() { },
    error() { },
};
