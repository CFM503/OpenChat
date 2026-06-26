// ============================================================================
// Skill System — Loader
// ============================================================================

import * as fs from 'fs/promises';
import * as path from 'path';
import { BUILTIN_SKILLS } from './builtins.js';
import type { Skill, SkillMetadata } from './types.js';

/**
 * Parses frontmatter from a .md skill file.
 * Format:
 *   ---
 *   name: review-code
 *   description: Review code
 *   shortcut: /review
 *   ---
 *   Content here...
 */
function parseSkillFile(content: string, filePath: string): Skill | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith('---')) return null;

  const endIdx = trimmed.indexOf('---', 3);
  if (endIdx === -1) return null;

  const frontmatter = trimmed.slice(3, endIdx).trim();
  const body = trimmed.slice(endIdx + 3).trim();

  const meta: Record<string, string> = {};
  for (const line of frontmatter.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    meta[key] = value;
  }

  if (!meta.name || !meta.shortcut) return null;

  return {
    name: meta.name,
    description: meta.description || '',
    shortcut: meta.shortcut,
    category: meta.category,
    builtin: false,
    content: body,
    filePath,
  };
}

export class SkillManager {
  private skills: Map<string, Skill> = new Map();
  private userDir: string;

  constructor(userDir: string) {
    this.userDir = userDir;
  }

  /**
   * Load built-in skills and user skills from disk.
   */
  async load(): Promise<void> {
    // Load built-ins
    for (const skill of BUILTIN_SKILLS) {
      this.skills.set(skill.name, skill);
    }

    // Load user skills from ~/.openchat/skills/
    try {
      await fs.mkdir(this.userDir, { recursive: true });
      const entries = await fs.readdir(this.userDir);
      for (const entry of entries) {
        if (!entry.endsWith('.md')) continue;
        const filePath = path.join(this.userDir, entry);
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const skill = parseSkillFile(content, filePath);
          if (skill) {
            this.skills.set(skill.name, skill);
          }
        } catch {
          // Skip unreadable files
        }
      }
    } catch {
      // User dir doesn't exist yet — that's fine
    }
  }

  /**
   * Get all registered skills.
   */
  getAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Get a skill by name.
   */
  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * Get a skill by shortcut (e.g., "/review").
   */
  getByShortcut(shortcut: string): Skill | undefined {
    for (const skill of this.skills.values()) {
      if (skill.shortcut === shortcut) return skill;
    }
    return undefined;
  }

  /**
   * Create a new user skill. Saves to disk.
   */
  async create(metadata: SkillMetadata, content: string): Promise<Skill> {
    const skill: Skill = {
      ...metadata,
      builtin: false,
      content,
      filePath: path.join(this.userDir, `${metadata.name}.md`),
    };

    const fileContent = `---
name: ${metadata.name}
description: ${metadata.description}
shortcut: ${metadata.shortcut}
${metadata.category ? `category: ${metadata.category}` : ''}
---
${content}`;

    await fs.mkdir(this.userDir, { recursive: true });
    await fs.writeFile(skill.filePath!, fileContent, 'utf-8');
    this.skills.set(skill.name, skill);
    return skill;
  }

  /**
   * Delete a user skill. Cannot delete built-ins.
   */
  async delete(name: string): Promise<boolean> {
    const skill = this.skills.get(name);
    if (!skill || skill.builtin || !skill.filePath) return false;

    try {
      await fs.unlink(skill.filePath);
    } catch {
      // File may already be deleted
    }
    this.skills.delete(name);
    return true;
  }

  /**
   * Expand a skill template with user input.
   */
  expand(skill: Skill, selection?: string): string {
    let result = skill.content;
    if (selection) {
      result = result.replace(/\{\{selection\}\}/g, selection);
    }
    return result;
  }
}
