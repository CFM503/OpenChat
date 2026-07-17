// ============================================================================
// Shared Markdown → HTML for chat bubbles
// Hardened for Marked v18 token objects (no more "[object Object]" leaks)
// ============================================================================

import { Marked } from 'marked';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import html from 'highlight.js/lib/languages/xml';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import sql from 'highlight.js/lib/languages/sql';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('json', json);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('css', css);
hljs.registerLanguage('html', html);
hljs.registerLanguage('xml', html);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('go', go);
hljs.registerLanguage('java', java);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);

export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Never coerce objects via String() into "[object Object]" */
function safePlainText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    // tokens array without parser — join text fields only
    return value
      .map(v => {
        if (typeof v === 'string') return v;
        if (v && typeof v === 'object' && typeof (v as any).text === 'string') return (v as any).text;
        if (v && typeof v === 'object' && typeof (v as any).raw === 'string') return (v as any).raw;
        return '';
      })
      .join('');
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o.text === 'string') return o.text;
    if (typeof o.raw === 'string') return o.raw;
    return '';
  }
  return '';
}

type ParserCtx = {
  parser?: {
    parseInline?: (tokens: unknown[]) => string;
    parse?: (tokens: unknown[]) => string;
  };
};

function parseInline(ctx: ParserCtx, tokens: unknown, fallbackText?: unknown): string {
  if (Array.isArray(tokens) && tokens.length && ctx?.parser?.parseInline) {
    try {
      return ctx.parser.parseInline(tokens);
    } catch {
      /* fall through */
    }
  }
  return escapeHtml(safePlainText(fallbackText ?? tokens));
}

const markedFull = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    code(this: ParserCtx, token: { text?: string; lang?: string; raw?: string }) {
      const raw = safePlainText(token?.text ?? token?.raw ?? '');
      let language = (token?.lang || 'text').trim() || 'text';
      // strip trailing extras: ```js {.class}
      language = language.split(/\s+/)[0] || 'text';
      if (!hljs.getLanguage(language)) language = 'text';
      const highlighted =
        language !== 'text'
          ? hljs.highlight(raw, { language, ignoreIllegals: true }).value
          : escapeHtml(raw);
      const safeLang = language.replace(/[^a-zA-Z0-9_-]/g, '');
      return (
        `<div class="code-block-wrapper"><pre><code class="hljs language-${safeLang}">${highlighted}</code></pre>` +
        `<button type="button" class="code-copy-btn" onclick="navigator.clipboard.writeText(this.parentElement.querySelector('code').textContent).then(()=>{this.textContent='Copied!';setTimeout(()=>{this.textContent='Copy'},2000)})">Copy</button></div>`
      );
    },

    link(this: ParserCtx, token: { href?: string; title?: string; text?: string; tokens?: unknown[] }) {
      const href = typeof token?.href === 'string' ? token.href : '#';
      const body = parseInline(this, token?.tokens, token?.text);
      const title =
        typeof token?.title === 'string' && token.title
          ? ` title="${escapeHtml(token.title)}"`
          : '';
      return `<a href="${escapeHtml(href)}"${title} target="_blank" rel="noopener noreferrer">${body}</a>`;
    },

    image(this: ParserCtx, token: { href?: string; title?: string; text?: string }) {
      const href = typeof token?.href === 'string' ? token.href : '';
      const alt = escapeHtml(safePlainText(token?.text));
      const title =
        typeof token?.title === 'string' && token.title
          ? ` title="${escapeHtml(token.title)}"`
          : '';
      if (!href) return alt;
      return `<img src="${escapeHtml(href)}" alt="${alt}"${title} loading="lazy" />`;
    },

    /**
     * Marked v9+ table tokens: header/rows are arrays of cell objects with .tokens
     * NEVER interpolate token.header/token.body as strings.
     */
    table(this: ParserCtx, token: any) {
      const parseCell = (cell: any) => parseInline(this, cell?.tokens, cell?.text ?? cell?.raw);

      const headerCells = Array.isArray(token?.header) ? token.header : [];
      const rows = Array.isArray(token?.rows)
        ? token.rows
        : Array.isArray(token?.body)
          ? token.body
          : [];

      let thead = '<tr>';
      for (const cell of headerCells) {
        thead += `<th>${parseCell(cell)}</th>`;
      }
      thead += '</tr>';

      let tbody = '';
      for (const row of rows) {
        const cells = Array.isArray(row) ? row : [];
        tbody += '<tr>';
        for (const cell of cells) {
          tbody += `<td>${parseCell(cell)}</td>`;
        }
        tbody += '</tr>';
      }

      return `<div class="table-wrapper"><table><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>\n`;
    },
  },
});

/** Streaming: escape + basic structure, no hljs / no marked tables */
export function renderMarkdownFast(content: string): string {
  if (!content) return '';
  const withCode = content.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code) => {
    return `<div class="code-block-wrapper"><pre><code class="hljs">${escapeHtml(code)}</code></pre></div>`;
  });
  return withCode
    .split(/\n\n+/)
    .map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

/** Detect accidental object leaks in HTML */
export function hasObjectLeak(html: string): boolean {
  return (
    html.includes('[object Object]') ||
    html.includes('[object Promise]') ||
    /(?<![\w-])undefined(?![\w-])/.test(html) && html.includes('undefined</')
  );
}

export function renderMarkdown(content: string, fast = false): string {
  if (content == null) return '';
  if (typeof content !== 'string') {
    // Defensive: never put raw objects into the DOM
    content = safePlainText(content);
  }
  if (!content) return '';
  if (fast) return renderMarkdownFast(content);
  try {
    const out = markedFull.parse(content);
    // Marked sync mode returns string; async would return Promise — guard it
    if (typeof out !== 'string') {
      if (out && typeof (out as Promise<string>).then === 'function') {
        console.warn('[markdown] async parse not supported in sync path');
        return renderMarkdownFast(content);
      }
      return renderMarkdownFast(content);
    }
    if (hasObjectLeak(out)) {
      console.warn('[markdown] object leak detected, falling back to fast renderer');
      return renderMarkdownFast(content);
    }
    return out;
  } catch {
    return renderMarkdownFast(content);
  }
}

const markdownCache = new Map<string, string>();
const MARKDOWN_CACHE_MAX = 80;

export function renderMarkdownCached(content: string, streaming: boolean): string {
  if (streaming) return renderMarkdown(content, true);
  if (typeof content !== 'string') content = safePlainText(content);
  const hit = markdownCache.get(content);
  if (hit) return hit;
  const html = renderMarkdown(content, false);
  if (markdownCache.size > MARKDOWN_CACHE_MAX) {
    const first = markdownCache.keys().next().value;
    if (first !== undefined) markdownCache.delete(first);
  }
  markdownCache.set(content, html);
  return html;
}

export function clearMarkdownCache(): void {
  markdownCache.clear();
}
