// ============================================================================
// SkillManager — Claude Code compatible skill discovery & expansion
//
// Discovery order (later overrides earlier for same name, except plugins namespaced):
//   1. Built-ins
//   2. Personal: ~/.claude/skills/, ~/.openchat/skills/
//   3. Project:  <cwd>/.claude/skills/, <cwd>/.openchat/skills/
//   4. Commands: .claude/commands/*.md, .openchat/commands/*.md
//   5. Plugins:  registered via registerPluginSkills()
// ============================================================================

import * as fs from 'fs/promises';
import * as path from 'path';
import { BUILTIN_SKILLS } from './builtins.js';
import {
  buildSkillFromContent,
  expandSkillTemplate,
  injectShellContext,
} from './parse.js';
import type {
  ExpandSkillOptions,
  Skill,
  SkillCatalogEntry,
  SkillSource,
} from './types.js';

export class SkillManager {
  private skills = new Map<string, Skill>(); // key: skill.name (or namespaced)
  private byShortcut = new Map<string, string>(); // shortcut → name key
  private userDir: string;
  private projectDir: string;
  private claudeUserDir: string;

  constructor(userDir: string, projectDir?: string) {
    this.userDir = userDir;
    this.projectDir = projectDir ?? process.cwd();
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
    this.claudeUserDir = path.join(home, '.claude', 'skills');
  }

  setProjectDir(dir: string): void {
    this.projectDir = dir;
  }

  /**
   * Load all skills from known locations.
   */
  async load(): Promise<void> {
    this.skills.clear();
    this.byShortcut.clear();

    // 1. Built-ins
    for (const skill of BUILTIN_SKILLS) {
      this.addSkill(skill);
    }

    // 2. Personal openchat + claude
    await this.loadSkillsFromRoot(this.userDir, 'personal');
    await this.loadSkillsFromRoot(this.claudeUserDir, 'personal');

    // Legacy flat *.md in personal openchat skills dir
    await this.loadFlatMarkdownSkills(this.userDir, 'personal');

    // 3. Project skills
    await this.loadSkillsFromRoot(path.join(this.projectDir, '.openchat', 'skills'), 'project');
    await this.loadSkillsFromRoot(path.join(this.projectDir, '.claude', 'skills'), 'project');

    // 4. Legacy commands
    await this.loadCommandDir(path.join(this.projectDir, '.claude', 'commands'), 'command');
    await this.loadCommandDir(path.join(this.projectDir, '.openchat', 'commands'), 'command');
    await this.loadCommandDir(path.join(path.dirname(this.userDir), 'commands'), 'command');
  }

