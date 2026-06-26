// ============================================================================
// SessionManager — Persist and manage chat sessions
// ============================================================================

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import type { ChatMessage } from './types.js';

export interface Session {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

/** Validate session ID to prevent path traversal (C-4). */
function isValidSessionId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

export class SessionManager {
  private sessionsDir: string;

  constructor() {
    this.sessionsDir = path.join(os.homedir(), '.openchat', 'sessions');
    this.ensureDir();
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  /** Resolve session file path safely, preventing path traversal. */
  private safePath(id: string): string | null {
    if (!isValidSessionId(id)) return null;
    const filePath = path.resolve(this.sessionsDir, `${id}.json`);
    if (!filePath.startsWith(this.sessionsDir + path.sep) && filePath !== path.join(this.sessionsDir, `${id}.json`)) {
      return null;
    }
    return filePath;
  }

  create(title?: string): Session {
    const id = `ses_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const now = Date.now();
    const session: Session = {
      id,
      title: title ?? `Session ${new Date(now).toLocaleString()}`,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    this.save(session);
    return session;
  }

  get(id: string): Session | null {
    const filePath = this.safePath(id);
    if (!filePath) return null;
    try {
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      }
    } catch {
      // Ignore
    }
    return null;
  }

  save(session: Session): void {
    session.updatedAt = Date.now();
    const filePath = this.safePath(session.id);
    if (!filePath) return;

    // Atomic write (C-5)
    const tmpPath = filePath + `.tmp.${process.pid}`;
    fs.writeFileSync(tmpPath, JSON.stringify(session, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  }

  update(id: string, messages: ChatMessage[]): void {
    const session = this.get(id);
    if (session) {
      session.messages = messages;
      this.save(session);
    }
  }

  list(): Session[] {
    try {
      const files = fs.readdirSync(this.sessionsDir).filter(f => f.endsWith('.json'));
      return files
        .map(f => {
          try {
            return JSON.parse(fs.readFileSync(path.join(this.sessionsDir, f), 'utf-8'));
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 50);  // Max 50 sessions
    } catch {
      return [];
    }
  }

  delete(id: string): boolean {
    const filePath = this.safePath(id);
    if (!filePath) return false;
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return true;
      }
    } catch {
      // Ignore
    }
    return false;
  }
}
