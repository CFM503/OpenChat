// ============================================================================
// Skills API Routes
// ============================================================================

import { Hono } from 'hono';
import type { SkillManager } from '../skills/loader.js';

export function createSkillsRouter(skills: SkillManager): Hono {
  const router = new Hono();

  // List all skills
  router.get('/', (c) => {
    return c.json(skills.getAll().map(s => ({
      name: s.name,
      description: s.description,
      shortcut: s.shortcut,
      category: s.category,
      builtin: s.builtin,
    })));
  });

  // Get a single skill by name
  router.get('/:name', (c) => {
    const name = c.req.param('name');
    const skill = skills.get(name);
    if (!skill) return c.json({ error: 'Skill not found' }, 404);
    return c.json({
      name: skill.name,
      description: skill.description,
      shortcut: skill.shortcut,
      category: skill.category,
      builtin: skill.builtin,
      content: skill.content,
    });
  });

  // Expand a skill template
  router.post('/:name/expand', async (c) => {
    const name = c.req.param('name');
    const skill = skills.get(name);
    if (!skill) return c.json({ error: 'Skill not found' }, 404);

    const body = await c.req.json().catch(() => ({}));
    const expanded = skills.expand(skill, body.selection);
    return c.json({ expanded });
  });

  // Create a new user skill
  router.post('/', async (c) => {
    const body = await c.req.json();
    if (!body.name || !body.shortcut || !body.content) {
      return c.json({ error: 'name, shortcut, and content are required' }, 400);
    }
    try {
      const skill = await skills.create(
        {
          name: body.name,
          description: body.description || '',
          shortcut: body.shortcut,
          category: body.category,
        },
        body.content,
      );
      return c.json({ success: true, name: skill.name }, 201);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  // Delete a user skill
  router.delete('/:name', async (c) => {
    const name = c.req.param('name');
    const deleted = await skills.delete(name);
    if (!deleted) return c.json({ error: 'Skill not found or is built-in' }, 404);
    return c.json({ success: true });
  });

  return router;
}
