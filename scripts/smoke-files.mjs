/**
 * Smoke: can tools + agent operate files?
 * 1) Direct tool registry execute (ground truth)
 * 2) Agent WS chat: create Desktop folder + write/read
 *
 * Usage: node scripts/smoke-files.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const PORT = parseInt(process.env.OPENCHAT_PORT || '3001', 10);
const API = `http://localhost:${PORT}`;
const WS = `ws://localhost:${PORT}/ws`;
const DESKTOP = path.join(os.homedir(), 'Desktop');
const TEST_DIR = path.join(DESKTOP, `openchat-smoke-${Date.now()}`);
const TEST_FILE = path.join(TEST_DIR, 'hello.txt');
const PROJECT_FILE = path.join(process.cwd(), '.openchat-smoke-tmp.txt');

function log(title, obj) {
  console.log(`\n=== ${title} ===`);
  console.log(typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
}

async function health() {
  const r = await fetch(`${API}/api/health`);
  if (!r.ok) throw new Error(`health ${r.status}`);
  return r.json();
}

function chat(prompt, { modelId, timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS);
    let content = '';
    const tools = [];
    let error = null;
    let done = false;
    const t = setTimeout(() => {
      if (done) return;
      done = true;
      try {
        ws.close();
      } catch {
        /* */
      }
      resolve({ timeout: true, content, tools, error });
    }, timeoutMs);

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          type: 'chat',
          modelId,
          enableThinking: false,
          messages: [
            {
              id: `u_${Date.now()}`,
              role: 'user',
              content: prompt,
              timestamp: Date.now(),
            },
          ],
        }),
      );
    });

    ws.on('message', (buf) => {
      let m;
      try {
        m = JSON.parse(buf.toString());
      } catch {
        return;
      }
      if (m.type === 'content') content += m.text || '';
      if (m.type === 'tool_start') tools.push({ name: m.name, phase: 'start', input: (m.input || '').slice(0, 200) });
      if (m.type === 'tool_result')
        tools.push({
          name: m.name,
          phase: 'result',
          ok: !!m.result?.success,
          error: m.result?.error,
          output: (m.result?.output || '').slice(0, 120),
        });
      if (m.type === 'error') error = m.message;
      if (m.type === 'done') {
        if (done) return;
        done = true;
        clearTimeout(t);
        try {
          ws.close();
        } catch {
          /* */
        }
        resolve({ content, tools, error, timeout: false });
      }
    });

    ws.on('error', (e) => {
      error = e.message;
      if (!done) {
        done = true;
        clearTimeout(t);
        resolve({ content, tools, error, timeout: false });
      }
    });
  });
}

async function directToolSmoke() {
  // Spin a one-shot node process that imports tools via tsx is heavy;
  // instead hit tools by agent with very constrained prompt after FS prep.
  // Ground truth: Node itself can write to Desktop (permission check).
  fs.mkdirSync(TEST_DIR, { recursive: true });
  fs.writeFileSync(path.join(TEST_DIR, 'seed.txt'), 'seed-ok', 'utf8');
  const ok = fs.existsSync(path.join(TEST_DIR, 'seed.txt'));
  return { desktopWritable: ok, testDir: TEST_DIR };
}

async function main() {
  console.log('OpenChat file-ops smoke');
  const h = await health();
  log('health', {
    status: h.status,
    cwd: h.workingDirectory,
    env: h.environment,
    tools: h.tools,
  });

  const ground = await directToolSmoke();
  log('desktop permission (node fs)', ground);

  // 1) Read project package.json via agent
  const r1 = await chat(
    'Use the file_read tool only. Read package.json and reply with exactly two lines: name=... and version=... Do not invent.',
  );
  log('agent file_read package.json', {
    content: r1.content?.slice(0, 300),
    tools: r1.tools,
    error: r1.error,
    timeout: r1.timeout,
    diskName: JSON.parse(fs.readFileSync('package.json', 'utf8')).name,
    diskVersion: JSON.parse(fs.readFileSync('package.json', 'utf8')).version,
  });

  // 2) Create folder + file on Desktop via agent
  const folderName = path.basename(TEST_DIR) + '-agent';
  const desktopAgentDir = path.join(DESKTOP, folderName);
  const r2 = await chat(
    `You are on Windows. Create a folder on the Desktop named "${folderName}" and write a file hello.txt inside it with content exactly: openchat-file-ops-ok\n` +
      `Use bash or file_write with ABSOLUTE paths. Desktop is: ${DESKTOP}\n` +
      `After success, confirm the full path.`,
  );
  log('agent create Desktop folder+file', {
    content: r2.content?.slice(0, 400),
    tools: r2.tools,
    error: r2.error,
    timeout: r2.timeout,
  });

  const agentFile = path.join(desktopAgentDir, 'hello.txt');
  const existsDir = fs.existsSync(desktopAgentDir);
  const existsFile = fs.existsSync(agentFile);
  const fileBody = existsFile ? fs.readFileSync(agentFile, 'utf8') : null;
  log('disk verify Desktop ops', {
    desktopAgentDir,
    existsDir,
    existsFile,
    fileBody,
    pass: existsDir && existsFile && (fileBody || '').includes('openchat-file-ops-ok'),
  });

  // 3) Write inside project via agent then read back
  const tmpName = '.openchat-smoke-write.txt';
  const r3 = await chat(
    `Use file_write to write the file "${tmpName}" in the project root with exact content: project-write-ok\nThen file_read it and quote the content.`,
  );
  const projPath = path.join(process.cwd(), tmpName);
  const projExists = fs.existsSync(projPath);
  const projBody = projExists ? fs.readFileSync(projPath, 'utf8') : null;
  log('agent project file_write', {
    content: r3.content?.slice(0, 300),
    tools: r3.tools,
    error: r3.error,
    projExists,
    projBody,
    pass: projExists && (projBody || '').includes('project-write-ok'),
  });

  // Cleanup
  try {
    if (projExists) fs.unlinkSync(projPath);
  } catch {
    /* */
  }
  try {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    /* */
  }
  // leave agent folder for user inspection? remove it for cleanliness
  try {
    if (existsDir) fs.rmSync(desktopAgentDir, { recursive: true, force: true });
  } catch {
    /* */
  }

  const passRead =
    (r1.content || '').includes('openchat') &&
    r1.tools.some((t) => t.name === 'file_read' && (t.phase === 'result' ? t.ok !== false : true));
  const passDesktop = existsDir && existsFile && (fileBody || '').includes('openchat-file-ops-ok');
  const passWrite = projExists && (projBody || '').includes('project-write-ok');

  console.log('\n======== SUMMARY ========');
  console.log(passRead ? 'PASS' : 'FAIL', 'file_read package.json');
  console.log(passDesktop ? 'PASS' : 'FAIL', 'Desktop mkdir + write');
  console.log(passWrite ? 'PASS' : 'FAIL', 'project file_write');
  console.log(ground.desktopWritable ? 'PASS' : 'FAIL', 'Desktop writable (OS)');
  const all = passRead && passDesktop && passWrite && ground.desktopWritable;
  console.log(all ? '\nALL FILE OPS OK' : '\nSOME FILE OPS FAILED');
  process.exit(all ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
