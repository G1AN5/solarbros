import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/Button'
import { useAuth } from '@/app/auth/useAuth'

/* ============================================================================
   StaffLoginPage — the unlisted employee sign-in. (/team)
   ----------------------------------------------------------------------------
   Not linked from anywhere on the public site, excluded in robots.txt, and
   marked noindex. Employees reach it by bookmark.

   BE CLEAR ABOUT WHAT THIS DOES AND DOES NOT DO
   -----------------------------------------------------------------------
   It is NOT a security boundary, and it must never be treated as one.

   Authentication happens at Supabase's `/auth/v1/token` endpoint, not at this
   page. An attacker does not need this URL: the anon key is public by design
   (it ships in the bundle), so anyone can POST credentials to Supabase directly
   whether this page exists or not. Hiding a form hides nothing.

   WHAT IT ACTUALLY BUYS
     * Less noise. Opportunistic bots crawl for login forms; not advertising one
       keeps the company out of the low-effort credential-stuffing lists.
     * Less phishing surface. Fewer public references to a staff login means
       fewer convincing lures to copy.
     * Less information disclosure. A public "Staff Login" button tells the
       world that staff accounts exist and hints at how the organisation is
       structured.
     * Better UX. Customers are not confused by a sign-in that is not for them.

   Worth doing for those reasons. Worthless as a defence on its own.

   WHAT ACTUALLY DEFENDS THE SYSTEM
     1. Row Level Security on all 39 tables, verified by `npm run verify:rls`
     2. The service_role key never leaving the server
     3. Leaked-password protection (enable in the Supabase dashboard)
     4. Multi-factor authentication for staff (Supabase supports TOTP)
     5. Rate limiting and CAPTCHA on the auth endpoint
     6. Deactivation genuinely revoking access (migration 0016)

   A staff member who signs in at the customer /login page still works
   correctly and lands on their own portal. Refusing them there would add no
   security — they would simply use this URL — and would produce a confusing
   failure for somebody using the wrong bookmark.
   ========================================================================== */

export function StaffLoginPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const intended = (location.state as { from?: string } | null)?.from

  /* Search engines should not index an employee sign-in page. robots.txt asks
     politely; this tells a crawler that already has the URL. */
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)
    return () => {
      document.head.removeChild(meta)
    }
  }, [])

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

    // The role arrives a moment after the session; ProtectedRoute routes on it.
    navigate(intended ?? '/admin', { replace: true })
  }

  return (
    <div className="stack stack--lg">
      <div>
        <span className="eyebrow">SolarBros · Internal</span>
        <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 'var(--space-2)' }}>Team sign-in</h1>
        <p className="muted small" style={{ marginTop: 'var(--space-2)' }}>
          For SolarBros employees. Customers sign in on the main site.
        </p>
      </div>

      <form className="stack" onSubmit={handleSubmit}>
        <div className="field">
          <label className="field__label" htmlFor="staffEmail">
            Work email
          </label>
          <input
            id="staffEmail"
            className="input"
            type="email"
            required
            autoComplete="email"
            placeholder="you@solarbros.ph"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
        </div>

        <div className="field">
          <div className="row row--between">
            <label className="field__label" htmlFor="staffPassword">
              Password
            </label>
            <Link
              to="/staff/forgot-password"
              className="small"
              style={{ color: 'var(--text-brand)' }}
            >
              Forgot?
            </Link>
          </div>
          <input
            id="staffPassword"
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

      <p className="xs dim">
        New here? Register below and choose the role you were given — an administrator checks it
        before your account does anything. If you picked the wrong one, they can correct it when
        they approve you; there is no need to register a second time.
      </p>

      <p className="small muted center">
        New to the team?{' '}
        <Link to="/staff/register" style={{ color: 'var(--text-brand)', fontWeight: 600 }}>
          Register your staff account
        </Link>
      </p>
    </div>
  )
}
