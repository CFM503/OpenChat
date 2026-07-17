/**
 * Audit Marked v18 custom renderers for [object Object] bugs.
 */
import { Marked } from 'marked';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Mirror ChatPanel markedFull (before/after style)
const markedFull = new Marked({
  renderer: {
    code({ text, lang }) {
      const raw = typeof text === 'string' ? text : String(text ?? '');
      let language = lang || 'text';
      if (!hljs.getLanguage(language)) language = 'text';
      const highlighted =
        language !== 'text'
          ? hljs.highlight(raw, { language, ignoreIllegals: true }).value
          : escapeHtml(raw);
      return `<div class="code-block-wrapper"><pre><code class="hljs language-${language}">${highlighted}</code></pre></div>`;
    },
    link({ href, text, tokens }) {
      const h = typeof href === 'string' ? href : '#';
      let t;
      if (typeof text === 'string') t = text;
      else if (Array.isArray(tokens) && this?.parser?.parseInline) {
        t = this.parser.parseInline(tokens);
      } else t = escapeHtml(String(text ?? ''));
      return `<a href="${escapeHtml(h)}" target="_blank" rel="noopener noreferrer">${t}</a>`;
    },
    table(token) {
      const parseCell = (cell) => {
        if (!cell) return '';
        if (typeof cell === 'string') return escapeHtml(cell);
        if (Array.isArray(cell.tokens) && this?.parser?.parseInline) {
          try {
            return this.parser.parseInline(cell.tokens);
          } catch {
            /* */
          }
        }
        return escapeHtml(String(cell.text ?? cell.raw ?? ''));
      };
      const headerCells = Array.isArray(token.header) ? token.header : [];
      const rows = Array.isArray(token.rows) ? token.rows : [];
      let thead = '<tr>';
      for (const cell of headerCells) thead += `<th>${parseCell(cell)}</th>`;
      thead += '</tr>';
      let tbody = '';
      for (const row of rows) {
        tbody += '<tr>';
        for (const cell of row || []) tbody += `<td>${parseCell(cell)}</td>`;
        tbody += '</tr>';
      }
      return `<div class="table-wrapper"><table><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>\n`;
    },
  },
});

const samples = {
  plain: '你好世界',
  table: '| 层面 | 内容 |\n|------|------|\n| 爱情 | 宝黛钗 |\n| 家族 | 贾府兴衰 |',
  tableAlign: '| left | center | right |\n|:---|:---:|---:|\n| a | b | c |',
  code: '```js\nconst x = 1\nconsole.log(x)\n```',
  codeNoLang: '```\nplain code\n```',
  link: 'see [docs](https://example.com/path?q=1) please',
  linkBold: 'see [**bold link**](https://example.com)',
  image: '![alt text](https://example.com/a.png "title")',
  list: '- one\n- two\n  - nested\n- three',
  ol: '1. first\n2. second',
  heading: '# H1\n## H2\n### H3',
  blockquote: '> a quote\n>\n> line 2',
  mixed: `前言

| k | v |
|---|---|
| **bold** | [link](https://x.com) |

结尾`,
  del: '~~deleted~~ and **bold** and *em*',
  hr: 'a\n\n---\n\nb',
  taskList: '- [x] done\n- [ ] todo',
  htmlInline: 'use <code>raw</code> maybe',
  longHonglou: `红楼梦（全名《红楼梦》）是清代作家曹雪芹创作的长篇小说。

| 层面 | 内容 |
|------|------|
| 爱情主线 | 贾宝玉与林黛玉、薛宝钗 |
| 家族兴衰 | 贾、史、王、薛四大家族 |
| 社会批判 | 科举、礼教、女性命运 |

结构概览
作品共120回，曹雪芹在第80回后就去世。`,
};

let failed = 0;
for (const [name, md] of Object.entries(samples)) {
  let out;
  try {
    out = markedFull.parse(md);
  } catch (e) {
    console.log(`FAIL ${name}: throw ${e.message}`);
    failed++;
    continue;
  }
  const s = String(out);
  const bad =
    s.includes('[object Object]') ||
    s.includes('undefined</') ||
    s.includes('>undefined<') ||
    /undefined\s*$/.test(s);
  if (bad) {
    console.log(`FAIL ${name}`);
    console.log(s.slice(0, 400));
    failed++;
  } else {
    console.log(`ok   ${name} (len=${s.length})`);
  }
}

// Also probe token shapes for link/image/code
console.log('\n--- token shape probes ---');
const probe = new Marked({
  renderer: {
    code(token) {
      console.log('code keys', Object.keys(token), 'text type', typeof token.text, 'lang', token.lang);
      return '';
    },
    link(token) {
      console.log(
        'link keys',
        Object.keys(token),
        'text type',
        typeof token.text,
        'tokens?',
        Array.isArray(token.tokens),
        'href',
        token.href,
      );
      return '';
    },
    image(token) {
      console.log('image keys', Object.keys(token), 'text', token.text, 'href', token.href);
      return '';
    },
    heading(token) {
      console.log('heading keys', Object.keys(token), 'depth', token.depth, 'tokens?', Array.isArray(token.tokens));
      return '';
    },
    listitem(token) {
      console.log('listitem keys', Object.keys(token), 'tokens?', Array.isArray(token.tokens));
      return '';
    },
  },
});
probe.parse('```js\nx\n```\n\n[**a**](http://x)\n\n![i](http://y)\n\n## H\n\n- item');

console.log(failed === 0 ? '\nALL SAMPLES OK' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
