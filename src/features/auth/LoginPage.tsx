import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/Button'
import { useAuth } from '@/app/auth/useAuth'

/* ============================================================================
   LoginPage
   ----------------------------------------------------------------------------
   One sign-in page for all seven roles. There is no role picker in production:
   the role comes from the `profiles` table, and after authenticating we send
   the user to whichever portal their role belongs to.

   RETURNING SOMEONE WHERE THEY WERE GOING
   ProtectedRoute stashes the attempted path in navigation state before it
   bounces here. Someone who followed a link to /portal/billing while signed out
   lands back on /portal/billing rather than a generic dashboard.

   The demo panel at the bottom only renders in development builds.
   ========================================================================== */

export function LoginPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /** Where ProtectedRoute wanted to send them before it redirected here. */
  const intended = (location.state as { from?: string } | null)?.from

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)

    const { error: signInError } = await signIn(email, password)

    if (signInError) {
      setError(signInError)
      setBusy(false)
      return
    }

    /* The role is not known synchronously — the profile loads a moment after
       the session. So aim at the customer portal and let the route guards
       correct it: a member of staff who signs in here is redirected to their
       own landing page rather than being refused.

       It used to navigate to '/', which is the PUBLIC marketing site and has no
       guard on it at all — so a customer who signed in correctly was left
       looking at the sales homepage. */
    navigate(intended ?? '/portal', { replace: true })
  }

  return (
    <div className="stack stack--lg">
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)' }}>Sign in</h1>
        <p className="muted small" style={{ marginTop: 'var(--space-2)' }}>
          Access your project tracker, documents and support tickets.
        </p>
      </div>

      {intended && (
        <p
          className="small"
          style={{
            padding: 'var(--space-3)',
            background: 'var(--info-bg)',
            color: 'var(--info-fg)',
            borderRadius: 'var(--radius)',
          }}
        >
          Please sign in to continue to <code>{intended}</code>.
        </p>
      )}

      <form className="stack" onSubmit={handleSubmit}>
        <div className="field">
          <label className="field__label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="input"
            type="email"
            required
            autoComplete="email"
            placeholder="you@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
        </div>

        <div className="field">
          <div className="row row--between">
            <label className="field__label" htmlFor="password">
              Password
            </label>
            <Link to="/forgot-password" className="small" style={{ color: 'var(--text-brand)' }}>
              Forgot?
            </Link>
          </div>
          <input
            id="password"
            className="input"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
        </div>

        {error && (
          <p
            className="small"
            style={{
              padding: 'var(--space-3)',
              background: 'var(--danger-bg)',
              color: 'var(--danger-fg)',
              borderRadius: 'var(--radius)',
            }}
            role="alert"
          >
            {error}
          </p>
        )}

        <Button type="submit" variant="primary" block size="lg" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <p className="small muted center">
        No account yet?{' '}
        <Link to="/register" style={{ color: 'var(--text-brand)', fontWeight: 600 }}>
          Register your project
        </Link>
      </p>

      <Link to="/" className="small muted center">
        ← Back to the website
      </Link>
    </div>
  )
}
