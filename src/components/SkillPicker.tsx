// ============================================================================
// SkillPicker Component — Dropdown for slash commands
// ============================================================================

import React from 'react';
import type { SkillInfo } from '../core/types';

interface SkillPickerProps {
  skills: SkillInfo[];
  filter: string;           // text after "/"
  onSelect: (skill: SkillInfo) => void;
  onClose: () => void;
}

export function SkillPicker({ skills, filter, onSelect, onClose }: SkillPickerProps) {
  const filtered = skills.filter(s => {
    const query = filter.toLowerCase();
    return (
      s.shortcut.toLowerCase().includes(query) ||
      s.name.toLowerCase().includes(query) ||
      s.description.toLowerCase().includes(query)
    );
  });

  if (filtered.length === 0) return null;

  return (
    <div className="skill-picker-overlay" onClick={onClose}>
      <div className="skill-picker" onClick={(e) => e.stopPropagation()}>
        <div className="skill-picker-header">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          <span>Skills</span>
        </div>
        <div className="skill-picker-list">
          {filtered.map(skill => (
            <button
              key={skill.name}
              className="skill-picker-item"
              onClick={() => onSelect(skill)}
            >
              <div className="skill-picker-item-header">
                <span className="skill-picker-shortcut">{skill.shortcut}</span>
                <span className="skill-picker-name">{skill.name}</span>
                {skill.builtin && <span className="skill-picker-badge">built-in</span>}
              </div>
              <div className="skill-picker-desc">{skill.description}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
