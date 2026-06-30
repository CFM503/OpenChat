// ============================================================================
// Registry Client — Fetch packages from remote registries
// ============================================================================

import { ProxyAgent } from 'undici';

export class RegistryClient {
  private registries: string[];
  private proxyUrl?: string;
  private proxyAgent: ProxyAgent | undefined;

  constructor(registries: string[], proxyUrl?: string) {
    this.registries = registries;
    this.proxyUrl = proxyUrl;
    if (proxyUrl) {
      this.proxyAgent = new ProxyAgent(proxyUrl);
    }
  }

  /**
   * Refresh proxy agent when proxyUrl changes (called from config).
   */
  updateProxyUrl(url?: string) {
    this.proxyUrl = url;
    this.proxyAgent = url ? new ProxyAgent(url) : undefined;
  }

  /**
   * Search all registries for packages matching a query.
   */
  async search(query: string): Promise<RegistryPackage[]> {
    const results: RegistryPackage[] = [];
    const seen = new Set<string>();

    for (const registry of this.registries) {
      try {
        const url = `${registry.replace(/\/+$/, '')}/api/registry/packages?q=${encodeURIComponent(query)}`;
        const resp = await this.fetch(url);
        if (!resp.ok) continue;

        const data: RegistryResponse = await resp.json();
        for (const pkg of data.packages ?? []) {
          if (!seen.has(pkg.name)) {
            seen.add(pkg.name);
            pkg.downloadUrl = pkg.downloadUrl ?? `${registry.replace(/\/+$/, '')}/api/registry/packages/${pkg.name}/download`;
            results.push(pkg);
          }
        }
      } catch {
        // Skip unreachable registries
      }
    }

    return results;
  }

  /**
   * Get details for a specific package.
   */
  async getPackage(name: string): Promise<RegistryPackage | null> {
    for (const registry of this.registries) {
      try {
        const url = `${registry.replace(/\/+$/, '')}/api/registry/packages/${encodeURIComponent(name)}`;
        const resp = await this.fetch(url);
        if (!resp.ok) continue;

        const pkg: RegistryPackage = await resp.json();
        pkg.downloadUrl = pkg.downloadUrl ?? `${registry.replace(/\/+$/, '')}/api/registry/packages/${name}/download`;
        return pkg;
      } catch {
        // Try next registry
      }
    }
    return null;
  }

  /**
   * Download a package tarball. Returns the buffer.
   */
  async download(downloadUrl: string): Promise<Buffer | null> {
    try {
      const resp = await this.fetch(downloadUrl);
      if (!resp.ok) return null;
      const arrayBuffer = await resp.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch {
      return null;
    }
  }

  private fetch(url: string): Promise<Response> {
    const options: RequestInit = {
      signal: AbortSignal.timeout(15000),
    };

    // Use proxy if configured
    if (this.proxyAgent) {
      (options as any).dispatcher = this.proxyAgent;
    }

    return globalThis.fetch(url, options);
  }
}
