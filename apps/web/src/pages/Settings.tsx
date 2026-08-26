import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, downloadFile, toast, type ConsentData } from '../api';

interface AgentAction {
  id: string;
  tool: string;
  level: number;
  approval: string;
  status: string;
  created_at: string;
}

export default function Settings() {
  const navigate = useNavigate();
  const [consent, setConsent] = useState<ConsentData | null>(null);
  const [actions, setActions] = useState<AgentAction[]>([]);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    try {
      setConsent(await api.get<ConsentData>('/consent'));
      setActions((await api.get<{ actions: AgentAction[] }>('/agent/actions')).actions);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }
  useEffect(() => { load(); }, []);

  async function connect(key: string) {
    try {
      await api.post('/consent/connect', { provider: key });
      toast('Connected');
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Connect failed', 'err');
    }
  }
  async function revoke(provider: string) {
    if (!window.confirm(`Revoke "${provider}"? LifeOS will stop accessing this data source.`)) return;
    await api.post(`/consent/${provider}/revoke`);
    toast('Revoked');
    load();
  }

  async function exportData() {
    setExporting(true);
    try {
      // FR-014: authenticated export (previously broke because window.open drops the auth header).
      await downloadFile('/account/export', 'lifeos-export.json');
      toast('Export downloaded');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Export failed', 'err');
    } finally {
      setExporting(false);
    }
  }

  async function deleteAccount() {
    if (!window.confirm('Delete your account and ALL personal data? This cannot be undone.')) return;
    setDeleting(true);
    try {
      await api.post('/account/delete');
      localStorage.clear();
      navigate('/login');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Deletion failed');
      setDeleting(false);
    }
  }

  const statusOf = (key: string) => consent?.connections.find((c) => c.provider === key && c.status === 'connected');

  return (
    <>
      <h1 className="page-title">Settings</h1>
      <p className="page-sub">Consent is granular — every integration shows what it accesses and why (§4.6).</p>
      {error && <div className="error-box">{error}</div>}

      <div className="card section">
        <h3>Consent center — integrations</h3>
        {!consent ? <div className="empty">Loading…</div> : consent.catalog.map((c) => {
          const conn = statusOf(c.key);
          return (
            <div key={c.key} className="obl-row">
              <div className="obl-main">
                <div className="obl-title">{c.name}</div>
                <div className="muted">Accesses: {c.dataAccessed} · Why: {c.whyNeeded} · Risk: {c.risk}</div>
                {c.oauth && !consent.oauthConfigured && (
                  <div className="muted oauth-note">🔒 Requires Google OAuth setup — not yet configured, so this stays off.</div>
                )}
              </div>
              {conn ? (
                <>
                  <span className="chip ok">connected</span>
                  <button className="btn small danger" onClick={() => revoke(c.key)}>Revoke</button>
                </>
              ) : (
                <button className="btn small" onClick={() => connect(c.key)} disabled={c.oauth && !consent.oauthConfigured}>
                  Connect
                </button>
              )}
            </div>
          );
        })}
        <p className="muted" style={{ marginTop: 10 }}>
          If you authenticated with Gmail it only happened through Google's real OAuth screen — the app never silently "connects" on its own.
        </p>
      </div>

      <div className="card section">
        <h3>Agent actions & approvals</h3>
        <p className="muted" style={{ marginTop: -6 }}>
          Level 0–1 actions are informational or user-confirmed. Level 2+ drafts require explicit approval and are never sent automatically.
        </p>
        {actions.length === 0 && <div className="empty">No agent actions yet.</div>}
        {actions.map((a) => (
          <div key={a.id} className="obl-row">
            <div className="obl-main">
              <div className="obl-title"><code className="mono">{a.tool}</code></div>
              <div className="muted">{new Date(a.created_at).toLocaleString()}</div>
            </div>
            <span className="chip cat">level {a.level}</span>
            <span className={`chip ${a.approval === 'pending' ? 'high' : a.approval === 'approved' ? 'ok' : ''}`}>{a.approval}</span>
            {a.approval === 'pending' && (
              <>
                <button className="btn small" onClick={async () => { await api.post(`/agent/actions/${a.id}/approve`); load(); }}>Approve</button>
                <button className="btn small danger" onClick={async () => { await api.post(`/agent/actions/${a.id}/reject`); load(); }}>Reject</button>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="card section">
        <h3>Your data</h3>
        <p className="muted" style={{ marginTop: -6 }}>
          Purpose-based collection with configurable retention. Export everything, or delete it all.
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn" onClick={exportData} disabled={exporting}>
            {exporting ? 'Preparing…' : '⬇ Export my data (JSON)'}
          </button>
          <button className="btn danger" onClick={deleteAccount} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete account & data'}
          </button>
        </div>
      </div>
    </>
  );
}
