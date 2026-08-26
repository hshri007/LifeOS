import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

interface CatalogEntry {
  key: string;
  name: string;
  dataAccessed: string;
  whyNeeded: string;
  scopes: string[];
  risk: string;
}

interface Connection {
  id: string;
  provider: string;
  status: string;
  scopes: string[];
}

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
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [actions, setActions] = useState<AgentAction[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    try {
      const consent = await api.get<{ catalog: CatalogEntry[]; connections: Connection[] }>('/consent');
      setCatalog(consent.catalog);
      setConnections(consent.connections);
      setActions((await api.get<{ actions: AgentAction[] }>('/agent/actions')).actions);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }
  useEffect(() => { load(); }, []);

  async function connect(key: string) {
    await api.post('/consent/connect', { provider: key });
    load();
  }
  async function revoke(provider: string) {
    if (!window.confirm(`Revoke "${provider}"? LifeOS will stop accessing this data source.`)) return;
    await api.post(`/consent/${provider}/revoke`);
    load();
  }

  async function exportData() {
    // FR-014: full export of personal records.
    window.open('/api/account/export', '_blank');
    setNotice('Export downloaded.');
  }

  async function deleteAccount() {
    if (!window.confirm('Delete your account and ALL personal data? This cannot be undone.')) return;
    try {
      await api.post('/account/delete');
      localStorage.clear();
      navigate('/login');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Deletion failed');
    }
  }

  const statusOf = (key: string): Connection | undefined =>
    connections.find((c) => c.provider === key && c.status === 'connected');

  return (
    <>
      <h1 className="page-title">Settings</h1>
      <p className="page-sub">Consent is granular — every integration shows what it accesses and why (§4.6).</p>
      {error && <div className="error-box">{error}</div>}
      {notice && <div className="info-box">{notice}</div>}

      <div className="card section">
        <h3>Consent center — integrations</h3>
        {catalog.map((c) => {
          const conn = statusOf(c.key);
          return (
            <div key={c.key} className="obl-row">
              <div className="obl-main">
                <div className="obl-title">{c.name}</div>
                <div className="muted">Accesses: {c.dataAccessed} · Why: {c.whyNeeded} · Risk: {c.risk}</div>
              </div>
              {conn ? (
                <>
                  <span className="chip ok">connected</span>
                  <button className="btn small danger" onClick={() => revoke(c.key)}>Revoke</button>
                </>
              ) : (
                <button className="btn small" onClick={() => connect(c.key)}>Connect</button>
              )}
            </div>
          );
        })}
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
                <button
                  className="btn small"
                  onClick={async () => { await api.post(`/agent/actions/${a.id}/approve`); load(); }}
                >
                  Approve
                </button>
                <button
                  className="btn small danger"
                  onClick={async () => { await api.post(`/agent/actions/${a.id}/reject`); load(); }}
                >
                  Reject
                </button>
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
          <button className="btn" onClick={exportData}>⬇ Export my data (JSON)</button>
          <button className="btn danger" onClick={deleteAccount}>Delete account & data</button>
        </div>
      </div>
    </>
  );
}