// ============================================================================
// Runtime environment facts for the agent (OS, paths, shell)
// Injected into system prompt so tools use correct paths/commands.
// ============================================================================

import fs from 'fs';
import os from 'os';
import path from 'path';

export interface EnvContext {
  platform: NodeJS.Platform;
  platformLabel: string;
  arch: string;
  shell: string;
  shellHint: string;
  pathSep: string;
  homeDir: string;
  desktopDir: string;
  documentsDir: string;
  downloadsDir: string;
  workingDirectory: string;
  nodeVersion: string;
  /** Extra dirs tools may touch outside the project root */
  defaultAllowedDirs: string[];
}

function firstExisting(candidates: string[]): string {
  for (const c of candidates) {
    if (!c) continue;
    try {
      if (fs.existsSync(c)) return path.normalize(c);
    } catch {
      /* continue */
    }
  }
  return path.normalize(candidates.find(Boolean) || '');
}

export function resolveUserHome(): string {
  return path.normalize(os.homedir() || process.env.USERPROFILE || process.env.HOME || process.cwd());
}

export function resolveUserDesktop(home = resolveUserHome()): string {
  return firstExisting([
    path.join(home, 'Desktop'),
    path.join(home, '桌面'),
    process.env.OneDrive ? path.join(process.env.OneDrive, 'Desktop') : '',
    process.env.OneDrive ? path.join(process.env.OneDrive, '桌面') : '',
  ]) || path.join(home, 'Desktop');
}

export function resolveUserDocuments(home = resolveUserHome()): string {
  return firstExisting([
    path.join(home, 'Documents'),
    path.join(home, '文档'),
    process.env.OneDrive ? path.join(process.env.OneDrive, 'Documents') : '',
    process.env.OneDrive ? path.join(process.env.OneDrive, '文档') : '',
  ]) || path.join(home, 'Documents');
}

export function resolveUserDownloads(home = resolveUserHome()): string {
  return firstExisting([
    path.join(home, 'Downloads'),
    path.join(home, '下载'),
  ]) || path.join(home, 'Downloads');
}

export function detectShell(): { shell: string; shellHint: string } {
  if (process.platform === 'win32') {
    // BashTool runs via cmd.exe /c
    return {
      shell: 'cmd.exe',
      shellHint:
        'Commands run under Windows cmd.exe. Use Windows paths (backslashes or quoted). ' +
        'Examples: mkdir "%USERPROFILE%\\Desktop\\MyFolder" · dir · type file.txt · ' +
        'Do NOT use Unix-only paths like ~/Desktop or mkdir -p unless inside Git Bash.',
    };
  }
  if (process.platform === 'darwin') {
    return {
      shell: '/bin/zsh or /bin/sh',
      shellHint: 'Unix shell. Paths use /. Desktop is typically ~/Desktop.',
    };
  }
  return {
    shell: '/bin/sh',
    shellHint: 'Unix shell. Paths use /. Prefer absolute paths when leaving the project root.',
  };
}

export function buildEnvContext(workingDirectory: string): EnvContext {
  const home = resolveUserHome();
  const desktopDir = resolveUserDesktop(home);
  const documentsDir = resolveUserDocuments(home);
  const downloadsDir = resolveUserDownloads(home);
  const { shell, shellHint } = detectShell();

  const defaultAllowedDirs = [desktopDir, documentsDir, downloadsDir, home].filter(
    (d, i, arr) => d && arr.indexOf(d) === i && fs.existsSync(d),
  );

  const platformLabel =
    process.platform === 'win32'
      ? 'Windows'
      : process.platform === 'darwin'
        ? 'macOS'
        : process.platform === 'linux'
          ? 'Linux'
          : process.platform;

  return {
    platform: process.platform,
    platformLabel,
    arch: os.arch(),
    shell,
    shellHint,
    pathSep: path.sep,
    homeDir: home,
    desktopDir,
    documentsDir,
    downloadsDir,
    workingDirectory: path.normalize(workingDirectory),
    nodeVersion: process.version,
    defaultAllowedDirs,
  };
}

/** Markdown block for the agent system prompt */
export function formatEnvContextForPrompt(env: EnvContext): string {
  const mkdirExample =
    env.platform === 'win32'
      ? `mkdir "${env.desktopDir}${env.pathSep}MyFolder"`
      : `mkdir -p "${env.desktopDir}/MyFolder"`;

  return [
    '# Runtime environment (authoritative — use these paths)',
    `- OS: ${env.platformLabel} (${env.platform}/${env.arch})`,
    `- Shell for bash tool: ${env.shell}`,
    `- ${env.shellHint}`,
    `- Path separator: "${env.pathSep}"`,
    `- Project / tool working directory (default cwd): ${env.workingDirectory}`,
    `- User home: ${env.homeDir}`,
    `- Desktop: ${env.desktopDir}`,
    `- Documents: ${env.documentsDir}`,
    `- Downloads: ${env.downloadsDir}`,
    `- Node: ${env.nodeVersion}`,
    '',
    'Path rules:',
    '- Prefer absolute paths from this block when the user mentions Desktop/Documents/Downloads/home.',
    '- Relative paths resolve against the project working directory above — NOT the Desktop unless the user is working in the repo.',
    `- Example create folder on Desktop: \`${mkdirExample}\``,
    '- file_*/bash may access the project root and user Desktop/Documents/Downloads (and any configured allowedDirectories).',
    '- Do not invent Unix home paths on Windows or Windows drive letters on Unix.',
  ].join('\n');
}
