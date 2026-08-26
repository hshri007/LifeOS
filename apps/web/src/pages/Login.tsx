import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setToken } from '../api';

export default function Login() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const path = mode === 'login' ? '/auth/login' : '/auth/register';
      const res = await api.post<{ token: string; user: { email: string } }>(path, { email, password });
      setToken(res.token);
      localStorage.setItem('lifeos_email', res.user.email);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <h1>LifeOS</h1>
        <p className="sub">
          Never miss a return, warranty or renewal. Your documents become reminders.
        </p>
        <label>Email</label>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        <label>Password</label>
        <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === 'register' ? 'At least 8 characters' : 'Your password'} />
        {error && <div className="error-box">{error}</div>}
        <button className="btn primary" style={{ width: '100%', marginTop: 16 }} disabled={busy}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
        <p className="muted" style={{ textAlign: 'center', marginTop: 14 }}>
          {mode === 'login' ? (
            <>New here?{' '}<a href="#" onClick={(e) => { e.preventDefault(); setMode('register'); }}>Create an account</a></>
          ) : (
            <>Already have an account?{' '}<a href="#" onClick={(e) => { e.preventDefault(); setMode('login'); }}>Sign in</a></>
          )}
        </p>
      </form>
    </div>
  );
}