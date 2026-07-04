# Self-hosted brand fonts

These `.woff2` files are the self-hosted brand fonts referenced by
`src/styles/index.css`. They are committed here as **empty placeholders** so the
build works in environments without network access to a font CDN.

> ⚠️ The placeholder files are 0 bytes and are NOT valid font binaries. Until
> the real binaries are dropped in, the browser's font loader will fail to load
> them and text renders with the system sans-serif fallback (this is the
> intended, non-blocking behavior — see Requirement 1.4).

## Dropping in the real fonts

Download the official `woff2` files and replace the placeholders with the same
file names (keep the names — they are referenced by `@font-face` in
`index.css`):

| File                   | Family    | Weight |
| ---------------------- | --------- | ------ |
| `work-sans-400.woff2`  | Work Sans | 400    |
| `work-sans-600.woff2`  | Work Sans | 600    |
| `outfit-500.woff2`     | Outfit    | 500    |
| `outfit-600.woff2`     | Outfit    | 600    |
| `outfit-700.woff2`     | Outfit    | 700    |

Both families are open source (SIL Open Font License) and available from Google
Fonts. Generate `woff2` subsets (e.g. Latin) with `fonttools`/`woff2` or download
pre-built `woff2` files, then place them here.

No code changes are required after replacing the files — `@font-face` uses
`font-display: swap`, so once valid fonts are present they swap in
automatically without blocking page display.
