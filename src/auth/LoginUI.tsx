import { useEffect, useRef, useState } from 'react';
import { cancelSignIn, desktopSignIn, renderGoogleButton, signOut, useAuth } from './auth';
import { isDesktop } from '../lib/platform';

/** "Continue with Google" — the official button on the web, a system-browser flow on desktop. */
export function GoogleButton() {
  const { mode, busy, error, clientId } = useAuth();
  const ref = useRef<HTMLDivElement>(null);
  const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  useEffect(() => {
    if (!isDesktop && ref.current && clientId) renderGoogleButton(ref.current, theme);
  }, [clientId, theme]);
  if (mode === 'off' || mode === 'loading') return null;
  return (
    <div className="google-signin">
      {isDesktop && mode === 'server' ? (
        busy ? (
          <div className="col-center">
            <p className="muted">Finish signing in in your browser…</p>
            <button className="btn small" onClick={cancelSignIn}>Cancel</button>
          </div>
        ) : (
          <button className="btn google-btn" onClick={desktopSignIn}>
            <GoogleLogo /> Continue with Google
          </button>
        )
      ) : (
        <>
          <div ref={ref} className="gis-slot" />
          {busy && <p className="muted">Signing in…</p>}
        </>
      )}
      {error && <p className="error-text">{error}</p>}
      {mode === 'static' && <p className="muted small-note">No Figmy server here — signing in only sets your name and avatar for collaboration.</p>}
    </div>
  );
}

/** Full-screen gate shown when the server requires sign-in. */
export function LoginScreen() {
  return (
    <div className="login-screen">
      <div className="login-card">
        <img src="./icon.svg" width={48} height={48} alt="" />
        <h1>Sign in to Figmy</h1>
        <p className="muted">Use your Google account to open your files and collaborate.</p>
        <GoogleButton />
      </div>
    </div>
  );
}

/** Avatar + menu (sidebar / toolbar). */
export function AccountBadge({ compact = false }: { compact?: boolean }) {
  const { user, mode } = useAuth();
  const [open, setOpen] = useState(false);
  if (mode === 'off' || mode === 'loading') return null;
  if (!user) return compact ? null : <GoogleButton />;
  return (
    <div className={`account ${compact ? 'compact' : ''}`}>
      <button className="account-btn" onClick={() => setOpen(!open)} title={`${user.name} · ${user.email}`}>
        <Avatar name={user.name} src={user.picture} />
        {!compact && (
          <span className="account-text">
            <b>{user.name}</b>
            <small className="muted">{user.email}</small>
          </span>
        )}
      </button>
      {open && (
        <div className="account-pop" onMouseLeave={() => setOpen(false)}>
          <div className="account-head">
            <Avatar name={user.name} src={user.picture} size={36} />
            <div>
              <b>{user.name}</b>
              <div className="muted">{user.email}</div>
            </div>
          </div>
          {mode === 'static' && <p className="muted small-note">Signed in locally (no server).</p>}
          <button
            className="btn small"
            onClick={async () => {
              setOpen(false);
              await signOut();
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function Avatar({ name, src, size = 26 }: { name: string; src?: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  return src && !broken ? (
    <img className="avatar-img" src={src} width={size} height={size} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
  ) : (
    <span className="avatar-img fallback" style={{ width: size, height: size }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
