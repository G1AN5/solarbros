import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/Button'
import { useAuth } from '@/app/auth/useAuth'

/* ============================================================================
   RegisterPage
   ----------------------------------------------------------------------------
   Self-registration creates a CLIENT account and nothing else. The role column
   defaults to 'client' in the database and is only ever changed by an
   administrator, so a stranger cannot sign up as an accountant no matter what
   they send. Staff accounts are created by invitation from /admin/governance.

   The project reference is optional and is stored on the profile metadata for a
   sales rep to match against a signed contract. It is deliberately NOT used to
   grant access to a project: linking an account to a project is a decision a
   person makes, not something a form field asserts.
   ========================================================================== */

export function RegisterPage() {
  const { signUp } = useAuth()
  const navigate = useNavigate()

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [projectReference, setProjectReference] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')

  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    // Checked here as well as by the browser, because `required` and `minlength`
    // are trivially removed from the DOM.
    if (password !== confirm) {
      setError('The two passwords do not match.')
      return
    }
    if (password.length < 8) {
      setError('Please choose a password of at least 8 characters.')
      return
    }

    setBusy(true)
    const { error: signUpError, needsEmailConfirmation } = await signUp({
      email,
      password,
      fullName,
      phone: phone || undefined,
      projectReference: projectReference || undefined,
    })

    if (signUpError) {
      setError(signUpError)
      setBusy(false)
      return
    }

    if (needsEmailConfirmation) {
      setAwaitingConfirmation(true)
      setBusy(false)
      return
    }

    navigate('/portal', { replace: true })
  }

  if (awaitingConfirmation) {
    return (
      <div className="stack stack--lg center">
        <div style={{ fontSize: '2.5rem' }}>📧</div>
        <h1 style={{ fontSize: 'var(--text-xl)' }}>Confirm your email</h1>
        <p className="muted small" style={{ maxWidth: '44ch', marginInline: 'auto' }}>
          We have sent a confirmation link to <strong>{email}</strong>. Open it to activate your
          account, then sign in.
        </p>
        <Link to="/login" className="btn btn--primary">
          Back to sign in
        </Link>
      </div>
    )
  }

  return (
    <div className="stack stack--lg">
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)' }}>Create your account</h1>
        <p className="muted small" style={{ marginTop: 'var(--space-2)' }}>
          Track your installation, download your documents and raise support requests.
        </p>
      </div>

      <form className="stack" onSubmit={handleSubmit}>
        <div className="field">
          <label className="field__label" htmlFor="fullName">
            Full name
          </label>
          <input
            id="fullName"
            className="input"
            required
            autoComplete="name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            disabled={busy}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="regEmail">
            Email
          </label>
          <input
            id="regEmail"
            className="input"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="phone">
            Mobile number
          </label>
          <input
            id="phone"
            className="input"
            type="tel"
            autoComplete="tel"
            placeholder="+63 9XX XXX XXXX"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={busy}
          />
          <span className="field__hint">Used for installation and appointment updates.</span>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="projectRef">
            Project reference <span className="dim">(optional)</span>
          </label>
          <input
            id="projectRef"
            className="input"
            placeholder="e.g. SB-2026-1001"
            value={projectReference}
            onChange={(e) => setProjectReference(e.target.value)}
            disabled={busy}
          />
          <span className="field__hint">
            On your contract or quotation. It helps us link your account to your installation
            faster.
          </span>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="regPassword">
            Password
          </label>
          <input
            id="regPassword"
            className="input"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
          <span className="field__hint">At least 8 characters.</span>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="confirmPassword">
            Confirm password
          </label>
          <input
            id="confirmPassword"
            className="input"
            type="password"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
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
          {busy ? 'Creating your account…' : 'Create account'}
        </Button>
      </form>

      <p className="xs dim">
        Staff accounts are created by an administrator, not through this form.
      </p>

      <p className="small muted center">
        Already registered?{' '}
        <Link to="/login" style={{ color: 'var(--text-brand)', fontWeight: 600 }}>
          Sign in
        </Link>
      </p>
    </div>
  )
}
