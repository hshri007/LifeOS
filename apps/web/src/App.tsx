import { useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import { api, getToken, clearToken, type NotificationRow, type MeUser } from './api';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Documents from './pages/Documents';
import DocumentReview from './pages/DocumentReview';
import Obligations from './pages/Obligations';
import Subscriptions from './pages/Subscriptions';
import Assets from './pages/Assets';
import Assistant from './pages/Assistant';
import Audit from './pages/Audit';
import Settings from './pages/Settings';
import ManualRecord from './pages/ManualRecord';

const NAV = [
  { to: '/', label: 'Dashboard', icon: '◎' },
  { to: '/documents', label: 'Documents', icon: '▤' },
  { to: '/obligations', label: 'Obligations', icon: '✓' },
  { to: '/subscriptions', label: 'Subscriptions', icon: '↻' },
  { to: '/assets', label: 'Assets', icon: '▣' },
  { to: '/records', label: 'Add record', icon: '＋' },
  { to: '/assistant', label: 'Assistant', icon: '✦' },
  { to: '/audit', label: 'Audit log', icon: '☰' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

function Shell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [verified, setVerified] = useState<boolean | null>(null);
  const [notifs, setNotifs] = useState<NotificationRow[]>([]);
  const [bellOpen, setBellOpen] = useState(false);
  const [toasts, setToasts] = useState<Array<{ id: number; message: string; kind: 'ok' | 'err' }>>([]);

  useEffect(() => {
    api.get<{ user: MeUser }>('/auth/me')
      .then((r) => {
        setEmail(r.user.email);
        setVerified(!!r.user.email_verified);
        localStorage.setItem('lifeos_email', r.user.email);
      })
      .catch(() => undefined);
  }, []);

  // Notifications: poll (server auto-runs the reminder tick).
  useEffect(() => {
    let alive = true;
    const load = () =>
      api.get<{ notifications: NotificationRow[] }>('/notifications')
        .then((r) => { if (alive) setNotifs(r.notifications.filter((n) => !n.read_at)); })
        .catch(() => undefined);
    load();
    const t = setInterval(load, 30000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // Toast bus.
  useEffect(() => {
    const onToast = (e: Event) => {
      const d = (e as CustomEvent).detail as { message: string; kind: 'ok' | 'err' };
      const id = Date.now();
      setToasts((s) => [...s, { id, message: d.message, kind: d.kind }]);
      setTimeout(() => setToasts((s) => s.filter((x) => x.id !== id)), 3600);
    };
    window.addEventListener('lifeos-toast', onToast);
    return () => window.removeEventListener('lifeos-toast', onToast);
  }, []);

  async function markAllRead() {
    try {
      await api.post('/notifications/read', { ids: notifs.map((n) => n.id) });
      setNotifs([]);
    } catch { /* ignore */ }
  }

  const unread = notifs.length;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo">
          <div className="logo-mark">L</div>
          <div className="logo-name">LifeOS</div>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'}>
              <span className="icon">{n.icon}</span> {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-email">{email || 'Signed in'}{verified === false ? ' · ⚑' : ''}</div>
          <button className="btn small" style={{ width: '100%' }}
            onClick={() => { clearToken(); localStorage.removeItem('lifeos_email'); navigate('/login'); }}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        <div className="topbar">
          <div className="bell-wrap">
            <button className={`bell ${unread > 0 ? 'has-unread' : ''}`} onClick={() => setBellOpen((s) => !s)} aria-label="Notifications">
              🔔{unread > 0 && <span className="bell-badge">{unread > 9 ? '9+' : unread}</span>}
            </button>
            {bellOpen && (
              <div className="bell-menu">
                <div className="bell-head">
                  <strong>Reminders</strong>
                  {unread > 0 && <button className="link-btn" onClick={markAllRead}>Mark all read</button>}
                </div>
                {notifs.length === 0 && <div className="bell-empty">Nothing due right now.</div>}
                {notifs.map((n) => (
                  <div key={n.id} className="bell-item">
                    <div className="bell-title">{n.title}</div>
                    <div className="bell-body">{n.body}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        {children}
      </main>
      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.message}</div>
        ))}
      </div>
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  return <Shell>{children}</Shell>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<RequireAuth><Dashboard /></RequireAuth>} />
      <Route path="/documents" element={<RequireAuth><Documents /></RequireAuth>} />
      <Route path="/documents/:id" element={<RequireAuth><DocumentReview /></RequireAuth>} />
      <Route path="/obligations" element={<RequireAuth><Obligations /></RequireAuth>} />
      <Route path="/subscriptions" element={<RequireAuth><Subscriptions /></RequireAuth>} />
      <Route path="/assets" element={<RequireAuth><Assets /></RequireAuth>} />
      <Route path="/records" element={<RequireAuth><ManualRecord /></RequireAuth>} />
      <Route path="/assistant" element={<RequireAuth><Assistant /></RequireAuth>} />
      <Route path="/audit" element={<RequireAuth><Audit /></RequireAuth>} />
      <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}