// ============================================================================
// ConfigManager — Read/write .openchat config file
// ============================================================================

import fs from 'fs';
import path from 'path';

export interface OpenChatConfig {
  models?: ModelConfig[];
  activeModelId?: string;
  webSearchEnabled?: boolean;
  tavilyApiKey?: string;
}

export interface ModelConfig {
  id: string;
  name: string;
  provider: 'openai' | 'ollama' | 'custom';
  endpoint: string;
  apiKey?: string;
  model: string;
  maxTokens: number;
  temperature: number;
  isDefault: boolean;
}

export class ConfigManager {
  private configPath: string;

  constructor(projectRoot?: string) {
    this.configPath = path.resolve(projectRoot ?? process.cwd(), '.openchat');
  }

  load(): OpenChatConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf-8');
        return JSON.parse(data);
      }
    } catch {
      // Ignore parse errors
    }
    return {};
  }

  save(config: OpenChatConfig): void {
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  getConfigPath(): string {
    return this.configPath;
  }
}
