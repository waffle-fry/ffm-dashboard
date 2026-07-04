import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite is the build/dev tool for the Dashboard UI. The workspace `build`
// script (`tsc --build`) type-checks the project; `vite build` produces the
// deployable static bundle that Nginx serves in the UI pod.
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        // In development, proxy API calls to the Dashboard Engine so the UI can
        // talk to the backend without CORS juggling. In production Nginx does
        // the equivalent `/api` proxy pass.
        proxy: {
            '/api': {
                target: 'http://localhost:8080',
                changeOrigin: true,
            },
        },
    },
    build: {
        outDir: 'dist',
        sourcemap: true,
    },
});
