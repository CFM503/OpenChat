// ============================================================================
// Registry System — Types
// ============================================================================

export interface RegistryPackage {
  name: string;
  type: 'plugin' | 'skill';
  version: string;
  description: string;
  author?: string;
  downloads?: number;
  tags?: string[];
  shortcut?: string;       // for skills
  downloadUrl?: string;    // URL to download the tarball
  repository?: string;     // source repo URL
}

export interface RegistryResponse {
  packages: RegistryPackage[];
  total?: number;
  page?: number;
}

export interface InstalledPackage {
  name: string;
  type: 'plugin' | 'skill';
  version: string;
  source?: string;          // registry URL it was installed from
  installedAt: string;      // ISO timestamp
}

export interface InstallResult {
  success: boolean;
  name: string;
  version?: string;
  error?: string;
}
