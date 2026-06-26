// ============================================================================
// Skill System — Types
// ============================================================================

export interface SkillMetadata {
  name: string;
  description: string;
  shortcut: string;       // e.g. "/review", "/explain"
  category?: string;      // e.g. "code", "docs", "test"
  builtin?: boolean;      // true for built-in skills
}

export interface Skill extends SkillMetadata {
  content: string;        // The prompt template (markdown body)
  filePath?: string;      // Path to the .md file (undefined for built-ins)
}

export interface SkillInput {
  selection?: string;     // Selected code/text to insert into template
  extra?: string;         // Additional context from user
}
