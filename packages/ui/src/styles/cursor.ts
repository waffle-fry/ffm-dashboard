// Idle mouse-cursor hiding for kiosk display.
//
// On the dedicated Mac Mini the dashboard is a display-only view, so a parked
// mouse pointer is a distraction. `installIdleCursor` hides the cursor after a
// short period of no input and reveals it again the moment the mouse moves (or
// a key/click/scroll occurs), so the board still stays fully interactive for
// rearranging cards.
//
// It toggles the `cursor-hidden` class on <body>; the actual `cursor: none`
// rule lives in styles/index.css. Called once at startup from main.tsx
// (mirroring installFontLoadingTimeout).
//
// The DOM/window access is isolated behind the injectable {@link CursorTarget}
// so the idle logic is unit-testable in a plain Node environment (matching the
// rest of the suite, which runs DOM-free).

/** Body class that applies `cursor: none` (see styles/index.css). */
export const CURSOR_HIDDEN_CLASS = 'cursor-hidden';

/** Default idle period before the cursor is hidden (ms). */
export const DEFAULT_IDLE_MS = 5000;

/** Input events that count as activity and reveal the cursor. */
export const ACTIVITY_EVENTS = [
    'mousemove',
    'mousedown',
    'wheel',
    'keydown',
    'touchstart',
] as const;

/**
 * The small surface `installIdleCursor` needs: toggle a body class and
 * (de)register activity listeners. Backed by the real DOM in the browser and by
 * a fake in tests.
 */
export interface CursorTarget {
    addClass(cls: string): void;
    removeClass(cls: string): void;
    on(type: string, handler: () => void): void;
    off(type: string, handler: () => void): void;
}

/** Builds a {@link CursorTarget} over the real DOM, or null when unavailable. */
function domCursorTarget(): CursorTarget | null {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
        return null;
    }
    const { body } = document;
    return {
        addClass: (cls) => body.classList.add(cls),
        removeClass: (cls) => body.classList.remove(cls),
        on: (type, handler) =>
            window.addEventListener(type, handler, { passive: true }),
        off: (type, handler) => window.removeEventListener(type, handler),
    };
}

/**
 * Hide the mouse cursor after `idleMs` of inactivity; reveal it on any pointer
 * or keyboard activity and restart the timer. Returns a teardown function that
 * removes the listeners, clears the timer, and re-shows the cursor.
 *
 * A no-op (returns an empty teardown) when no target is available (e.g. a
 * non-DOM environment), so it is safe to import/call anywhere.
 *
 * @param idleMs Idle period before hiding.
 * @param target Injectable surface; defaults to the real DOM.
 */
export function installIdleCursor(
    idleMs: number = DEFAULT_IDLE_MS,
    target: CursorTarget | null = domCursorTarget(),
): () => void {
    if (target === null) {
        return () => { };
    }

    let timer: ReturnType<typeof setTimeout> | undefined;

    const hide = (): void => target.addClass(CURSOR_HIDDEN_CLASS);
    const show = (): void => target.removeClass(CURSOR_HIDDEN_CLASS);

    const schedule = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(hide, idleMs);
    };

    const onActivity = (): void => {
        show();
        schedule();
    };

    for (const event of ACTIVITY_EVENTS) {
        target.on(event, onActivity);
    }

    // Start the idle countdown so the cursor hides even if the mouse never moves.
    schedule();

    return () => {
        if (timer !== undefined) clearTimeout(timer);
        for (const event of ACTIVITY_EVENTS) {
            target.off(event, onActivity);
        }
        show();
    };
}
