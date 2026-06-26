// ============================================================================
// ExtensionPanel — Skills, MCP, Plugins management + Registry Store
// ============================================================================

import React, { useState, useEffect, useCallback } from 'react';
import type { SkillInfo, MCPServerStatus, PluginInfo, RegistryPackageInfo, InstalledPackageInfo } from '../core/types';
import { backendClient } from '../services/api';

type TabId = 'installed' | 'store';

export function ExtensionPanel() {
  const [activeTab, setActiveTab] = useState<TabId>('installed');
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [mcpServers, setMcpServers] = useState<MCPServerStatus[]>([]);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [installedPkgs, setInstalledPkgs] = useState<InstalledPackageInfo[]>([]);
  const [loading, setLoading] = useState(true);

  // Store state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<RegistryPackageInfo[]>([]);
  const [searching, setSearching] = useState(false);
  const [installing, setInstalling] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const [s, m, p, i] = await Promise.all([
      backendClient.getSkills(),
      backendClient.getMCPServers(),
      backendClient.getPlugins(),
      backendClient.getInstalledPackages(),
    ]);
    setSkills(s);
    setMcpServers(m);
    setPlugins(p);
    setInstalledPkgs(i);
    setLoading(false);
  };

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    const results = await backendClient.searchRegistry(searchQuery);
    setSearchResults(results);
    setSearching(false);
  }, [searchQuery]);

  const handleInstall = async (name: string) => {
    setInstalling(prev => new Set(prev).add(name));
    const result = await backendClient.installPackage(name);
    setInstalling(prev => {
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
    if (result.success) {
      await loadData();
    } else {
      alert(`Install failed: ${result.error}`);
    }
  };

  const handleUninstall = async (name: string) => {
    if (!confirm(`Uninstall "${name}"?`)) return;
    const result = await backendClient.uninstallPackage(name);
    if (result.success) {
      await loadData();
    } else {
      alert(`Uninstall failed: ${result.error}`);
    }
  };

  if (loading) {
    return <div style={{ padding: '20px', color: 'var(--text-secondary)' }}>Loading extensions...</div>;
  }

  const builtinSkills = skills.filter(s => s.builtin);
  const userSkills = skills.filter(s => !s.builtin);

  return (
    <div>
      {/* Tab Bar */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', borderBottom: '1px solid var(--border-color)', paddingBottom: '0' }}>
        {(['installed', 'store'] as TabId[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '8px 16px',
              background: activeTab === tab ? 'var(--bg-surface)' : 'transparent',
              border: 'none',
              borderBottom: activeTab === tab ? '2px solid var(--color-primary)' : '2px solid transparent',
              color: activeTab === tab ? 'var(--text-primary)' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: activeTab === tab ? '600' : '400',
              borderRadius: '6px 6px 0 0',
            }}
          >
            {tab === 'installed' ? '📦 Installed' : '🏪 Store'}
          </button>
        ))}
      </div>

      {/* Installed Tab */}
      {activeTab === 'installed' && (
        <div>
          {/* Installed packages from registry */}
          {installedPkgs.length > 0 && (
            <div className="extension-section">
              <h4>📥 Installed from Registry ({installedPkgs.length})</h4>
              {installedPkgs.map(pkg => (
                <div key={pkg.name} className="extension-card">
                  <div className="extension-card-header">
                    <span className="extension-card-name">
                      {pkg.name} <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>v{pkg.version}</span>
                    </span>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <span className="extension-badge builtin">{pkg.type}</span>
                      <button
                        onClick={() => handleUninstall(pkg.name)}
                        style={{ background: 'none', border: '1px solid var(--color-error)', color: 'var(--color-error)', borderRadius: '4px', padding: '2px 8px', fontSize: '11px', cursor: 'pointer' }}
                      >
                        Uninstall
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Skills */}
          <div className="extension-section">
            <h4>⚡ Skills ({skills.length})</h4>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
              Type <code style={{ background: 'var(--bg-surface)', padding: '1px 4px', borderRadius: '3px' }}>/</code> in chat to trigger shortcuts.
            </p>
            {builtinSkills.map(skill => (
              <div key={skill.name} className="extension-card">
                <div className="extension-card-header">
                  <span className="extension-card-name">{skill.shortcut}</span>
                  <span className="extension-badge builtin">built-in</span>
                </div>
                <div className="extension-card-desc">{skill.description}</div>
              </div>
            ))}
            {userSkills.map(skill => (
              <div key={skill.name} className="extension-card">
                <div className="extension-card-header">
                  <span className="extension-card-name">{skill.shortcut}</span>
                </div>
                <div className="extension-card-desc">{skill.description}</div>
              </div>
            ))}
          </div>

          {/* MCP Servers */}
          <div className="extension-section">
            <h4>🔌 MCP Servers ({mcpServers.length})</h4>
            {mcpServers.length === 0 ? (
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                No MCP servers configured. Add in <code>openchat.json</code> → <code>mcpServers</code>.
              </div>
            ) : (
              mcpServers.map(server => (
                <div key={server.name} className="extension-card">
                  <div className="extension-card-header">
                    <span className="extension-card-name">{server.name}</span>
                    <span className={`extension-badge ${server.running ? 'running' : 'stopped'}`}>
                      {server.running ? 'running' : 'stopped'}
                    </span>
                  </div>
                  <div className="extension-card-desc">
                    {server.tools.length > 0 ? `Tools: ${server.tools.join(', ')}` : 'No tools'}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Plugins */}
          <div className="extension-section">
            <h4>🧩 Plugins ({plugins.length})</h4>
            {plugins.length === 0 ? (
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                No plugins installed. Install from the Store tab, or place in <code>~/.openchat/plugins/</code>.
              </div>
            ) : (
              plugins.map(plugin => (
                <div key={plugin.name} className="extension-card">
                  <div className="extension-card-header">
                    <span className="extension-card-name">
                      {plugin.name} <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>v{plugin.version}</span>
                    </span>
                    <span className={`extension-badge ${plugin.enabled ? 'running' : 'stopped'}`}>
                      {plugin.enabled ? 'enabled' : 'disabled'}
                    </span>
                  </div>
                  <div className="extension-card-desc">{plugin.description}</div>
                  {plugin.tools.length > 0 && (
                    <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>
                      Tools: {plugin.tools.map(t => t.name).join(', ')}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Store Tab */}
      {activeTab === 'store' && (
        <div>
          {/* Search */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search plugins and skills..."
              style={{
                flex: 1,
                padding: '8px 12px',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                color: 'var(--text-primary)',
                fontSize: '13px',
                outline: 'none',
              }}
            />
            <button
              onClick={handleSearch}
              disabled={searching || !searchQuery.trim()}
              style={{
                padding: '8px 16px',
                background: 'var(--color-primary)',
                border: 'none',
                borderRadius: '6px',
                color: 'white',
                fontSize: '13px',
                cursor: searching ? 'wait' : 'pointer',
                opacity: searching ? 0.7 : 1,
              }}
            >
              {searching ? '...' : 'Search'}
            </button>
          </div>

          {/* Search Results */}
          {searchResults.length > 0 ? (
            <div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                {searchResults.length} package(s) found
              </div>
              {searchResults.map(pkg => {
                const isInstalled = installedPkgs.some(i => i.name === pkg.name);
                const isInstalling = installing.has(pkg.name);
                return (
                  <div key={pkg.name} className="extension-card">
                    <div className="extension-card-header">
                      <span className="extension-card-name">
                        {pkg.name}
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '8px' }}>v{pkg.version}</span>
                      </span>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <span className={`extension-badge ${pkg.type === 'plugin' ? 'running' : 'builtin'}`}>
                          {pkg.type}
                        </span>
                        {isInstalled ? (
                          <button
                            onClick={() => handleUninstall(pkg.name)}
                            style={{ background: 'none', border: '1px solid var(--color-error)', color: 'var(--color-error)', borderRadius: '4px', padding: '2px 8px', fontSize: '11px', cursor: 'pointer' }}
                          >
                            Uninstall
                          </button>
                        ) : (
                          <button
                            onClick={() => handleInstall(pkg.name)}
                            disabled={isInstalling}
                            style={{
                              padding: '4px 12px',
                              background: 'var(--color-primary)',
                              border: 'none',
                              borderRadius: '4px',
                              color: 'white',
                              fontSize: '11px',
                              cursor: isInstalling ? 'wait' : 'pointer',
                              opacity: isInstalling ? 0.7 : 1,
                            }}
                          >
                            {isInstalling ? 'Installing...' : 'Install'}
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="extension-card-desc">{pkg.description}</div>
                    {pkg.author && (
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                        by {pkg.author}
                      </div>
                    )}
                    {pkg.tags && pkg.tags.length > 0 && (
                      <div style={{ display: 'flex', gap: '4px', marginTop: '6px', flexWrap: 'wrap' }}>
                        {pkg.tags.map(tag => (
                          <span key={tag} style={{ fontSize: '10px', padding: '1px 6px', background: 'var(--bg-surface)', borderRadius: '3px', color: 'var(--text-muted)' }}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : searchQuery && !searching ? (
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'center', padding: '40px 0' }}>
              No packages found for "{searchQuery}"
            </div>
          ) : !searchQuery ? (
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'center', padding: '40px 0' }}>
              <div style={{ fontSize: '32px', marginBottom: '12px' }}>🏪</div>
              <div>Search for plugins and skills from configured registries.</div>
              <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>
                Configure registries in <code>openchat.json</code> → <code>registries</code>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
