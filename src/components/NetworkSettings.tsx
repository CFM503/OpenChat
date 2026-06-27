// ============================================================================
// NetworkSettings Component — Proxy configuration
// ============================================================================

import React from 'react';

interface NetworkSettingsProps {
  proxyUrl: string;
  onUpdateProxyUrl: (url: string) => void;
}

export function NetworkSettings({ proxyUrl, onUpdateProxyUrl }: NetworkSettingsProps) {
  return (
    <div>
      <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px' }}>🌐 Network</h3>
      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
        Configure network proxy for API requests. Useful when accessing services that require a proxy.
      </p>

      <div className="form-group">
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
          💡 Supports HTTP/HTTPS/SOCKS5 proxies. Leave empty for direct connection.
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
