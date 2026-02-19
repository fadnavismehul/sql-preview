import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'path';

export default defineConfig({
    plugins: [react(), viteSingleFile()],
    root: 'src/mcp-app',
    build: {
        outDir: '../../out/webviews/daemon',
        emptyOutDir: false, // Don't wipe existing dist files from other builds if any
        rollupOptions: {
            input: 'src/mcp-app/index.html',
            output: {
                entryFileNames: 'mcp-app.js',
            },
        },
    },
    server: {
        port: 3000,
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src/mcp-app'),
        },
    },
});
