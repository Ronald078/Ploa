import { defineConfig } from 'vite';

export default defineConfig({
  base: '/app-next/',
  publicDir: false,
  build: {
    outDir: '../public/app-next',
    emptyOutDir: true,
    manifest: true,
    target: ['chrome111', 'edge111'],
  },
  server: {
    proxy: Object.fromEntries(['/api', '/assets', '/styles', '/ploa-theme.css', '/ploa-operations.css', '/ploa-page-details.css'].map(prefix => [prefix, { target: 'http://127.0.0.1:4310', changeOrigin: true }])),
  },
});
