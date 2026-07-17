/**
 * Smoke test: multi-question WebSocket chat against a running backend.
 * Usage: node scripts/smoke-chat.mjs [port]
 */
import WebSocket from 'ws';

const PORT = parseInt(process.argv[2] || process.env.OPENCHAT_PORT || '3001', 10);
const API = `http://localhost:${PORT}`;
const WS = `ws://localhost:${PORT}/ws`;

async function health() {
  const r = await fetch(`${API}/api/health`);
  if (!r.ok) throw new Error(`health ${r.status}`);
  return r.json();
}

function uid(p) {
  return `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function chatOnce(prompt, { modelId, enableThinking = false, timeoutMs = 90000 } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS);
    const events = [];
    let content = '';
    let thinking = '';
    const tools = [];
    let error = null;
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        /* */
      }
      resolve({
        ok: false,
        reason: 'timeout',
        content,
        thinkingLen: thinking.length,
        tools,
        events: events.map((e) => e.type),
        error,
      });
    }, timeoutMs);

    const finish = (extra = {}) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* */
      }
      resolve({
        ok: !error && !!(content.trim() || tools.length),
        content: content.trim().slice(0, 500),
        contentLen: content.length,
        thinkingLen: thinking.length,
        tools,
        events: events.map((e) => e.type),
        error,
        ...extra,
      });
    };

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          type: 'chat',
          modelId,
          enableThinking,
          messages: [
            {
              id: uid('u'),
              role: 'user',
              content: prompt,
              timestamp: Date.now(),
            },
          ],
        }),
      );
    });

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      events.push(msg);
      switch (msg.type) {
        case 'content':
          content += msg.text || '';
          break;
        case 'thinking':
          thinking += msg.text || '';
          break;
        case 'tool_start':
          tools.push({ name: msg.name, status: 'start' });
          break;
        case 'tool_result':
          tools.push({
            name: msg.name,
            status: msg.result?.success ? 'ok' : 'err',
            duration: msg.result?.duration,
          });
          break;
        case 'error':
          error = msg.message;
          break;
        case 'done':
          finish();
          break;
      }
    });

    ws.on('error', (err) => {
      error = err.message;
      finish({ ok: false });
    });
  });
}

const CASES = [
  { name: 'hello', prompt: '用一句话打个招呼，不要用工具。', enableThinking: false },
  { name: 'math', prompt: '1+1等于几？只回答数字。', enableThinking: false },
  {
    name: 'weather_mdj',
    prompt: '牡丹江今天天气怎么样？需要实时信息请用 web_search。',
    enableThinking: false,
    timeoutMs: 120000,
  },
  {
    name: 'read_pkg',
    prompt: '用 file_read 读取 package.json 里的 name 和 version 字段，只回答这两个值。',
    enableThinking: false,
    timeoutMs: 120000,
  },
  {
    name: 'think_toggle_off',
    prompt: '说一个颜色，一个词即可。',
    enableThinking: false,
  },
];

async function main() {
  console.log('=== OpenChat smoke chat ===');
  const h = await health();
  console.log('health:', h.status, 'tools:', h.tools?.length, 'canMake:', h.canMakeRequest);
  if (h.tools?.includes('get_weather')) {
    console.log('WARN: get_weather still registered (stale server?)');
  }

  const cfg = await (await fetch(`${API}/api/config`)).json();
  const modelId = cfg.activeModelId;
  console.log('activeModelId:', modelId);

  const results = [];
  for (const c of CASES) {
    process.stdout.write(`\n>> ${c.name}: ${c.prompt.slice(0, 40)}…\n`);
    const r = await chatOnce(c.prompt, {
      modelId,
      enableThinking: c.enableThinking,
      timeoutMs: c.timeoutMs || 90000,
    });
    results.push({ name: c.name, ...r });
    console.log(
      JSON.stringify(
        {
          name: c.name,
          ok: r.ok,
          reason: r.reason,
          error: r.error?.slice?.(0, 120) || r.error,
          contentLen: r.contentLen,
          thinkingLen: r.thinkingLen,
          tools: r.tools,
          contentPreview: r.content?.slice(0, 180),
          eventTypes: [...new Set(r.events)],
        },
        null,
        2,
      ),
    );
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n=== SUMMARY ${passed}/${results.length} ok ===`);
  for (const r of results) {
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.reason ? ' (' + r.reason + ')' : ''}${r.error ? ' err=' + String(r.error).slice(0, 80) : ''}`);
  }
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
