// ============================================================================
// Skill System — Types
// ============================================================================

export interface Skill {
  name: string;
  description: string;
  shortcut: string;       // e.g. "/review", "/explain"
  category?: string;      // e.g. "code", "docs", "test"
  builtin?: boolean;      // true for built-in skills
  content: string;        // The prompt template (markdown body)
  filePath?: string;      // Path to the .md file (undefined for built-ins)
}
