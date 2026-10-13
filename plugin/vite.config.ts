import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Figma loads the plugin UI as ONE html file, so everything (js, css, fonts) is inlined.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 4000,
    target: 'es2020',
  },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
} as never);
