import { describe, it, expect } from 'vitest';
import {
    brandColors,
    contrastRatio,
    relativeLuminance,
    fontStacks,
    MIN_BODY_FONT_PX,
    MIN_HEADING_FONT_PX,
    MIN_CONTRAST_RATIO,
} from './tokens';

describe('brand tokens (Requirement 1.1)', () => {
    it('uses a dark background with light primary text', () => {
        // Background should be darker (lower luminance) than the primary text.
        expect(relativeLuminance(brandColors.background)).toBeLessThan(
            relativeLuminance(brandColors.textPrimary),
        );
    });

    it('meets >= 4.5:1 contrast between background and primary body text', () => {
        const ratio = contrastRatio(
            brandColors.textPrimary,
            brandColors.background,
        );
        expect(ratio).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO);
    });

    it('meets >= 4.5:1 contrast between background and secondary text', () => {
        const ratio = contrastRatio(
            brandColors.textSecondary,
            brandColors.background,
        );
        expect(ratio).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO);
    });

    it('defines a yellow/gold accent color', () => {
        // Gold: red and green channels high, blue channel low.
        const hex = brandColors.accent.replace('#', '');
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        expect(r).toBeGreaterThan(b);
        expect(g).toBeGreaterThan(b);
    });

    it('lists Work Sans as the body font with a system sans-serif fallback', () => {
        expect(fontStacks.body).toContain('Work Sans');
        expect(fontStacks.body).toContain('sans-serif');
    });

    it('lists Outfit as the heading font with a system sans-serif fallback', () => {
        expect(fontStacks.heading).toContain('Outfit');
        expect(fontStacks.heading).toContain('sans-serif');
    });

    it('enforces the brand minimum font sizes', () => {
        expect(MIN_BODY_FONT_PX).toBeGreaterThanOrEqual(14);
        expect(MIN_HEADING_FONT_PX).toBeGreaterThanOrEqual(18);
    });
});

describe('contrastRatio / relativeLuminance', () => {
    it('computes the canonical 21:1 ratio for black on white', () => {
        expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    });

    it('computes a ratio of 1 for identical colors', () => {
        expect(contrastRatio('#123456', '#123456')).toBeCloseTo(1, 5);
    });

    it('is symmetric in its arguments', () => {
        expect(contrastRatio('#0f1115', '#f5f5f7')).toBeCloseTo(
            contrastRatio('#f5f5f7', '#0f1115'),
            10,
        );
    });

    it('rejects malformed hex colors', () => {
        expect(() => relativeLuminance('#xyz')).toThrow();
        expect(() => relativeLuminance('12345')).toThrow();
    });
});
