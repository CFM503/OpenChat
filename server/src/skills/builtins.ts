// ============================================================================
// Skill System — Built-in Skills
// ============================================================================

import type { Skill } from './types.js';

export const BUILTIN_SKILLS: Skill[] = [
  {
    name: 'review-code',
    description: '审查代码，发现 bug、安全漏洞和性能问题',
    shortcut: '/review',
    category: 'code',
    builtin: true,
    content: `请审查以下代码，重点关注：

1. **潜在 Bug** — 逻辑错误、边界条件、空指针
2. **安全漏洞** — 注入攻击、路径遍历、信息泄露
3. **性能问题** — 不必要的循环、内存泄漏、N+1 查询
4. **代码风格** — 命名规范、可读性、DRY 原则

对每个发现的问题，给出：
- 🔴 严重程度（Critical / High / Medium / Low）
- 📍 位置（文件名和行号）
- 💡 修复建议和示例代码

{{selection}}`,
  },
  {
    name: 'explain-code',
    description: '解释代码的工作原理和设计意图',
    shortcut: '/explain',
    category: 'code',
    builtin: true,
    content: `请详细解释以下代码：

1. **整体功能** — 这段代码做什么？
2. **执行流程** — 从输入到输出的完整路径
3. **关键设计** — 使用了什么模式或算法？为什么这样选择？
4. **依赖关系** — 依赖了哪些外部模块或 API？
5. **注意事项** — 使用时需要注意的边界条件或陷阱

请用简洁清晰的语言，必要时用图表或示例辅助说明。

{{selection}}`,
  },
  {
    name: 'write-tests',
    description: '为代码编写单元测试',
    shortcut: '/test',
    category: 'test',
    builtin: true,
    content: `请为以下代码编写全面的单元测试：

**要求**：
- 覆盖正常路径和边界条件
- 测试错误处理和异常情况
- 使用项目现有的测试框架
- 每个测试用例有清晰的描述
- 目标覆盖率 > 90%

**测试场景**：
1. ✅ 正常输入 → 正确输出
2. ⚠️ 边界值 — 空值、零值、极大值
3. ❌ 错误输入 — 类型错误、格式错误
4. 🔄 幂等性 — 重复调用结果一致

{{selection}}`,
  },
  {
    name: 'refactor-code',
    description: '重构代码，提升可维护性和性能',
    shortcut: '/refactor',
    category: 'code',
    builtin: true,
    content: `请分析以下代码并给出重构建议：

**评估维度**：
1. 📐 可读性 — 函数长度、命名清晰度、注释质量
2. 🧩 模块化 — 职责单一、耦合度、内聚度
3. ♻️ 可复用性 — 是否有重复逻辑可以抽取
4. ⚡ 性能 — 是否有优化空间
5. 🧪 可测试性 — 依赖注入、纯函数比例

**输出格式**：
- 当前问题列表（按优先级排序）
- 重构方案（含完整代码）
- 重构前后对比
- 风险评估

{{selection}}`,
  },
  {
    name: 'generate-docs',
    description: '生成代码文档和注释',
    shortcut: '/docs',
    category: 'docs',
    builtin: true,
    content: `请为以下代码生成完整文档：

**文档内容**：
1. 📝 模块/函数概述
2. 📋 参数说明（类型、必填、默认值）
3. 📤 返回值说明
4. 💡 使用示例
5. ⚠️ 注意事项和限制

**格式要求**：
- 使用 JSDoc / TSDoc 格式注释
- 生成独立的 README 段落（如适用）
- 包含至少 2 个使用示例
- 标注版本要求和依赖

{{selection}}`,
  },
];
