import { Marked } from 'marked';

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const broken = new Marked({
  renderer: {
    table(token) {
      return `<div>${token.header}${token.body}</div>`;
    },
  },
});

const fixed = new Marked({
  renderer: {
    table(token) {
      const parseCell = (cell) => {
        if (!cell) return '';
        if (typeof cell === 'string') return escapeHtml(cell);
        if (Array.isArray(cell.tokens) && this?.parser?.parseInline) {
          return this.parser.parseInline(cell.tokens);
        }
        return escapeHtml(String(cell.text ?? ''));
      };
      let thead = '<tr>';
      for (const c of token.header || []) thead += `<th>${parseCell(c)}</th>`;
      thead += '</tr>';
      let tbody = '';
      for (const row of token.rows || []) {
        tbody += '<tr>';
        for (const c of row) tbody += `<td>${parseCell(c)}</td>`;
        tbody += '</tr>';
      }
      return `<table><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
    },
  },
});

const md = `| 层面 | 内容 |
|------|------|
| 爱情 | 宝黛 |
| 家族 | 贾府兴衰 |`;

const b = broken.parse(md);
const f = fixed.parse(md);
console.log('BROKEN has [object Object]?', String(b).includes('[object Object]'));
console.log('BROKEN sample:', String(b).slice(0, 120));
console.log('FIXED has [object Object]?', String(f).includes('[object Object]'));
console.log('FIXED sample:', String(f));
if (String(f).includes('[object Object]') || !String(f).includes('宝黛')) process.exit(1);
console.log('OK');
