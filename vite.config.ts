import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import net from 'net';
import fs from 'fs';
import path from 'path';

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

// A simple plugin to read/write local configuration file (.openchat) Client-side
function localConfigPlugin() {
  const configPath = path.resolve(__dirname, '.openchat');

  const handler = (req: any, res: any, next: any) => {
    if (req.url === '/api/config') {
      if (req.method === 'GET') {
        res.setHeader('Content-Type', 'application/json');
        if (fs.existsSync(configPath)) {
          const data = fs.readFileSync(configPath, 'utf-8');
          res.end(data);
        } else {
          res.end(JSON.stringify({}));
        }
        return;
      }

      if (req.method === 'POST') {
        let body = '';
        req.on('data', (chunk: any) => {
          body += chunk;
        });
        req.on('end', () => {
          try {
            // Verify it is valid JSON
            JSON.parse(body);
            fs.writeFileSync(configPath, body, 'utf-8');
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true }));
          } catch (err: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
          }
        });
        return;
      }
    }
    next();
  };

  return {
    name: 'local-config-plugin',
    configureServer(server: any) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server: any) {
      server.middlewares.use(handler);
    }
  };
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
    plugins: [react(), localConfigPlugin()],
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
