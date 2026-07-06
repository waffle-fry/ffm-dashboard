import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    installIdleCursor,
    CURSOR_HIDDEN_CLASS,
    DEFAULT_IDLE_MS,
    ACTIVITY_EVENTS,
    type CursorTarget,
} from './cursor';

/** In-memory CursorTarget fake: tracks classes and lets tests fire events. */
function makeFakeTarget() {
    const classes = new Set<string>();
    const handlers = new Map<string, Set<() => void>>();
    const target: CursorTarget = {
        addClass: (cls) => classes.add(cls),
        removeClass: (cls) => classes.delete(cls),
        on: (type, handler) => {
            const set = handlers.get(type) ?? new Set();
            set.add(handler);
            handlers.set(type, set);
        },
        off: (type, handler) => handlers.get(type)?.delete(handler),
    };
    return {
        target,
        hidden: () => classes.has(CURSOR_HIDDEN_CLASS),
        fire: (type: string) => {
            for (const h of handlers.get(type) ?? []) h();
        },
        listenerCount: () =>
            [...handlers.values()].reduce((n, set) => n + set.size, 0),
    };
}

describe('installIdleCursor', () => {
    let teardown: () => void = () => { };

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        teardown();
        vi.useRealTimers();
    });

    it('hides the cursor only after the idle period elapses', () => {
        const fake = makeFakeTarget();
        teardown = installIdleCursor(1000, fake.target);

        expect(fake.hidden()).toBe(false);
        vi.advanceTimersByTime(999);
        expect(fake.hidden()).toBe(false);
        vi.advanceTimersByTime(1);
        expect(fake.hidden()).toBe(true);
    });

    it('reveals the cursor on activity and restarts the idle timer', () => {
        const fake = makeFakeTarget();
        teardown = installIdleCursor(1000, fake.target);
        vi.advanceTimersByTime(1000);
        expect(fake.hidden()).toBe(true);

        fake.fire('mousemove');
        expect(fake.hidden()).toBe(false);

        vi.advanceTimersByTime(999);
        expect(fake.hidden()).toBe(false);
        vi.advanceTimersByTime(1);
        expect(fake.hidden()).toBe(true);
    });

    it('registers a listener for every activity event and removes them on teardown', () => {
        const fake = makeFakeTarget();
        teardown = installIdleCursor(1000, fake.target);
        expect(fake.listenerCount()).toBe(ACTIVITY_EVENTS.length);

        teardown();
        expect(fake.listenerCount()).toBe(0);
        // Re-shown on teardown, and no further hiding occurs.
        expect(fake.hidden()).toBe(false);
        vi.advanceTimersByTime(5000);
        expect(fake.hidden()).toBe(false);
    });

    it('is a safe no-op when no target is available', () => {
        expect(() => installIdleCursor(1000, null)()).not.toThrow();
    });

    it('exposes a sensible default idle period', () => {
        expect(DEFAULT_IDLE_MS).toBe(5000);
    });
});
