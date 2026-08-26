import { useEffect, useState } from 'react';
import { api, toast, type DashboardData } from '../api';

interface AssetRow { id: string; type: string; name: string; metadata: Record<string, unknown> }

export default function Assets() {
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  async function load() {
    try {
      const d = await api.get<DashboardData>('/dashboard');
      setAssets(d.assets);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }
  useEffect(() => { load(); }, []);

  async function remove(id: string) {
    if (!window.confirm('Delete this asset? Its linked reminders stay, but lose the asset link.')) return;
    await api.del(`/assets/${id}`);
    toast('Asset deleted');
    load();
  }

  async function saveEdit(id: string) {
    await api.patch(`/assets/${id}`, { name: editName });
    toast('Asset updated');
    setEditing(null);
    load();
  }

  if (error) return <div className="error-box">{error}</div>;

  return (
    <>
      <h1 className="page-title">Assets</h1>
      <p className="page-sub">Vehicles, electronics and appliances — each with its own timeline of obligations. Edit or remove them anytime.</p>
      <div className="grid cols-2">
        {assets.map((a) => (
          <div key={a.id} className="card">
            {editing === a.id ? (
              <>
                <label>Name</label>
                <input value={editName} onChange={(e) => setEditName(e.target.value)} />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button className="btn primary" onClick={() => saveEdit(a.id)}>Save</button>
                  <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ margin: 0 }}>{a.type}</h3>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn small" onClick={() => { setEditing(a.id); setEditName(a.name); }}>✎ Edit</button>
                    <button className="btn small danger" onClick={() => remove(a.id)}>🗑 Delete</button>
                  </div>
                </div>
                <div style={{ fontWeight: 700, fontSize: 16, marginTop: 4 }}>{a.name}</div>
                {Object.entries(a.metadata)
                  .filter(([, v]) => v !== null && v !== undefined && v !== '')
                  .map(([k, v]) => (
                    <div key={k} className="muted" style={{ marginTop: 4 }}>
                      {k.replace(/_/g, ' ')}: <code className="mono">{String(v)}</code>
                    </div>
                  ))}
              </>
            )}
          </div>
        ))}
        {assets.length === 0 && (
          <div className="card"><div className="empty">No assets yet — add a record or confirm a document to create one.</div></div>
        )}
      </div>
    </>
  );
}
