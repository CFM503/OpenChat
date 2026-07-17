import { describe, it, expect } from 'vitest';
import { parseFrontmatter, buildSkillFromContent, expandSkillTemplate } from '../../server/src/skills/parse.js';

describe('skill frontmatter parse', () => {
  it('parses YAML frontmatter and body', () => {
    const raw = `---
name: demo
description: A demo skill
disable-model-invocation: true
allowed-tools: Bash Read
---
Hello $ARGUMENTS
`;
    const parsed = parseFrontmatter(raw)!;
    expect(parsed.meta.name).toBe('demo');
    expect(parsed.meta.description).toBe('A demo skill');
    expect(parsed.meta['disable-model-invocation']).toBe(true);
    expect(parsed.body.trim()).toBe('Hello $ARGUMENTS');
  });

  it('builds skill with directory name as command', () => {
    const raw = `---
description: Review code carefully
---
Do a review.
`;
    const skill = buildSkillFromContent({
      raw,
      filePath: '/tmp/skills/review/SKILL.md',
      defaultName: 'review',
      source: 'project',
    })!;
    expect(skill.name).toBe('review');
    expect(skill.shortcut).toBe('/review');
    expect(skill.description).toContain('Review');
    expect(skill.disableModelInvocation).toBe(false);
  });

  it('namespaces plugin skills', () => {
    const skill = buildSkillFromContent({
      raw: `---
description: Style guide
---
Be clean.
`,
      filePath: '/p/skills/style/SKILL.md',
      defaultName: 'style',
      source: 'plugin',
      pluginName: 'team',
      namespace: 'team',
    })!;
    expect(skill.shortcut).toBe('/team:style');
    expect(skill.pluginName).toBe('team');
  });
});

describe('expandSkillTemplate', () => {
  it('substitutes $ARGUMENTS and $0', () => {
    const skill = buildSkillFromContent({
      raw: `---
description: x
---
Fix $0 with $ARGUMENTS
`,
      filePath: '/s/SKILL.md',
      defaultName: 'fix',
      source: 'personal',
    })!;
    const out = expandSkillTemplate(skill, { arguments: 'auth "user login"' });
    expect(out).toContain('auth');
  });

  it('replaces CLAUDE_SKILL_DIR and selection', () => {
    const skill = buildSkillFromContent({
      raw: `---
description: x
---
Dir=\${CLAUDE_SKILL_DIR}
Sel={{selection}}
`,
      filePath: '/home/u/.claude/skills/demo/SKILL.md',
      defaultName: 'demo',
      source: 'personal',
    })!;
    const out = expandSkillTemplate(skill, {
      selection: 'code here',
      projectDir: '/proj',
    });
    expect(out).toContain('/home/u/.claude/skills/demo');
    expect(out).toContain('code here');
  });
});
