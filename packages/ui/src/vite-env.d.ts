/// <reference types="vite/client" />

// Ambient module declarations for asset imports handled by Vite so that
// `tsc --build` (the workspace type-check) does not error on non-TS imports.
declare module '*.woff2' {
    const src: string;
    export default src;
}
