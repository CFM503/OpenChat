// ============================================================================
// Registry Installer — Download and install packages
// ============================================================================

import * as fs from 'fs/promises';
import * as path from 'path';
import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { createGunzip } from 'zlib';
import { Extract } from 'tar';
import type { RegistryClient } from './client.js';
import type { InstallResult, InstalledPackage, RegistryPackage } from './types.js';
import type { SkillManager } from '../skills/loader.js';
import type { PluginManager } from '../plugins/loader.js';

const INSTALLED_FILE = 'installed.json';

export class RegistryInstaller {
  private client: RegistryClient;
  private skillsDir: string;
  private pluginsDir: string;
  private installedPath: string;
  private skillManager: SkillManager;
  private pluginManager: PluginManager;

  constructor(
    client: RegistryClient,
    skillsDir: string,
    pluginsDir: string,
    skillManager: SkillManager,
    pluginManager: PluginManager,
  ) {
    this.client = client;
    this.skillsDir = skillsDir;
    this.pluginsDir = pluginsDir;
    this.installedPath = path.join(path.dirname(skillsDir), INSTALLED_FILE);
    this.skillManager = skillManager;
    this.pluginManager = pluginManager;
  }

  /**
   * Install a package by name.
   */
  async install(pkgName: string): Promise<InstallResult> {
    // Find the package in registries
    const pkg = await this.client.getPackage(pkgName);
    if (!pkg || !pkg.downloadUrl) {
      return { success: false, name: pkgName, error: 'Package not found in any registry' };
    }

    // Download tarball
    const tarball = await this.client.download(pkg.downloadUrl);
    if (!tarball) {
      return { success: false, name: pkgName, error: 'Failed to download package' };
    }

    // Determine target directory
    const targetDir = pkg.type === 'skill'
      ? path.join(this.skillsDir, pkgName)
      : path.join(this.pluginsDir, pkgName);

    try {
      // Extract tarball to temp directory first
      const tempDir = path.join(path.dirname(targetDir), `.tmp-${pkgName}-${Date.now()}`);
      await fs.mkdir(tempDir, { recursive: true });

      const tarballPath = path.join(tempDir, 'package.tar.gz');
      await fs.writeFile(tarballPath, tarball);

      await pipeline(
        createReadStream(tarballPath),
        createGunzip(),
        Extract({ cwd: tempDir, strip: 1 }),
      );

      // Clean up tarball
      await fs.unlink(tarballPath).catch(() => {});

      // Verify the package has required files
      if (pkg.type === 'plugin') {
        const manifestPath = path.join(tempDir, 'manifest.json');
        try {
          await fs.access(manifestPath);
        } catch {
          await fs.rm(tempDir, { recursive: true, force: true });
          return { success: false, name: pkgName, error: 'Invalid plugin: missing manifest.json' };
        }
      } else {
        // Skill: look for .md files
        const entries = await fs.readdir(tempDir);
        const mdFiles = entries.filter(e => e.endsWith('.md'));
        if (mdFiles.length === 0) {
          await fs.rm(tempDir, { recursive: true, force: true });
          return { success: false, name: pkgName, error: 'Invalid skill: no .md files found' };
        }
      }

      // Move from temp to final location (replace if exists)
      try {
        await fs.rm(targetDir, { recursive: true, force: true });
      } catch { /* ignore */ }
      await fs.rename(tempDir, targetDir);

      // Reload the skill/plugin
      if (pkg.type === 'skill') {
        await this.skillManager.load();
      } else {
        await this.pluginManager.loadPlugin(targetDir);
      }

      // Record installation
      await this.recordInstall({
        name: pkgName,
        type: pkg.type,
        version: pkg.version,
        source: pkg.downloadUrl,
        installedAt: new Date().toISOString(),
      });

      return { success: true, name: pkgName, version: pkg.version };
    } catch (err: any) {
      return { success: false, name: pkgName, error: err.message };
    }
  }

  /**
   * Uninstall a package.
   */
  async uninstall(pkgName: string): Promise<InstallResult> {
    const installed = await this.getInstalled();
    const pkg = installed.find(p => p.name === pkgName);
    if (!pkg) {
      return { success: false, name: pkgName, error: 'Package not installed' };
    }

    try {
      const targetDir = pkg.type === 'skill'
        ? path.join(this.skillsDir, pkgName)
        : path.join(this.pluginsDir, pkgName);

      // Unload if plugin
      if (pkg.type === 'plugin') {
        this.pluginManager.unload(pkgName);
      }

      // Remove directory
      await fs.rm(targetDir, { recursive: true, force: true });

      // For skills, also check for single .md file
      if (pkg.type === 'skill') {
        const mdPath = path.join(this.skillsDir, `${pkgName}.md`);
        await fs.unlink(mdPath).catch(() => {});
      }

      // Remove from installed list
      const updated = installed.filter(p => p.name !== pkgName);
      await this.saveInstalled(updated);

      return { success: true, name: pkgName };
    } catch (err: any) {
      return { success: false, name: pkgName, error: err.message };
    }
  }

  /**
   * Check for updates on all installed packages.
   */
  async checkUpdates(): Promise<Array<{ name: string; current: string; latest: string }>> {
    const installed = await this.getInstalled();
    const updates: Array<{ name: string; current: string; latest: string }> = [];

    for (const pkg of installed) {
      const remote = await this.client.getPackage(pkg.name);
      if (remote && remote.version !== pkg.version) {
        updates.push({
          name: pkg.name,
          current: pkg.version,
          latest: remote.version,
        });
      }
    }

    return updates;
  }

  /**
   * Update a package to the latest version.
   */
  async update(pkgName: string): Promise<InstallResult> {
    return this.install(pkgName);
  }

  /**
   * Get list of installed packages.
   */
  async getInstalled(): Promise<InstalledPackage[]> {
    try {
      const data = await fs.readFile(this.installedPath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  /**
   * Record a package installation.
   */
  private async recordInstall(pkg: InstalledPackage): Promise<void> {
    const installed = await this.getInstalled();
    const existing = installed.findIndex(p => p.name === pkg.name);
    if (existing >= 0) {
      installed[existing] = pkg;
    } else {
      installed.push(pkg);
    }
    await this.saveInstalled(installed);
  }

  private async saveInstalled(installed: InstalledPackage[]): Promise<void> {
    await fs.writeFile(this.installedPath, JSON.stringify(installed, null, 2), 'utf-8');
  }
}
