import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setToken } from '../api';

/** Sign-in / sign-up with email OTP verification. Demo accounts skip OTP. */

type Mode = 'login' | 'register';

function passwordScore(pw: string): number {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 5);
}

const STRENGTH = [
  { label: '', color: 'transparent' },
  { label: 'Too weak', color: '#ef4444' },
  { label: 'Weak', color: '#f97316' },
  { label: 'Fair', color: '#eab308' },
  { label: 'Strong', color: '#22c55e' },
  { label: 'Excellent', color: '#10b981' },
];

const FLOATERS = [
  { icon: '▤', top: '12%', left: '8%', delay: '0s', dur: '9s', size: 26 },
  { icon: '✓', top: '70%', left: '14%', delay: '1.2s', dur: '11s', size: 22 },
  { icon: '↻', top: '24%', left: '78%', delay: '0.6s', dur: '10s', size: 24 },
  { icon: '▣', top: '80%', left: '70%', delay: '2s', dur: '12s', size: 28 },
  { icon: '✦', top: '45%', left: '88%', delay: '1.6s', dur: '8s', size: 20 },
  { icon: '◎', top: '58%', left: '4%', delay: '2.6s', dur: '13s', size: 22 },
];

interface AuthResponse {
  token: string;
  user: { email: string };
  needsVerification?: boolean;
  devCode?: string;
}

