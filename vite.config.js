import { defineConfig } from 'vite';

export default defineConfig({
  appType: 'spa',
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
