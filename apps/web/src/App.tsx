import { useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import { api, getToken, clearToken } from './api';
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

const NAV = [
  { to: '/', label: 'Dashboard', icon: '◎' },
  { to: '/documents', label: 'Documents', icon: '▤' },
  { to: '/obligations', label: 'Obligations', icon: '✓' },
  { to: '/subscriptions', label: 'Subscriptions', icon: '↻' },
  { to: '/assets', label: 'Assets', icon: '▣' },
  { to: '/assistant', label: 'Assistant', icon: '✦' },
  { to: '/audit', label: 'Audit log', icon: '☰' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

function Shell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');

  useEffect(() => {
    api.get<{ user?: { email?: string } }>('/notifications').catch(() => undefined);
    // Best-effort email display from the token payload-less API:
    setEmail(localStorage.getItem('lifeos_email') ?? '');
  }, []);

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
          <div className="user-email">{email || 'Signed in'}</div>
          <button
            className="btn small"
            style={{ width: '100%' }}
            onClick={() => {
              clearToken();
              localStorage.removeItem('lifeos_email');
              navigate('/login');
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">{children}</main>
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
      <Route path="/assistant" element={<RequireAuth><Assistant /></RequireAuth>} />
      <Route path="/audit" element={<RequireAuth><Audit /></RequireAuth>} />
      <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}