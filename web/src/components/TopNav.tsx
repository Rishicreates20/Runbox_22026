import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Icon } from './Icon';
import { Logo } from './Logo';
import './TopNav.css';

export function Avatar({ name, size = 30 }: { name: string; size?: number }) {
  const initials = name
    .replace(/[^a-zA-Z0-9 _]/g, '')
    .split(/[\s_]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('') || '?';
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }} aria-hidden="true">
      {initials}
    </span>
  );
}

export function UserMenu() {
  const { user, signOut, demoMode } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;

  return (
    <div className="user-menu" ref={ref}>
      <button
        type="button"
        className="user-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${user.username}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar name={user.username} />
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div className="user-popover" role="menu">
          <div className="user-head">
            <Avatar name={user.username} size={36} />
            <div className="user-meta">
              <span className="user-name">{user.username}</span>
              <span className="user-email">{user.email}</span>
            </div>
          </div>
          {demoMode && <p className="user-note">Demo mode: your account and submissions are stored in this browser only.</p>}
          <button
            type="button"
            role="menuitem"
            className="user-item"
            onClick={() => {
              setOpen(false);
              navigate('/submissions');
            }}
          >
            <Icon name="history" /> My submissions
          </button>
          <button
            type="button"
            role="menuitem"
            className="user-item"
            onClick={async () => {
              setOpen(false);
              await signOut();
              navigate('/login', { replace: true });
            }}
          >
            <Icon name="logout" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function TopNav({ children }: { children?: ReactNode }) {
  const { demoMode } = useAuth();
  return (
    <header className="topnav">
      <div className="topnav-inner">
        <Logo to="/problems" size={28} />
        <nav className="topnav-links" aria-label="Primary">
          <NavLink to="/problems" end className="topnav-link">
            Problems
          </NavLink>
          <NavLink to="/submissions" className="topnav-link">
            Submissions
          </NavLink>
        </nav>
        <div className="topnav-right">
          {children}
          {demoMode && (
            <span className="demo-pill" title="No server is connected. Auth and judging are simulated in this browser.">
              <span className="demo-dot" /> Demo mode
            </span>
          )}
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
