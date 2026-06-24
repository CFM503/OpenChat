import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import net from 'net';

function checkPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err: any) => {
      resolve(err.code === 'EADDRINUSE');
    });
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port);
  });
}

export default defineConfig(async () => {
  const defaultPort = 3000;
  const isOccupied = await checkPortInUse(defaultPort);

  if (isOccupied) {
    console.warn('\n' + '='.repeat(60));
    console.warn(`⚠️  [Warning] Port ${defaultPort} is already in use by another process.`);
    console.warn(`   Vite will automatically allocate a new port (e.g., ${defaultPort + 1}).`);
    console.warn('='.repeat(60) + '\n');
  }

  return {
    plugins: [react()],
    server: {
      port: defaultPort,
      open: true,
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
    },
  };
});