  /**
   * Load skills/<name>/SKILL.md under a root directory.
   */
  async loadSkillsFromRoot(root: string, source: SkillSource, pluginName?: string): Promise<number> {
    let count = 0;
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        // Skip hidden dirs except we allow normal names
        if (entry.name.startsWith('.') && entry.name !== '.') continue;

        const skillDir = path.join(root, entry.name);
        const skillMd = path.join(skillDir, 'SKILL.md');
        try {
          const raw = await fs.readFile(skillMd, 'utf-8');
          const skill = buildSkillFromContent({
            raw,
            filePath: skillMd,
            defaultName: entry.name,
            source: pluginName ? 'plugin' : source,
            pluginName,
            namespace: pluginName,
          });
          if (skill) {
            this.addSkill(skill);
            count++;
          }
        } catch {
          // No SKILL.md — skip (might be a nested plugin folder)
        }
      }
    } catch {
      // Dir doesn't exist
    }
    return count;
  }

  /**
   * Load flat skill.md files (legacy OpenChat format: name.md with frontmatter).
   */
  async loadFlatMarkdownSkills(dir: string, source: SkillSource): Promise<number> {
    let count = 0;
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
        if (entry.name.toUpperCase() === 'SKILL.MD') continue;
        const filePath = path.join(dir, entry.name);
        try {
          const raw = await fs.readFile(filePath, 'utf-8');
          const defaultName = entry.name.replace(/\.md$/i, '');
          const skill = buildSkillFromContent({
            raw,
            filePath,
            defaultName,
            source,
          });
          if (skill) {
            // Ensure shortcut from frontmatter or /name
            this.addSkill(skill);
            count++;
          }
        } catch {
          // skip
        }
      }
    } catch {
      // skip
    }
    return count;
  }

  /**
   * Load .claude/commands/*.md as skills (Claude Code legacy commands).
   */
  async loadCommandDir(dir: string, source: SkillSource = 'command'): Promise<number> {
    let count = 0;
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
        const filePath = path.join(dir, entry.name);
        const defaultName = entry.name.replace(/\.md$/i, '');
        try {
          const raw = await fs.readFile(filePath, 'utf-8');
          const skill = buildSkillFromContent({
            raw,
            filePath,
            defaultName,
            source,
          });
          if (skill) {
            this.addSkill(skill);
            count++;
          }
        } catch {
          // skip
        }
      }
    } catch {
      // skip
    }
    return count;
  }

  /**
   * Register skills from a Claude-style plugin directory (skills/ + commands/).
   */
  async registerPluginSkills(pluginName: string, pluginRoot: string): Promise<number> {
    let n = 0;
    n += await this.loadSkillsFromRoot(path.join(pluginRoot, 'skills'), 'plugin', pluginName);
    n += await this.loadCommandDirAsPlugin(path.join(pluginRoot, 'commands'), pluginName);

    // Plugin-root SKILL.md (single skill plugin)
    const rootSkill = path.join(pluginRoot, 'SKILL.md');
    try {
      const raw = await fs.readFile(rootSkill, 'utf-8');
      const skill = buildSkillFromContent({
        raw,
        filePath: rootSkill,
        defaultName: pluginName,
        source: 'plugin',
        pluginName,
        namespace: pluginName,
      });
      if (skill) {
        this.addSkill(skill);
        n++;
      }
    } catch {
      // none
    }
    return n;
  }

  private async loadCommandDirAsPlugin(dir: string, pluginName: string): Promise<number> {
    let count = 0;
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
        const filePath = path.join(dir, entry.name);
        const defaultName = entry.name.replace(/\.md$/i, '');
        const raw = await fs.readFile(filePath, 'utf-8');
        const skill = buildSkillFromContent({
          raw,
          filePath,
          defaultName,
          source: 'plugin',
          pluginName,
          namespace: pluginName,
        });
        if (skill) {
          this.addSkill(skill);
          count++;
        }
      }
    } catch {
      // skip
    }
    return count;
  }

  /**
   * Unregister all skills from a plugin.
   */
  unregisterPluginSkills(pluginName: string): void {
    for (const [key, skill] of [...this.skills.entries()]) {
      if (skill.pluginName === pluginName) {
        this.skills.delete(key);
        this.byShortcut.delete(skill.shortcut);
      }
    }
  }

  private addSkill(skill: Skill): void {
    // Key: for plugins use namespaced shortcut path; else name
    const key = skill.pluginName
      ? `${skill.pluginName}:${skill.name}`
      : skill.name;

    // Override policy: project overrides personal overrides builtin
    const existing = this.skills.get(key);
    if (existing) {
      const rank = (s: SkillSource) =>
        ({ builtin: 0, personal: 1, command: 2, project: 3, plugin: 4 }[s] ?? 0);
      if (rank(skill.source) < rank(existing.source)) {
        return; // keep higher-priority existing
      }
    }

    // Also check unqualified name collision for non-plugin
    if (!skill.pluginName) {
      const prev = this.skills.get(skill.name);
      if (prev && prev.pluginName) {
        // keep both under different keys
      }
    }

    this.skills.set(key, skill);
    this.byShortcut.set(skill.shortcut, key);
    // Also map unqualified /name for plugin skills for convenience
    if (skill.pluginName) {
      this.byShortcut.set(`/${skill.name}`, key);
    }
  }

  getAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  get(nameOrId: string): Skill | undefined {
    // Try exact key, then name, then without leading slash
    const clean = nameOrId.replace(/^\//, '');
    return (
      this.skills.get(nameOrId) ||
      this.skills.get(clean) ||
      [...this.skills.values()].find(
        s => s.name === clean || s.id === nameOrId || s.shortcut === nameOrId || s.shortcut === `/${clean}`,
      )
    );
  }

  getByShortcut(shortcut: string): Skill | undefined {
    const key = this.byShortcut.get(shortcut) || this.byShortcut.get(shortcut.startsWith('/') ? shortcut : `/${shortcut}`);
    if (key) return this.skills.get(key);
    return this.get(shortcut);
  }

  /**
   * Catalog for LLM (excludes disable-model-invocation skills from auto list).
   */
  getCatalog(forModel = true): SkillCatalogEntry[] {
    return this.getAll()
      .filter(s => {
        if (forModel && s.disableModelInvocation) return false;
        return true;
      })
      .map(s => ({
        name: s.pluginName ? `${s.pluginName}:${s.name}` : s.name,
        shortcut: s.shortcut,
        description: s.description,
        whenToUse: s.whenToUse,
        source: s.source,
        argumentHint: s.argumentHint,
        userInvocable: s.userInvocable,
      }));
  }

  /**
   * User-invocable skills for the / picker.
   */
  getUserInvocable(): Skill[] {
    return this.getAll().filter(s => s.userInvocable);
  }

  /**
   * Expand a skill with arguments + optional shell injection.
   */
  async expand(skill: Skill, opts: ExpandSkillOptions = {}): Promise<string> {
    let text = expandSkillTemplate(skill, {
      arguments: opts.arguments,
      selection: opts.selection,
      sessionId: opts.sessionId,
      projectDir: opts.projectDir ?? this.projectDir,
    });

    if (opts.runShell !== false) {
      text = await injectShellContext(text, {
        cwd: opts.projectDir ?? this.projectDir,
        skillDir: skill.skillDir,
        projectDir: opts.projectDir ?? this.projectDir,
        shell: skill.shell,
      });
    }

    return text;
  }

  /**
   * Sync expand (no shell) — for simple template cases.
   */
  expandSync(skill: Skill, selection?: string, args?: string): string {
    return expandSkillTemplate(skill, {
      selection,
      arguments: args,
      projectDir: this.projectDir,
    });
  }

  /**
   * Create a Claude-style skill directory: skills/<name>/SKILL.md
   */
  async create(
    metadata: {
      name: string;
      description: string;
      shortcut?: string;
      category?: string;
      disableModelInvocation?: boolean;
    },
    content: string,
  ): Promise<Skill> {
    if (!/^[a-zA-Z0-9_-]+$/.test(metadata.name)) {
      throw new Error('Skill name must be alphanumeric, underscore, or hyphen only');
    }

    const skillDir = path.join(this.userDir, metadata.name);
    const skillMd = path.join(skillDir, 'SKILL.md');
    const resolvedDir = path.resolve(this.userDir);
    if (!path.resolve(skillDir).startsWith(resolvedDir)) {
      throw new Error('Invalid skill name: path traversal detected');
    }

    const shortcut = metadata.shortcut || `/${metadata.name}`;
    const fm = [
      '---',
      `name: ${metadata.name}`,
      `description: ${metadata.description}`,
      metadata.category ? `category: ${metadata.category}` : null,
      metadata.disableModelInvocation ? 'disable-model-invocation: true' : null,
      `shortcut: ${shortcut}`,
      '---',
      '',
      content,
    ]
      .filter(l => l !== null)
      .join('\n');

    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(skillMd, fm, 'utf-8');

    const skill = buildSkillFromContent({
      raw: fm,
      filePath: skillMd,
      defaultName: metadata.name,
      source: 'personal',
    })!;

    this.addSkill(skill);
    return skill;
  }

  async delete(name: string): Promise<boolean> {
    const skill = this.get(name);
    if (!skill || skill.builtin || skill.source === 'builtin') return false;
    if (skill.source === 'plugin') return false; // uninstall plugin instead

    try {
      if (skill.skillDir && skill.filePath?.endsWith('SKILL.md')) {
        // Remove whole skill directory
        await fs.rm(skill.skillDir, { recursive: true, force: true });
      } else if (skill.filePath) {
        await fs.unlink(skill.filePath);
      }
    } catch {
      // ignore
    }

    const key = skill.pluginName ? `${skill.pluginName}:${skill.name}` : skill.name;
    this.skills.delete(key);
    this.byShortcut.delete(skill.shortcut);
    return true;
  }

  /**
   * Build system-prompt block listing available skills for the agent.
   */
  buildCatalogPrompt(): string {
    const entries = this.getCatalog(true);
    if (entries.length === 0) return '';

    const lines = [
      '# Available Skills',
      '',
      'You can invoke a skill with the `skill` tool when the user\'s request matches a skill description.',
      'Users can also type `/skill-name` to invoke skills directly.',
      '',
    ];

    for (const e of entries) {
      const when = e.whenToUse ? ` When: ${e.whenToUse}` : '';
      const hint = e.argumentHint ? ` Args: ${e.argumentHint}` : '';
      lines.push(`- **${e.shortcut}** (${e.name}) [${e.source}]: ${e.description}${when}${hint}`);
    }

    return lines.join('\n');
  }
}
