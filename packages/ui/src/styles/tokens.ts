// Brand design tokens for the FansFund ops dashboard.
//
// This module is the single source of truth for the brand palette and font
// stacks. The values here MUST stay in sync with the CSS custom properties
// declared in `index.css` (the CSS drives the actual rendering; this module
// mirrors the values so they can be unit-tested — e.g. contrast ratios — and
// referenced from TypeScript where needed).
//
// Requirement 1.1: dark background, light text, Work Sans body (>= 14px),
// Outfit headings (>= 18px), yellow/gold accent for highlights/alerts only,
// and a background-to-body-text contrast ratio of at least 4.5:1.

export const brandColors = {
    /** Dark app background. */
    background: '#0F1115',
    /** Slightly raised panel background (widgets). */
    surface: '#181B22',
    /** Further raised surface (hover / nested panels). */
    surfaceRaised: '#20242E',
    /** Subtle borders and dividers. */
    border: '#2A2F3A',
    /** Primary body/light text — high contrast against the background. */
    textPrimary: '#F5F5F7',
    /** Secondary/muted text — still meets 4.5:1 against the background. */
    textSecondary: '#C7CAD1',
    /** Yellow/gold accent — highlights, emphasis, and alert indicators only. */
    accent: '#FFC93C',
    /** Stronger gold for solid accent fills. */
    accentStrong: '#F5B301',
    /** Red for critical/overdue states. */
    danger: '#FF5A5F',
    /** Green for healthy states. */
    success: '#3FCF8E',
} as const;

export type BrandColorToken = keyof typeof brandColors;

/** Minimum body font size in pixels (Requirement 1.1). */
export const MIN_BODY_FONT_PX = 14;
/** Minimum heading font size in pixels (Requirement 1.1). */
export const MIN_HEADING_FONT_PX = 18;

/**
 * WCAG minimum contrast ratio for normal-size body text against its
 * background (Requirement 1.1).
 */
export const MIN_CONTRAST_RATIO = 4.5;

/** Font stacks. Custom families first, system sans-serif as the fallback so
 * text renders immediately if the web fonts are slow or fail to load
 * (Requirement 1.4). */
export const fontStacks = {
    body: "'Work Sans', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    heading: "'Outfit', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
} as const;

/**
 * Convert a `#rrggbb` hex color to its linearized sRGB relative luminance,
 * per the WCAG 2.x definition.
 */
export function relativeLuminance(hex: string): number {
    const normalized = hex.replace(/^#/, '');
    if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
        throw new Error(`Invalid hex color: ${hex}`);
    }
    const channels = [0, 2, 4].map((offset) => {
        const value = parseInt(normalized.slice(offset, offset + 2), 16) / 255;
        return value <= 0.03928
            ? value / 12.92
            : Math.pow((value + 0.055) / 1.055, 2.4);
    });
    const [r, g, b] = channels;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Compute the WCAG contrast ratio between two `#rrggbb` colors.
 * Returns a value in the range [1, 21].
 */
export function contrastRatio(foreground: string, background: string): number {
    const l1 = relativeLuminance(foreground);
    const l2 = relativeLuminance(background);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
}
