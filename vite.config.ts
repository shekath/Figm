import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the build works both on a web host sub-path and inside Electron (file://)
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', sourcemap: false },
});
