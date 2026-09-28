import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { login } from '../api/authApi';
import { getSession, saveSession } from '../lib/session';
import { Logo } from '../components/common/Logo';
import { Button } from '../components/common/Button';

/** Console login: username + password (decided 2026-09-28). No self-signup; accounts come from `npm run user:create`. */
export function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Only an in-app path — never send the user off to another site after login.
  const next = params.get('next')?.startsWith('/') && !params.get('next')?.startsWith('//') ? (params.get('next') as string) : '/overview';

  if (getSession()) return <Navigate to={next} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      saveSession(await login(username.trim(), password));
      navigate(next, { replace: true });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-xl2 border border-slate-900/5 bg-white/85 p-6 shadow-glass backdrop-blur-xl"
        aria-describedby={error ? 'login-error' : undefined}
      >
        <div className="mb-6 flex items-center gap-3">
          <Logo size={36} />
          <div className="leading-tight">
            <h1 className="text-base font-semibold text-slate-900">ULINK Claims</h1>
            <p className="text-sm text-slate-500">Log in to continue</p>
          </div>
        </div>

        <label className="mb-3 block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Username</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
            className="w-full rounded-lg border border-slate-900/10 bg-white px-3 py-2 text-sm outline-none focus:border-ulink-teal focus:ring-2 focus:ring-ulink-teal/30"
          />
        </label>
        <label className="mb-4 block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            className="w-full rounded-lg border border-slate-900/10 bg-white px-3 py-2 text-sm outline-none focus:border-ulink-teal focus:ring-2 focus:ring-ulink-teal/30"
          />
        </label>

        {error && (
          <p id="login-error" role="alert" className="mb-4 text-sm text-red-600">
            {error}
          </p>
        )}

        <Button type="submit" disabled={busy} className="w-full justify-center">
          {busy ? 'Logging in…' : 'Log in'}
        </Button>
        <p className="mt-4 text-xs text-slate-500">Forgot your password? Ask your administrator to reset it.</p>
      </form>
    </main>
  );
}
