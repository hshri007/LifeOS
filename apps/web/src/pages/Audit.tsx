import { useEffect, useState } from 'react';
import { api } from '../api';

interface AuditRow {
  id: string;
  event_type: string;
  resource_type: string | null;
  resource_id: string | null;
  metadata: Record<string, unknown> | null;
  timestamp: string;
}

export default function Audit() {
  const [events, setEvents] = useState<AuditRow[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<{ events: AuditRow[] }>('/audit')
      .then((r) => setEvents(r.events))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, []);

  if (error) return <div className="error-box">{error}</div>;

  return (
    <>
      <h1 className="page-title">Audit log</h1>
      <p className="page-sub">Security and agent actions are traceable to your session (FR-013). You can always see what LifeOS did and why.</p>
      <div className="card">
        <table className="data">
          <thead>
            <tr><th>When</th><th>Event</th><th>Resource</th><th>Details</th></tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{new Date(e.timestamp).toLocaleString()}</td>
                <td><code className="mono">{e.event_type}</code></td>
                <td className="muted">{e.resource_type ?? '—'}</td>
                <td className="muted">{e.metadata ? JSON.stringify(e.metadata).slice(0, 120) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {events.length === 0 && <div className="empty">No audit events yet.</div>}
      </div>
    </>
  );
}