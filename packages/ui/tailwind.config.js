/** @type {import('tailwindcss').Config} */
export default {
    // Dark-mode-first: the dashboard runs on a kiosk display and is dark by
    // default. We opt into the `class` strategy and put the `dark` class on
    // <html> so any future light variant is additive rather than a rewrite.
    darkMode: 'class',
    content: ['./index.html', './src/**/*.{ts,tsx}'],
    theme: {
        extend: {
            // Brand colors are wired to CSS custom properties (see index.css)
            // so the tokens have a single source of truth and can be tuned
            // without touching component code.
            colors: {
                background: 'var(--color-background)',
                surface: 'var(--color-surface)',
                'surface-raised': 'var(--color-surface-raised)',
                border: 'var(--color-border)',
                'text-primary': 'var(--color-text-primary)',
                'text-secondary': 'var(--color-text-secondary)',
                // Yellow/gold accent — highlights, emphasis, and alerts only.
                accent: 'var(--color-accent)',
                'accent-strong': 'var(--color-accent-strong)',
                danger: 'var(--color-danger)',
                success: 'var(--color-success)',
            },
            fontFamily: {
                // Body = Work Sans, headings = Outfit. Both fall back to the
                // system sans-serif stack so text renders immediately.
                body: 'var(--font-body)',
                heading: 'var(--font-heading)',
            },
            fontSize: {
                // Enforce the brand minimums from Requirement 1.1:
                // body >= 14px, headings >= 18px.
                body: ['0.875rem', { lineHeight: '1.5' }], // 14px
                heading: ['1.125rem', { lineHeight: '1.3' }], // 18px
            },
        },
    },
    plugins: [],
};
