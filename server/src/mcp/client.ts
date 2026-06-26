// ============================================================================
// MCP Client — JSON-RPC over stdio
// ============================================================================

import { type ChildProcess, spawn } from 'child_process';
import type { ToolDefinition, ToolContext } from '../tools/types.js';
import type { ToolResult } from '../types.js';

export interface MCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface MCPToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/**
 * Client for a single MCP server over stdio JSON-RPC.
 */
export class MCPClient {
  private proc: ChildProcess | null = null;
  private requestId = 0;
  private pending = new Map<number, {
    resolve: (value: any) => void;
    reject: (reason: Error) => void;
  }>();
  private buffer = '';
  private serverName: string;
  private config: MCPServerConfig;

  constructor(serverName: string, config: MCPServerConfig) {
    this.serverName = serverName;
    this.config = config;
  }

  /**
   * Start the MCP server process.
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.proc = spawn(this.config.command, this.config.args ?? [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...this.config.env },
        shell: process.platform === 'win32',
      });

      this.proc.stdout?.on('data', (data: Buffer) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      this.proc.stderr?.on('data', (data: Buffer) => {
        console.warn(`[mcp:${this.serverName}] stderr: ${data.toString().trim()}`);
      });

      this.proc.on('error', (err) => {
        console.error(`[mcp:${this.serverName}] Process error:`, err.message);
        reject(err);
      });

      this.proc.on('exit', (code) => {
        console.log(`[mcp:${this.serverName}] Process exited with code ${code}`);
        this.proc = null;
        // Reject all pending requests
        for (const [, p] of this.pending) {
          p.reject(new Error('MCP server exited'));
        }
        this.pending.clear();
      });

      // Initialize the MCP connection
      this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'openchat', version: '1.0.0' },
      }).then(() => {
        // Send initialized notification
        this.sendNotification('notifications/initialized', {});
        resolve();
      }).catch(reject);
    });
  }

  /**
   * Stop the MCP server process.
   */
  stop(): void {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
  }

  isRunning(): boolean {
    return this.proc !== null && !this.proc.killed;
  }

  /**
   * List tools from the MCP server.
   */
  async listTools(): Promise<MCPToolInfo[]> {
    const result = await this.sendRequest('tools/list', {});
    return result.tools ?? [];
  }

  /**
   * Call a tool on the MCP server.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<{ content: string }> {
    const result = await this.sendRequest('tools/call', { name, arguments: args });
    // MCP returns content as an array of parts
    const text = (result.content ?? [])
      .filter((p: any) => p.type === 'text')
      .map((p: any) => p.text)
      .join('\n');
    return { content: text || JSON.stringify(result.content) };
  }

  /**
   * Convert MCP tools into OpenChat ToolDefinitions.
   */
  toToolDefinitions(mcpTools: MCPToolInfo[]): ToolDefinition[] {
    return mcpTools.map(tool => ({
      name: `mcp_${this.serverName}_${tool.name}`,
      description: `[MCP:${this.serverName}] ${tool.description ?? tool.name}`,
      inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
      isReadOnly: true,
      isDestructive: false,
      execute: async (input: unknown, ctx: ToolContext): Promise<ToolResult> => {
        const start = Date.now();
        try {
          const result = await this.callTool(tool.name, input as Record<string, unknown>);
          return {
            success: true,
            output: result.content,
            duration: Date.now() - start,
          };
        } catch (err: any) {
          return {
            success: false,
            output: '',
            error: err.message,
            duration: Date.now() - start,
          };
        }
      },
    }));
  }

  private sendRequest(method: string, params: unknown): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      this.pending.set(id, { resolve, reject });

      const message = JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params,
      });

      this.proc?.stdin?.write(`Content-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`);

      // Timeout after 30s
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP request timeout: ${method}`));
        }
      }, 30000);
    });
  }

  private sendNotification(method: string, params: unknown): void {
    const message = JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
    });
    this.proc?.stdin?.write(`Content-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`);
  }

  private processBuffer(): void {
    while (true) {
      // Look for Content-Length header
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const header = this.buffer.slice(0, headerEnd);
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!lengthMatch) {
        // Try parsing as raw JSON (some servers don't use Content-Length)
        const newlineIdx = this.buffer.indexOf('\n');
        if (newlineIdx === -1) break;
        const line = this.buffer.slice(0, newlineIdx).trim();
        this.buffer = this.buffer.slice(newlineIdx + 1);
        if (line) {
          try {
            this.handleMessage(JSON.parse(line));
          } catch {
            // Not JSON, skip
          }
        }
        continue;
      }

      const contentLength = parseInt(lengthMatch[1], 10);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + contentLength) break;

      const body = this.buffer.slice(bodyStart, bodyStart + contentLength);
      this.buffer = this.buffer.slice(bodyStart + contentLength);

      try {
        this.handleMessage(JSON.parse(body));
      } catch (err) {
        console.warn(`[mcp:${this.serverName}] Failed to parse message:`, err);
      }
    }
  }

  private handleMessage(msg: any): void {
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) {
        p.reject(new Error(msg.error.message ?? 'MCP error'));
      } else {
        p.resolve(msg.result);
      }
    }
    // Notifications from server (no id) are ignored for now
  }
}
