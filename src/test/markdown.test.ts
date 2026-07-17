import { describe, it, expect, afterEach } from 'vitest';
import {
  renderMarkdown,
  renderMarkdownFast,
  hasObjectLeak,
  clearMarkdownCache,
} from '../lib/markdown';

describe('renderMarkdown — no object leaks', () => {
  afterEach(() => clearMarkdownCache());

  const samples: Array<{ name: string; md: string; mustInclude?: string }> = [
    {
      name: 'table GFM',
      md: '| 层面 | 内容 |\n|------|------|\n| 爱情 | 宝黛 |\n| 家族 | 贾府 |',
      mustInclude: '宝黛',
    },
    {
      name: 'table aligned',
      md: '| L | C | R |\n|:---|:---:|---:|\n| a | b | c |',
      mustInclude: '<td>a</td>',
    },
    {
      name: 'code fence',
      md: '```js\nconst x = 1\n```',
      mustInclude: 'hljs',
    },
    {
      name: 'link',
      md: 'see [docs](https://example.com) here',
      mustInclude: 'href="https://example.com"',
    },
    {
      name: 'link with emphasis',
      md: 'see [**bold**](https://example.com)',
      mustInclude: 'https://example.com',
    },
    {
      name: 'image',
      md: '![cat](https://example.com/c.png)',
      mustInclude: 'img',
    },
    {
      name: 'list nested',
      md: '- a\n  - b\n- c',
      mustInclude: '<li>',
    },
    {
      name: 'blockquote',
      md: '> quote line',
      mustInclude: 'blockquote',
    },
    {
      name: 'honglou style',
      md: `红楼梦是清代小说。

| 层面 | 内容 |
|------|------|
| 爱情主线 | 宝玉黛玉 |
| 家族兴衰 | 四大家族 |

结构概览：共120回。`,
      mustInclude: '四大家族',
    },
  ];

  for (const s of samples) {
    it(`renders ${s.name} without [object Object]`, () => {
      const html = renderMarkdown(s.md, false);
      expect(typeof html).toBe('string');
      expect(html.includes('[object Object]')).toBe(false);
      expect(html.includes('[object Promise]')).toBe(false);
      expect(hasObjectLeak(html)).toBe(false);
      if (s.mustInclude) expect(html).toContain(s.mustInclude);
    });
  }

  it('fast path never throws on tables', () => {
    const html = renderMarkdownFast('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(html.includes('[object Object]')).toBe(false);
  });

  it('defensive on non-string input', () => {
    const html = renderMarkdown({ foo: 1 } as any, false);
    expect(html.includes('[object Object]')).toBe(false);
  });
});
