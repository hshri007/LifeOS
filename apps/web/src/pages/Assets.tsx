import { useEffect, useState } from 'react';
import { api, type DashboardData } from '../api';

export default function Assets() {
  const [assets, setAssets] = useState<DashboardData['assets']>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<DashboardData>('/dashboard')
      .then((d) => setAssets(d.assets))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, []);

  if (error) return <div className="error-box">{error}</div>;

  return (
    <>
      <h1 className="page-title">Assets</h1>
      <p className="page-sub">Vehicles, electronics and appliances — each with its own timeline of obligations.</p>
      <div className="grid cols-2">
        {assets.map((a) => (
          <div key={a.id} className="card">
            <h3>{a.type}</h3>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{a.name}</div>
            {Object.entries(a.metadata)
              .filter(([, v]) => v !== null && v !== undefined && v !== '')
              .map(([k, v]) => (
                <div key={k} className="muted" style={{ marginTop: 4 }}>
                  {k.replace(/_/g, ' ')}: <code className="mono">{String(v)}</code>
                </div>
              ))}
          </div>
        ))}
        {assets.length === 0 && (
          <div className="card"><div className="empty">No assets yet — confirm a purchase invoice or vehicle document to create one.</div></div>
        )}
      </div>
    </>
  );
}