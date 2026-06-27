// ============================================================================
// NetworkSettings Component — Proxy configuration with toggle
// ============================================================================

import React from 'react';

interface NetworkSettingsProps {
  proxyUrl: string;
  proxyEnabled: boolean;
  onUpdateProxyUrl: (url: string) => void;
  onUpdateProxyEnabled: (enabled: boolean) => void;
}

export function NetworkSettings({ proxyUrl, proxyEnabled, onUpdateProxyUrl, onUpdateProxyEnabled }: NetworkSettingsProps) {
  return (
    <div>
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
    </div>
  );
}
