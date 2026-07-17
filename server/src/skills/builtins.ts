// ============================================================================
// Built-in Skills — Claude Code SKILL.md style (in-memory)
// ============================================================================

import type { Skill } from './types.js';

function builtin(
  name: string,
  description: string,
  content: string,
  extra?: Partial<Skill>,
): Skill {
  return {
    id: `builtin:${name}`,
    name,
    description,
    shortcut: `/${name}`,
    source: 'builtin',
    content,
    disableModelInvocation: false,
    userInvocable: true,
    builtin: true,
    category: extra?.category,
    ...extra,
  };
}

export const BUILTIN_SKILLS: Skill[] = [
  builtin(
    'review',
    'Review code for bugs, security issues, and performance problems. Use when the user asks for a code review or to check quality.',
    `请审查代码（用户选区或当前讨论的代码），重点关注：

1. **潜在 Bug** — 逻辑错误、边界条件、空指针
2. **安全漏洞** — 注入、路径遍历、信息泄露
3. **性能问题** — 不必要的循环、内存泄漏、N+1 查询
4. **代码风格** — 命名、可读性、DRY

对每个问题给出：严重程度、位置、修复建议与示例。

{{selection}}
$ARGUMENTS`,
    { category: 'code' },
  ),
  builtin(
    'explain',
    'Explain how code works and its design intent. Use when the user asks what code does or how it works.',
    `请详细解释以下代码：

1. **整体功能**
2. **执行流程**
3. **关键设计 / 模式**
4. **依赖关系**
5. **注意事项与边界条件**

{{selection}}
$ARGUMENTS`,
    { category: 'code' },
  ),
  builtin(
    'test',
    'Write unit tests for code. Use when the user asks for tests or coverage.',
    `请为以下代码编写全面的单元测试：

- 覆盖正常路径与边界条件
- 测试错误处理
- 使用项目现有测试框架
- 每个用例有清晰描述

{{selection}}
$ARGUMENTS`,
    { category: 'test' },
  ),
  builtin(
    'refactor',
    'Refactor code for maintainability and performance. Use when the user asks to clean up or improve structure.',
    `请分析并重构以下代码：

评估：可读性、模块化、可复用性、性能、可测试性。

输出：问题列表、重构方案（完整代码）、前后对比、风险。

{{selection}}
$ARGUMENTS`,
    { category: 'code' },
  ),
  builtin(
    'docs',
    'Generate documentation and comments for code. Use when the user asks for docs or JSDoc/TSDoc.',
    `请为以下代码生成完整文档：

1. 模块/函数概述
2. 参数与返回值
3. 使用示例
4. 注意事项

优先使用项目文档约定（JSDoc/TSDoc/README）。

{{selection}}
$ARGUMENTS`,
    { category: 'docs' },
  ),
  builtin(
    'commit',
    'Stage relevant files and create a well-structured git commit. Only invoke when the user asks to commit.',
    `Create a git commit for the current changes.

## Steps
1. Run \`git status\` and \`git diff\` (and \`git diff --staged\`)
2. Analyze changes and draft a concise commit message (conventional commits if the repo uses them)
3. Stage relevant files (not secrets, not .openchat with keys)
4. Commit with a clear message
5. Run \`git status\` to verify

Do NOT push unless the user explicitly asks.

$ARGUMENTS`,
    {
      category: 'git',
      disableModelInvocation: true,
    },
  ),
  builtin(
    'pr-summary',
    'Summarize the current pull request or branch diff. Use when the user asks about a PR or recent changes.',
    `## Context

Uncommitted and branch changes (if available):

!\`git status -sb\`

!\`git diff HEAD --stat\`

## Task

Summarize the changes in 2–5 bullets, list risks, and suggest a PR title.

$ARGUMENTS`,
    { category: 'git' },
  ),
];
