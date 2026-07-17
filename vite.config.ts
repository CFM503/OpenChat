import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import net from 'net';
import fs from 'fs';
import path from 'path';

const FRONTEND_PORT = parseInt(process.env.OPENCHAT_FRONTEND_PORT || '3000', 10);
const BACKEND_PORT = parseInt(process.env.OPENCHAT_PORT || '3001', 10);

function checkPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (err: NodeJS.ErrnoException) => {
      resolve(err.code === 'EADDRINUSE');
    });
    server.once('listening', () => {
      server.close(() => resolve(false));
    });
    server.listen(port, '0.0.0.0');
  });
}

function killHints(port: number): string[] {
  if (process.platform === 'win32') {
    return [
      `   Windows: netstat -ano | findstr :${port}`,
      `            taskkill /F /PID <PID>`,
    ];
  }
  return [
    `   Unix:    lsof -i :${port}`,
    `            kill -9 <PID>`,
  ];
}

function printPortError(title: string, ports: number[]) {
  console.error('\n' + '='.repeat(62));
  console.error(title);
  console.error('');
  for (const p of ports) {
    console.error(`   Port ${p} is busy.`);
    for (const line of killHints(p)) console.error(line);
    console.error('');
  }
  console.error('   Or override ports:');
  console.error('     set OPENCHAT_FRONTEND_PORT=3100');
  console.error('     set OPENCHAT_PORT=3101');
  console.error('     npm run dev:all');
  console.error('='.repeat(62) + '\n');
}

// Local .openchat fallback when backend is not running
function localConfigPlugin() {
  const configPath = path.resolve(__dirname, '.openchat');

  const handler = (req: any, res: any, next: any) => {
    if (req.url === '/api/config') {
      if (req.method === 'GET') {
        res.setHeader('Content-Type', 'application/json');
        if (fs.existsSync(configPath)) {
          res.end(fs.readFileSync(configPath, 'utf-8'));
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
    },
  };
}

export default defineConfig(async () => {
  // Skip port checks during vitest (OPENCHAT_SKIP_PORT_CHECK or VITEST)
  const skipCheck =
    process.env.OPENCHAT_SKIP_PORT_CHECK === '1' ||
    process.env.VITEST === 'true' ||
    process.argv.some(a => a.includes('vitest'));

  if (!skipCheck) {
    const frontendBusy = await checkPortInUse(FRONTEND_PORT);
    const backendBusy = await checkPortInUse(BACKEND_PORT);

    if (frontendBusy) {
      printPortError(
        `❌ Frontend port ${FRONTEND_PORT} is in use. Cannot start Vite.`,
        [FRONTEND_PORT],
      );
      process.exit(1);
    }

    if (backendBusy) {
      // Soft warning: vite alone is ok, but proxy/API will fail until backend frees the port
      console.warn('\n' + '-'.repeat(62));
      console.warn(`⚠️  Backend port ${BACKEND_PORT} is in use.`);
      console.warn(`   Frontend will start, but /api and /ws may fail until backend is free.`);
      for (const line of killHints(BACKEND_PORT)) console.warn(line);
      console.warn('-'.repeat(62) + '\n');
    } else {
      console.log(`✓ Frontend port ${FRONTEND_PORT} free · backend expected on ${BACKEND_PORT}`);
    }
  }

  return {
    plugins: [react(), localConfigPlugin()],
    server: {
      port: FRONTEND_PORT,
      strictPort: true,
      open: false,
      host: '0.0.0.0',
      onListening(server) {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          console.log(`   ➜  Frontend: http://localhost:${addr.port}/`);
          console.log(`   ➜  Backend:  http://localhost:${BACKEND_PORT}/`);
        }
      },
      proxy: {
        '/api': {
          target: `http://localhost:${BACKEND_PORT}`,
          changeOrigin: true,
        },
        '/ws': {
          target: `ws://localhost:${BACKEND_PORT}`,
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
