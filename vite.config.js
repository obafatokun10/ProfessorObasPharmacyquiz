import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves at https://<username>.github.io/<repo>/
// The workflow sets VITE_BASE_PATH at build time.
// For local dev, base falls back to "/".
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || '/',
  build: {
    outDir: 'dist',
    sourcemap: false
  }
});
