import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AuthError, useAuth, validateEmail, validatePassword, validateUsername, type Provider } from '../auth/AuthContext';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { PlusBurst } from '../components/PlusBurst';
import './AuthPage.css';

type Mode = 'signin' | 'signup';
type Field = 'username' | 'email' | 'password';
type Busy = null | 'form' | Provider | 'demo';

const VERDICT_CHIPS = [
  { code: 'OK', label: 'Accepted', color: 'var(--ok)' },
  { code: 'TLE', label: 'Time limit', color: 'var(--warn)' },
  { code: 'MLE', label: 'Memory limit', color: 'var(--mem)' },
  { code: 'RE', label: 'Runtime error', color: 'var(--err)' },
  { code: 'SV', label: 'Blocked syscall', color: 'var(--orange)' },
];

function strength(pw: string): number {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 8) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.max(1, s);
}
const STRENGTH_LABEL = ['Use 8+ characters with letters, numbers and a symbol', 'Weak password', 'Fair password', 'Good password', 'Strong password'];
const STRENGTH_COLOR = ['var(--dim)', 'var(--err)', 'var(--warn)', '#a3e635', 'var(--ok)'];

export function AuthPage({ mode }: { mode: Mode }) {
  const { signIn, signUp, signInWithProvider, signInDemo, demoMode, backend, usernameAvailable, resendConfirmation, requestPasswordReset } =
    useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const isSignup = mode === 'signup';
  const uid = useId();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [showPw, setShowPw] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [resend, setResend] = useState<'idle' | 'sending' | 'sent'>('idle');

  const refs = {
    username: useRef<HTMLInputElement>(null),
    email: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
  };

  useEffect(() => {
    setErrors({});
    setFormError(null);
    setInfo(null);
    setSentTo(null);
    setUnconfirmed(false);
    document.title = isSignup ? 'Create account · Code+' : 'Sign in · Code+';
  }, [isSignup]);

  const done = () => navigate(from && from !== '/login' ? from : '/problems', { replace: true });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const next: Partial<Record<Field, string>> = {};
    if (isSignup) {
      const u = validateUsername(username);
      if (u) next.username = u;
    }
    const em = validateEmail(email);
    if (em) next.email = em;
    const pw = validatePassword(password, isSignup);
    if (pw) next.password = pw;
    setErrors(next);
    setFormError(null);
    setInfo(null);
    setUnconfirmed(false);
    const first = (['username', 'email', 'password'] as Field[]).find((f) => next[f]);
    if (first) {
      refs[first].current?.focus();
      return;
    }
    setBusy('form');
    try {
      if (isSignup) {
        const result = await signUp(username, email, password);
        if (result.needsConfirmation) {
          setSentTo(email.trim());
          setResend('idle');
          setBusy(null);
          return;
        }
      } else {
        await signIn(email, password, remember);
      }
      done();
    } catch (err) {
      if (err instanceof AuthError && err.code === 'unconfirmed') {
        setUnconfirmed(true);
        setFormError(err.message);
      } else if (err instanceof AuthError && err.field) {
        setErrors({ [err.field]: err.message });
        refs[err.field].current?.focus();
      } else {
        setFormError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
      }
      setBusy(null);
    }
  }

  async function provider(p: Provider) {
    if (busy) return;
    setBusy(p);
    setFormError(null);
    try {
      const u = await signInWithProvider(p);
      if (u) done();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Sign-in failed.');
      setBusy(null);
    }
  }

  async function resendEmail(address: string) {
    setResend('sending');
    try {
      await resendConfirmation(address);
      setResend('sent');
      setInfo(`A new confirmation link is on its way to ${address}.`);
      setFormError(null);
    } catch (err) {
      setResend('idle');
      setFormError(err instanceof Error ? err.message : 'The email could not be sent.');
    }
  }

  async function forgotPassword() {
    setFormError(null);
    if (backend !== 'supabase') {
      setInfo(
        demoMode
          ? 'Password reset needs the Code+ server. In demo mode, create a new account or use the demo account.'
          : 'If an account uses that email, a reset link is on its way.',
      );
      return;
    }
    const em = validateEmail(email);
    if (em) {
      setErrors({ email: 'Enter your email above first, then choose Forgot password.' });
      refs.email.current?.focus();
      return;
    }
    try {
      await requestPasswordReset(email);
      setInfo(`If an account uses ${email.trim()}, a link to choose a new password is on its way.`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'The reset email could not be sent.');
    }
  }

  async function checkUsername() {
    if (backend !== 'supabase' || validateUsername(username)) return;
    const free = await usernameAvailable(username);
    if (free === false) setErrors((e) => ({ ...e, username: 'That username is taken.' }));
  }

  async function demo() {
    if (busy) return;
    setBusy('demo');
    await signInDemo();
    done();
  }

  const score = strength(password);
  const fieldProps = (f: Field) => ({
    'aria-invalid': errors[f] ? true : undefined,
    'aria-describedby': errors[f] ? `${uid}-${f}-err` : undefined,
  });

  return (
    <div className="auth">
      <section className="auth-hero">
        <header className="auth-hero-head">
          <Logo to="/" size={32} />
          <span className="status-pill">
            <span className="ping status-dot" />
            runbox sandbox · C · C++ · Python
          </span>
        </header>

        <div className="auth-hero-body">
          <div className="auth-stage">
            <PlusBurst />
          </div>
          <div className="auth-copy">
            <span className="auth-eyebrow anim-up">
              <Icon name="shield" size={14} /> Sandboxed execution
            </span>
            <h1 className="auth-headline anim-up" style={{ animationDelay: '0.08s' }}>
              Write it. Run it.
              <br />
              <span>Get the verdict.</span>
            </h1>
            <p className="auth-sub anim-up" style={{ animationDelay: '0.16s' }}>
              Solve problems in C, C++ and Python. Every submission runs inside runbox, an isolated Linux sandbox, so CPU time,
              memory and verdicts are measured the same way every time.
            </p>
            <ul className="verdict-chips anim-up" style={{ animationDelay: '0.24s' }} aria-label="Verdicts you can get">
              {VERDICT_CHIPS.map((v) => (
                <li key={v.code} className="verdict-chip">
                  <span style={{ color: v.color }}>{v.code}</span>
                  {v.label}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <footer className="auth-foot">
          <span>© {new Date().getFullYear()} Code+</span>
          <span>Powered by runbox</span>
        </footer>
      </section>

      <main className="auth-main">
        <div className="auth-card anim-up" style={{ animationDelay: '0.1s' }}>
          <div className="auth-title" key={sentTo ? 'sent' : mode}>
            <h2 className="anim-in">{sentTo ? 'Confirm your email' : isSignup ? 'Create your account' : 'Welcome back'}</h2>
            <p className="anim-in">
              {sentTo ? 'One more step and your account is ready.' : isSignup ? 'Free forever. Start solving in under a minute.' : 'Sign in to pick up where you left off.'}
            </p>
          </div>

          {sentTo ? (
            <div className="sent anim-up" role="status">
              <span className="sent-icon">
                <Icon name="mail" size={22} />
              </span>
              <p>
                We sent a confirmation link to <strong>{sentTo}</strong>. Open it to finish creating your account. It signs you in
                automatically.
              </p>
              {formError && (
                <p className="form-msg form-msg-error" role="alert">
                  {formError}
                </p>
              )}
              <div className="sent-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => resendEmail(sentTo)} disabled={resend !== 'idle'}>
                  {resend === 'sending' ? <span className="spinner spinner-lg" /> : <Icon name="mail" size={14} />}
                  {resend === 'sent' ? 'Sent again' : 'Resend email'}
                </button>
                <Link to="/login" replace className="btn-text link-sm" onClick={() => setSentTo(null)}>
                  Back to sign in
                </Link>
              </div>
              <p className="fine">No email after a few minutes? Check your spam folder, or make sure the address is spelled correctly.</p>
            </div>
          ) : (
            <>

          <div className="seg" role="tablist" aria-label="Account">
            <span className="seg-indicator" style={{ transform: isSignup ? 'translateX(100%)' : 'translateX(0)' }} aria-hidden="true" />
            <Link to="/login" state={location.state} replace role="tab" aria-selected={!isSignup} className="seg-tab">
              Sign in
            </Link>
            <Link to="/signup" state={location.state} replace role="tab" aria-selected={isSignup} className="seg-tab">
              Create account
            </Link>
          </div>

          <div className="oauth">
            <button type="button" className="btn btn-ghost" onClick={() => provider('github')} disabled={busy !== null}>
              {busy === 'github' ? <span className="spinner" /> : <Icon name="branch" size={18} />}
              GitHub
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => provider('google')} disabled={busy !== null}>
              {busy === 'google' ? <span className="spinner" /> : <Icon name="google" size={18} />}
              Google
            </button>
          </div>

          <div className="divider">or with email</div>

          <form className="auth-form" onSubmit={onSubmit} noValidate>
            {isSignup && (
              <div className="field anim-in">
                <label className="field-label" htmlFor={`${uid}-username`}>
                  Username
                </label>
                <input
                  ref={refs.username}
                  id={`${uid}-username`}
                  className="input"
                  type="text"
                  autoComplete="username"
                  placeholder="ada_lovelace"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    if (errors.username) setErrors((er) => ({ ...er, username: undefined }));
                  }}
                  onBlur={checkUsername}
                  {...fieldProps('username')}
                />
                {errors.username && (
                  <span className="field-error" id={`${uid}-username-err`}>
                    {errors.username}
                  </span>
                )}
              </div>
            )}

            <div className="field">
              <label className="field-label" htmlFor={`${uid}-email`}>
                Email
              </label>
              <input
                ref={refs.email}
                id={`${uid}-email`}
                className="input"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                {...fieldProps('email')}
              />
              {errors.email && (
                <span className="field-error" id={`${uid}-email-err`}>
                  {errors.email}
                </span>
              )}
            </div>

            <div className="field">
              <div className="field-row">
                <label className="field-label" htmlFor={`${uid}-password`}>
                  Password
                </label>
                {!isSignup && (
                  <button type="button" className="btn-text link-sm" onClick={forgotPassword}>
                    Forgot password?
                  </button>
                )}
              </div>
              <div className="pw-wrap">
                <input
                  ref={refs.password}
                  id={`${uid}-password`}
                  className="input"
                  type={showPw ? 'text' : 'password'}
                  autoComplete={isSignup ? 'new-password' : 'current-password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  {...fieldProps('password')}
                />
                <button
                  type="button"
                  className="icon-btn pw-toggle"
                  onClick={() => setShowPw((s) => !s)}
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                  aria-pressed={showPw}
                >
                  <Icon name={showPw ? 'eyeOff' : 'eye'} size={18} />
                </button>
              </div>
              {errors.password && (
                <span className="field-error" id={`${uid}-password-err`}>
                  {errors.password}
                </span>
              )}
              {isSignup && (
                <div className="strength anim-in" aria-live="polite">
                  <div className="strength-bars" aria-hidden="true">
                    {[0, 1, 2, 3].map((i) => (
                      <span key={i} style={{ background: i < score ? STRENGTH_COLOR[score] : 'var(--line-2)' }} />
                    ))}
                  </div>
                  <span style={{ color: STRENGTH_COLOR[score] }}>{STRENGTH_LABEL[score]}</span>
                </div>
              )}
            </div>

            {!isSignup && (
              <label className="check">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                Keep me signed in on this device
              </label>
            )}

            {formError && (
              <div className="form-msg form-msg-error" role="alert">
                <span>{formError}</span>
                {unconfirmed && (
                  <button type="button" className="btn-text link-sm" onClick={() => resendEmail(email)} disabled={resend !== 'idle'}>
                    {resend === 'sent' ? 'Sent' : 'Resend link'}
                  </button>
                )}
              </div>
            )}
            {info && (
              <p className="form-msg" role="status">
                <Icon name="info" /> {info}
              </p>
            )}

            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy !== null}>
              {busy === 'form' ? (
                <>
                  <span className="spinner" /> {isSignup ? 'Creating account…' : 'Signing in…'}
                </>
              ) : (
                <>
                  {isSignup ? 'Create account' : 'Sign in'} <Icon name="arrowRight" size={18} strokeWidth={2.2} />
                </>
              )}
            </button>

            {isSignup && (
              <p className="fine">
                By creating an account you agree to the Terms and Privacy Policy.
              </p>
            )}
          </form>

          {demoMode && (
            <button type="button" className="demo-btn" onClick={demo} disabled={busy !== null}>
              {busy === 'demo' ? <span className="spinner spinner-lg" /> : <Icon name="play" size={14} />}
              <span>
                <strong>Try the demo account</strong>
                <span>Comes with sample progress and submissions</span>
              </span>
              <Icon name="chevronRight" />
            </button>
          )}

          <p className="switch">
            {isSignup ? 'Already have an account?' : 'New to Code+?'}{' '}
            <Link to={isSignup ? '/login' : '/signup'} state={location.state} replace>
              {isSignup ? 'Sign in' : 'Create an account'}
            </Link>
          </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
