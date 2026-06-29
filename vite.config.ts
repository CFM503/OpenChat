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
  // Check if default ports are occupied before starting
  const defaultPort = 3000;
  const backendPort = 3001;

  const port3000Occupied = await checkPortInUse(defaultPort);
  const port3001Occupied = await checkPortInUse(backendPort);

  if (port3000Occupied && port3001Occupied) {
    console.error('\n' + '='.repeat(60));
    console.error(`❌ Both ports 3000 (frontend) and 3001 (backend) are in use.`);
    console.error(`   Stop the conflicting processes before running dev:all.`);
    console.error('='.repeat(60) + '\n');
    process.exit(1);
  }
  if (port3000Occupied) {
    console.error('\n' + '='.repeat(60));
    console.error(`❌ Port 3000 (frontend) is in use. Cannot start Vite.`);
    console.error(`   Windows: netstat -ano | findstr :3000`);
    console.error(`            taskkill /F /PID <PID>`);
    console.error('='.repeat(60) + '\n');
    process.exit(1);
  }
  if (port3001Occupied) {
    console.warn(`⚠️  Backend port 3001 is in use. API/WebSocket calls may fail.`);
  }

  return {
    plugins: [react(), localConfigPlugin()],
    server: {
      port: defaultPort,
      strictPort: true,
      open: false,
      host: '0.0.0.0',  // Bind to all interfaces (IPv4 + IPv6)
      onListening(server) {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          console.log(`   ➜  Frontend: http://localhost:${addr.port}/`);
          console.log(`   ➜  Backend:  http://localhost:${backendPort}/`);
        }
      },
      proxy: {
        // Proxy /api and /ws to backend when it's running
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
        '/ws': {
          target: 'ws://localhost:3001',
          ws: true,
        },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
    },
  };
});
