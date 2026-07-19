// ============================================================================
// NetworkSettings Component — Proxy + working directory + allowed dirs
// ============================================================================

import React, { useState } from 'react';

interface NetworkSettingsProps {
  proxyUrl: string;
  proxyEnabled: boolean;
  allowedDirectories: string[];
  onUpdateProxyUrl: (url: string) => void;
  onUpdateProxyEnabled: (enabled: boolean) => void;
  onUpdateAllowedDirectories: (dirs: string[]) => void;
  /** Current agent / fs project root */
  workingDirectory: string;
  recentDirectories?: string[];
  onChangeWorkingDirectory: (path: string) => Promise<{ ok: boolean; error?: string; path?: string }>;
  switchingCwd?: boolean;
}

export function NetworkSettings({
  proxyUrl, proxyEnabled, allowedDirectories,
  onUpdateProxyUrl, onUpdateProxyEnabled, onUpdateAllowedDirectories,
  workingDirectory,
  recentDirectories = [],
  onChangeWorkingDirectory,
  switchingCwd,
}: NetworkSettingsProps) {
  const [cwdInput, setCwdInput] = useState(workingDirectory);
  const [cwdError, setCwdError] = useState('');

  // Keep input in sync when parent hot-switches from elsewhere
  React.useEffect(() => {
    setCwdInput(workingDirectory);
  }, [workingDirectory]);

  const applyCwd = async (path: string) => {
    setCwdError('');
    const r = await onChangeWorkingDirectory(path.trim());
    if (!r.ok) setCwdError(r.error || '切换失败');
  };

  return (
    <div>
      <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px' }}>📂 工作目录</h3>
      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
        Agent 工具的默认项目根（bash / 读写文件 / OPENCHAT.md / 文件树）。
        <strong>可热切换</strong>，无需重启后端。
      </p>
      <div className="form-group">
        <label className="form-label">当前工作目录</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="text"
            className="form-input"
            value={cwdInput}
            onChange={e => setCwdInput(e.target.value)}
            placeholder="D:\path\to\project"
            style={{ flex: 1, minWidth: 200, fontFamily: 'var(--font-mono)', fontSize: 12 }}
            disabled={switchingCwd}
          />
          <button
            type="button"
            className="btn-primary"
            style={{ fontSize: 12, whiteSpace: 'nowrap' }}
            disabled={switchingCwd || !cwdInput.trim()}
            onClick={() => void applyCwd(cwdInput)}
          >
            {switchingCwd ? '切换中…' : '切换到此目录'}
          </button>
        </div>
        {cwdError && (
          <div style={{ fontSize: 12, color: 'var(--color-error, #f85149)', marginTop: 6 }}>
            {cwdError}
          </div>
        )}
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, display: 'block' }}>
          当前生效：<code style={{ fontSize: 11 }}>{workingDirectory || '—'}</code>
        </span>
      </div>
      {recentDirectories.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>最近使用</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {recentDirectories.map(d => (
              <button
                key={d}
                type="button"
                className="btn-ghost"
                style={{
                  textAlign: 'left',
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                  padding: '6px 8px',
                  border: '1px solid var(--border-color)',
                  borderRadius: 6,
                }}
                disabled={switchingCwd || d === workingDirectory}
                onClick={() => {
                  setCwdInput(d);
                  void applyCwd(d);
                }}
                title={d}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      )}

      <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '20px 0' }} />

      <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px' }}>🌐 Network</h3>
      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
        Configure network proxy for API requests. Useful when accessing services that require a proxy.
      </p>

      {/* Proxy Toggle */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', background: 'var(--bg-surface)', borderRadius: '8px',
        marginBottom: '16px',
      }}>
        <div>
          <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>
            Enable Proxy
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
            {proxyEnabled ? 'Proxy is active — requests route through backend server' : 'Direct connection — proxy disabled'}
          </div>
        </div>
        <button
          onClick={() => onUpdateProxyEnabled(!proxyEnabled)}
          style={{
            width: '44px', height: '24px', borderRadius: '12px', border: 'none',
            background: proxyEnabled ? 'var(--color-primary)' : 'var(--bg-surface-elevated)',
            cursor: 'pointer', position: 'relative', transition: 'background 0.2s',
          }}
          title={proxyEnabled ? 'Disable proxy' : 'Enable proxy'}
        >
          <span style={{
            position: 'absolute', top: '3px',
            left: proxyEnabled ? '23px' : '3px',
            width: '18px', height: '18px', borderRadius: '50%',
            background: '#fff', transition: 'left 0.2s',
            boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
          }} />
        </button>
      </div>

      {/* Proxy URL */}
      <div className="form-group" style={{ opacity: proxyEnabled ? 1 : 0.5, pointerEvents: proxyEnabled ? 'auto' : 'none' }}>
        <label className="form-label" htmlFor="proxy-url-input">
          Proxy URL
        </label>
        <input
          type="text"
          className="form-input"
          id="proxy-url-input"
          value={proxyUrl}
          onChange={e => onUpdateProxyUrl(e.target.value)}
          placeholder="http://127.0.0.1:7890"
        />
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px', display: 'block' }}>
          💡 Supports HTTP/HTTPS/SOCKS5 proxies.
        </span>
      </div>

      <div style={{ marginTop: '16px', padding: '12px', background: 'var(--bg-surface)', borderRadius: '8px', fontSize: '12px' }}>
        <div style={{ fontWeight: '600', marginBottom: '8px' }}>Common proxy formats:</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', lineHeight: '1.8' }}>
          <div><code>http://127.0.0.1:7890</code> — Clash / V2Ray</div>
          <div><code>http://127.0.0.1:1080</code> — HTTP proxy</div>
          <div><code>socks5://127.0.0.1:1080</code> — SOCKS5 proxy</div>
        </div>
      </div>

      {/* Allowed Directories */}
      <div style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px solid var(--border-color)' }}>
        <h4 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '8px' }}>📂 Allowed Directories</h4>
        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
          AI tools can access the project directory by default. Add additional directories here (one per line).
        </p>
        <textarea
          className="form-input"
          value={allowedDirectories.join('\n')}
          onChange={e => {
            const dirs = e.target.value.split('\n').map(s => s.trim()).filter(Boolean);
            onUpdateAllowedDirectories(dirs);
          }}
          placeholder={"D:\\DOWNLOAD\nD:\\Projects\n/home/user/code"}
          rows={3}
          style={{ resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: '12px' }}
        />
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
          💡 The project working directory is always allowed. Add paths here to access other locations.
        </span>
      </div>
    </div>
  );
}
