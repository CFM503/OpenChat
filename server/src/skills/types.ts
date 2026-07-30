// ============================================================================
// Skill System — Claude Code / Agent Skills compatible types
// ============================================================================

/** Where a skill was discovered from */
export type SkillSource =
  | 'builtin'
  | 'personal'      // ~/.openchat/skills or ~/.claude/skills
  | 'project'       // .openchat/skills or .claude/skills
  | 'plugin'        // bundled inside a plugin
  | 'command';      // legacy .claude/commands/*.md

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  when_to_use?: string;
  'argument-hint'?: string;
  arguments?: string | string[];
  'disable-model-invocation'?: boolean | string;
  'user-invocable'?: boolean | string;
  'allowed-tools'?: string | string[];
  'disallowed-tools'?: string | string[];
  model?: string;
  context?: string;   // 'fork' etc.
  agent?: string;
  paths?: string | string[];
  shell?: string;
  category?: string;
  shortcut?: string;  // OpenChat legacy
  tools?: string | string[];
}

export interface Skill {
  /** Unique id used for lookup (namespaced for plugins: plugin:skill) */
  id: string;
  /** Display / directory name — also the /slash command (unqualified) */
  name: string;
  description: string;
  whenToUse?: string;
  /** Slash form, e.g. /review or /my-plugin:review */
  shortcut: string;
  category?: string;
  source: SkillSource;
  /** Plugin name if source === 'plugin' */
  pluginName?: string;
  /** Raw markdown body (after frontmatter) */
  content: string;
  /** Absolute path to SKILL.md or .md file */
  filePath?: string;
  /** Directory containing the skill (for ${CLAUDE_SKILL_DIR}) */
  skillDir?: string;
  /** Frontmatter flags */
  disableModelInvocation: boolean;
  userInvocable: boolean;
  argumentHint?: string;
  argumentNames?: string[];
  allowedTools?: string[];
  disallowedTools?: string[];
  model?: string;
  context?: string;
  agent?: string;
  paths?: string[];
  shell?: string;
  /** True for OpenChat built-in skills */
  builtin?: boolean;
}

/** Lightweight entry for LLM skill catalog (descriptions only) */
export interface SkillCatalogEntry {
  name: string;
  shortcut: string;
  description: string;
  whenToUse?: string;
  source: SkillSource;
  argumentHint?: string;
  userInvocable: boolean;
}

export interface ExpandSkillOptions {
  arguments?: string;
  selection?: string;
  sessionId?: string;
  projectDir?: string;
  /** Run !`cmd` dynamic injections (default true) */
  runShell?: boolean;
}
