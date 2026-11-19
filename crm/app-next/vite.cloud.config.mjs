import { defineConfig } from 'vite';

// Independent output: never empties or replaces the existing panel bundle.
export default defineConfig({
  base: '/', publicDir: false,
  build: {
    outDir: '../cloud/public', emptyOutDir: true, assetsDir: 'cloud-assets',
    rolldownOptions: { input: 'cloud.html' }, target: ['chrome111', 'edge111'],
  },
});