export default function Login() {
  const navigate = useNavigate();
  const [step, setStep] = useState<'creds' | 'otp'>('creds');
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'form' | 'demo' | 'otp' | 'resend' | null>(null);
  const [touched, setTouched] = useState({ email: false, password: false });
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const emailRef = useRef<HTMLInputElement>(null);
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);

  const demoSession = useMemo(() => {
    let s = sessionStorage.getItem('lifeos_demo_session');
    if (!s) {
      s = Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem('lifeos_demo_session', s);
    }
    return s;
  }, []);

  useEffect(() => { emailRef.current?.focus(); }, [mode]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setInterval(() => setResendIn((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const pwValid = mode === 'login' ? password.length >= 1 : password.length >= 8;
  const score = passwordScore(password);
  const strength = STRENGTH[score];

  function netError(err: unknown): string {
    if (err instanceof TypeError && err.message === 'Failed to fetch') {
      return "Can't reach the LifeOS server. Make sure it's running (npm run dev).";
    }
    return err instanceof Error ? err.message : 'Something went wrong';
  }

  function switchMode(m: Mode) {
    setMode(m);
    setError('');
    setTouched({ email: false, password: false });
  }

  function finishAuth(res: AuthResponse) {
    setToken(res.token);
    localStorage.setItem('lifeos_email', res.user.email);
    if (res.needsVerification) {
      setDevCode(res.devCode ?? null);
      setResendIn(30);
      setOtp(['', '', '', '', '', '']);
      setStep('otp');
      setTimeout(() => otpRefs.current[0]?.focus(), 60);
      return;
    }
    navigate('/');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched({ email: true, password: true });
    setError('');
    if (!emailValid || !pwValid) return;
    setBusy('form');
    try {
      const path = mode === 'login' ? '/auth/login' : '/auth/register';
      finishAuth(await api.post<AuthResponse>(path, { email, password }));
    } catch (err) {
      setError(netError(err));
    } finally {
      setBusy(null);
    }
  }

  async function tryDemo() {
    setError('');
    setBusy('demo');
    try {
      finishAuth(await api.post<AuthResponse>('/auth/demo', { session: demoSession }));
    } catch (err) {
      setError(netError(err));
    } finally {
      setBusy(null);
    }
  }

  function setOtpDigit(i: number, v: string) {
    const d = v.replace(/\D/g, '').slice(-1);
    const next = [...otp];
    next[i] = d;
    setOtp(next);
    if (d && i < 5) otpRefs.current[i + 1]?.focus();
  }

  async function verifyOtp(e?: React.FormEvent) {
    e?.preventDefault();
    const full = otp.join('');
    if (full.length !== 6) { setError('Enter all 6 digits.'); return; }
    setBusy('otp');
    setError('');
    try {
      await api.post('/auth/verify-otp', { code: full });
      navigate('/');
    } catch (err) {
      setError(netError(err));
    } finally {
      setBusy(null);
    }
  }

  async function resend() {
    setBusy('resend');
    setError('');
    try {
      const r = await api.post<{ sent: boolean; devCode?: string }>('/auth/resend-otp');
      setDevCode(r.devCode ?? null);
      setResendIn(30);
    } catch (err) {
      setError(netError(err));
    } finally {
      setBusy(null);
    }
  }

  const emailError = touched.email && !emailValid;
  const pwError = touched.password && !pwValid;
//__JSX__
  return (
    <div className="auth-page">
      <div className="aurora" aria-hidden="true">
        <span className="blob b1" /><span className="blob b2" /><span className="blob b3" />
        <div className="grid-overlay" />
      </div>

      <div className="auth-split">
        <section className="brand-panel" aria-hidden="true">
          {FLOATERS.map((f, i) => (
            <span key={i} className="floater" style={{ top: f.top, left: f.left, animationDelay: f.delay, animationDuration: f.dur, fontSize: f.size }}>{f.icon}</span>
          ))}
          <div className="brand-inner">
            <div className="brand-logo">
              <span className="logo-mark-lg">L</span>
              <span className="brand-name">LifeOS</span>
            </div>
            <h1 className="brand-headline">Your life admin,<br /><span className="grad-text">finally handled.</span></h1>
            <p className="brand-sub">Upload a document — or just type the details. LifeOS extracts the dates that matter and turns them into reminders before you miss a return, warranty or renewal.</p>
            <ul className="brand-points">
              <li><span className="pt-icon">⚡</span> Document → reminder in seconds</li>
              <li><span className="pt-icon">🔒</span> OTP-verified, privacy-first accounts</li>
              <li><span className="pt-icon">✦</span> Grounded AI answers with sources</li>
            </ul>
            <div className="brand-stat">
              <div className="stat-num">3 min</div>
              <div className="stat-label">from signup to your first smart reminder</div>
            </div>
          </div>
        </section>

        <section className="auth-panel">
          {step === 'creds' ? (
            <form className="glass-card" onSubmit={submit} noValidate>
              <div className="mode-tabs" role="tablist">
                <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')}>Sign in</button>
                <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => switchMode('register')}>Create account</button>
                <span className={`tab-thumb ${mode === 'register' ? 'right' : ''}`} aria-hidden="true" />
              </div>

              <h2 className="card-title">{mode === 'login' ? 'Welcome back' : 'Get started free'}</h2>
              <p className="card-sub">{mode === 'login' ? 'Sign in to see what needs your attention today.' : 'One account for every deadline, warranty and renewal.'}</p>

              <label className={`field ${emailError ? 'invalid' : ''}`}>
                <span className="field-label">Email</span>
                <input ref={emailRef} type="email" autoComplete="email" placeholder="you@example.com" value={email}
                  onChange={(e) => setEmail(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, email: true }))} />
                {emailError && <span className="field-err">Enter a valid email address</span>}
              </label>

              <label className={`field ${pwError ? 'invalid' : ''}`}>
                <span className="field-label">Password</span>
                <span className="pw-wrap">
                  <input type={showPw ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    placeholder={mode === 'register' ? 'At least 8 characters' : 'Your password'} value={password}
                    onChange={(e) => setPassword(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, password: true }))} />
                  <button type="button" className="pw-toggle" onClick={() => setShowPw((s) => !s)} aria-label={showPw ? 'Hide password' : 'Show password'}>
                    {showPw ? '🙈' : '👁'}
                  </button>
                </span>
                {mode === 'register' && password.length > 0 && (
                  <span className="strength">
                    <span className="strength-bars">
                      {[1, 2, 3, 4, 5].map((n) => <i key={n} style={{ background: n <= score ? strength.color : 'rgba(255,255,255,0.12)' }} />)}
                    </span>
                    <span className="strength-label" style={{ color: strength.color }}>{strength.label}</span>
                  </span>
                )}
                {pwError && <span className="field-err">{mode === 'register' ? 'Use at least 8 characters' : 'Password is required'}</span>}
              </label>

              {error && <div className="error-box shake" role="alert">{error}</div>}

              <button className="btn-submit" disabled={busy !== null}>
                {busy === 'form' ? <><span className="spinner" /> Please wait…</> : mode === 'login' ? 'Sign in →' : 'Create my account →'}
              </button>

              <div className="divider"><span>or</span></div>

              <button type="button" className="btn-demo" onClick={tryDemo} disabled={busy !== null}>
                {busy === 'demo' ? <><span className="spinner dark" /> Preparing demo…</> : '✦ Explore the live demo'}
              </button>

              <p className="fine-print">We verify every account by email. You can export or delete your data at any time.</p>
            </form>
          ) : (
            <form className="glass-card" onSubmit={verifyOtp}>
              <button type="button" className="back-link" onClick={() => { setStep('creds'); setError(''); }}>← Back</button>
              <h2 className="card-title">Verify your email</h2>
              <p className="card-sub">We sent a 6-digit code to <strong>{email}</strong>. It expires in 10 minutes.</p>

              {devCode && (
                <div className="dev-code">
                  <span className="dev-tag">DEV MODE</span>
                  <span>SMTP not configured — your code is <strong>{devCode}</strong></span>
                </div>
              )}

              <div className="otp-row">
                {otp.map((d, i) => (
                  <input
                    key={i}
                    ref={(el) => { otpRefs.current[i] = el; }}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={1}
                    value={d}
                    onChange={(e) => setOtpDigit(i, e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Backspace' && !otp[i] && i > 0) otpRefs.current[i - 1]?.focus(); } }
                    aria-label={`Digit ${i + 1}`}
                  />
                ))}
              </div>

              {error && <div className="error-box shake" role="alert">{error}</div>}

              <button className="btn-submit" disabled={busy !== null || otp.join('').length !== 6}>
                {busy === 'otp' ? <><span className="spinner" /> Verifying…</> : 'Verify & continue →'}
              </button>

              <p className="fine-print">
                Didn't get it?{' '}
                <button type="button" className="link-btn" onClick={resend} disabled={resendIn > 0 || busy !== null}>
                  {resendIn > 0 ? `Resend in ${resendIn}s` : busy === 'resend' ? 'Sending…' : 'Resend code'}
                </button>
              </p>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
