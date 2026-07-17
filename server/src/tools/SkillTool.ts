// ============================================================================
// SkillTool — Let the agent invoke Claude Code-style skills by name
// ============================================================================

import type { ToolDefinition, ToolContext } from './types.js';
import type { ToolResult } from '../types.js';
import type { SkillManager } from '../skills/loader.js';

let skillManager: SkillManager | null = null;
let projectDir = process.cwd();

export function setSkillToolContext(manager: SkillManager, cwd: string) {
  skillManager = manager;
  projectDir = cwd;
}

interface SkillInput {
  name: string;
  arguments?: string;
}

/**
 * OpenAI-compatible tool that loads a skill's full instructions into the conversation.
 * Mirrors Claude Code's Skill tool.
 */
export const SkillTool: ToolDefinition<SkillInput> = {
  name: 'skill',
  description:
    'Load a skill (reusable workflow / playbook) by name. ' +
    'Use when a skill description matches the user request. ' +
    'Pass the skill name without leading slash (e.g. "review", "commit", "my-plugin:deploy"). ' +
    'Optional arguments are substituted into the skill template.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Skill name or shortcut without leading slash',
      },
      arguments: {
        type: 'string',
        description: 'Optional arguments passed to the skill ($ARGUMENTS)',
      },
    },
    required: ['name'],
  },
  isReadOnly: true,
  isDestructive: false,

  async execute(input: SkillInput, ctx: ToolContext): Promise<ToolResult> {
    const start = Date.now();
    if (!skillManager) {
      return {
        success: false,
        output: '',
        error: 'Skill system not initialized',
        duration: Date.now() - start,
      };
    }

    const rawName = (input.name || '').replace(/^\//, '').trim();
    if (!rawName) {
      return {
        success: false,
        output: '',
        error: 'Skill name is required',
        duration: Date.now() - start,
      };
    }

    const skill = skillManager.get(rawName) || skillManager.getByShortcut(`/${rawName}`);
    if (!skill) {
      const available = skillManager
        .getCatalog(true)
        .map(s => s.name)
        .slice(0, 30)
        .join(', ');
      return {
        success: false,
        output: '',
        error: `Unknown skill: ${rawName}. Available: ${available || '(none)'}`,
        duration: Date.now() - start,
      };
    }

    if (skill.disableModelInvocation) {
      return {
        success: false,
        output: '',
        error:
          `Skill "/${skill.name}" is user-only (disable-model-invocation). ` +
          `The user must type ${skill.shortcut} to run it.`,
        duration: Date.now() - start,
      };
    }

    try {
      const expanded = await skillManager.expand(skill, {
        arguments: input.arguments || '',
        sessionId: ctx.sessionId,
        projectDir,
        runShell: true,
      });

      const header = [
        `# Skill: ${skill.shortcut}`,
        skill.description ? `> ${skill.description}` : '',
        skill.allowedTools?.length
          ? `Allowed tools hint: ${skill.allowedTools.join(', ')}`
          : '',
        '',
      ]
        .filter(Boolean)
        .join('\n');

      return {
        success: true,
        output: header + expanded,
        duration: Date.now() - start,
      };
    } catch (err: any) {
      return {
        success: false,
        output: '',
        error: err.message || String(err),
        duration: Date.now() - start,
      };
    }
  },
};
