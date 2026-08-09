import react from '@vitejs/plugin-react';
import { createServer } from 'vite';

const server = await createServer({
  configFile: false,
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3333',
        changeOrigin: true
      },
      '/health': {
        target: 'http://127.0.0.1:3333',
        changeOrigin: true
      }
    }
  }
});

await server.listen();
server.printUrls();
