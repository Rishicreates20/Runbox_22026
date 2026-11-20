import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth, validatePassword } from '../auth/AuthContext';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { PlusLoader } from '../components/PlusLoader';
import './AuthPage.css';

/** Where the password-reset email lands. The link signs the user in, then they choose a new password. */
export function ResetPasswordPage() {
  const { user, ready, updatePassword } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    document.title = 'Choose a new password · Code+';
  }, []);

  if (!ready) return <PlusLoader />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const err = validatePassword(password, true) ?? (password !== confirm ? 'The two passwords do not match.' : null);
    setError(err);
    if (err) return;
    setBusy(true);
    try {
      await updatePassword(password);
      setDone(true);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Your password could not be changed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="reset">
      <div className="auth-card anim-up">
        <Logo to="/" size={30} />
        {!user ? (
          <div className="sent">
            <span className="sent-icon">
              <Icon name="lock" size={22} />
            </span>
            <h1 className="reset-title">This link has expired</h1>
            <p>Reset links work once and only for a short time. Request a new one from the sign-in page with Forgot password.</p>
            <Link to="/login" className="btn btn-primary">
              Go to sign in
            </Link>
          </div>
        ) : done ? (
          <div className="sent" role="status">
            <span className="sent-icon">
              <Icon name="check" size={22} />
            </span>
            <h1 className="reset-title">Password changed</h1>
            <p>
              You&apos;re signed in as <strong>{user.username}</strong>. Use the new password next time you sign in.
            </p>
            <button type="button" className="btn btn-primary" onClick={() => navigate('/problems', { replace: true })}>
              Continue to problems <Icon name="arrowRight" size={16} />
            </button>
          </div>
        ) : (
          <form className="auth-form" onSubmit={onSubmit} noValidate>
            <div className="auth-title">
              <h1 className="reset-title">Choose a new password</h1>
              <p>For {user.email}</p>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="rp-new">
                New password
              </label>
              <div className="pw-wrap">
                <input id="rp-new" className="input" type={show ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="button" className="icon-btn pw-toggle" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
                  <Icon name={show ? 'eyeOff' : 'eye'} size={18} />
                </button>
              </div>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="rp-confirm">
                Repeat it
              </label>
              <input id="rp-confirm" className="input" type={show ? 'text' : 'password'} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            {error && (
              <p className="form-msg form-msg-error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
              {busy ? <span className="spinner" /> : <Icon name="check" size={16} strokeWidth={2.4} />}
              Save new password
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
