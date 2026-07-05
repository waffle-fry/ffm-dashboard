# UI public assets

Files in this directory are served at the site root by Vite (dev) and Nginx
(production). Anything here is copied verbatim into the build output.

## Brand logo

The header logo is loaded from `/ffm-logo.png` (see
`src/components/Logo.tsx`). Save the official FFM logo image here as:

    packages/ui/public/ffm-logo.png

Any web image format works if you also update `LOGO_SRC` in `Logo.tsx`
(e.g. `ffm-logo.svg`). Until the file is present, the header shows a plain
"FFM" text fallback instead of a broken image.
