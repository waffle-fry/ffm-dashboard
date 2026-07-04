// Font-loading timeout (Requirement 1.4).
//
// `font-display: swap` already guarantees text is never blocked on the web
// fonts. This helper adds an explicit 3-second ceiling: if the brand fonts have
// not finished loading within 3s, we add the `.fonts-timeout` class to <html>,
// which switches the font CSS custom properties to the system sans-serif stack
// so we stop waiting on the (possibly failing) web fonts.

const FONT_TIMEOUT_MS = 3000;

/**
 * Race font loading against a 3s timeout. Resolves to `true` if the brand
 * fonts loaded in time, or `false` if the timeout won (in which case the
 * `.fonts-timeout` class is applied to fall back to the system font).
 *
 * Safe to call in non-browser environments (returns `false` immediately).
 */
export function installFontLoadingTimeout(
    timeoutMs: number = FONT_TIMEOUT_MS,
): Promise<boolean> {
    if (
        typeof document === 'undefined' ||
        // The CSS Font Loading API may be unavailable in older/test envs.
        !('fonts' in document)
    ) {
        return Promise.resolve(false);
    }

    const applyFallback = () => {
        document.documentElement.classList.add('fonts-timeout');
    };

    const timeout = new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), timeoutMs);
    });

    const ready = document.fonts.ready.then(() => true);

    return Promise.race([ready, timeout]).then((loadedInTime) => {
        if (!loadedInTime) {
            applyFallback();
        }
        return loadedInTime;
    });
}
