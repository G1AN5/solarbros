import { type FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/Button'
import { useAuth } from '@/app/auth/useAuth'

/* ============================================================================
   PasswordResetFlow — request a code, then set a new password.
   ----------------------------------------------------------------------------
   ONE COMPONENT, TWO AUDIENCES. Customers reach it at /forgot-password and
   staff at /staff/forgot-password. The only differences are the wording and
   where "back to sign in" goes. Writing it twice would mean two copies of a
   security-sensitive flow drifting apart, and the copy nobody is looking at
   would be the one that keeps the bug.

   WHY A CODE RATHER THAN A LINK
   A link in an email is opened by whatever handled it — a scanner, a preview
   pane, a corporate mail filter — and each of those consumes the single-use
   token before the person ever clicks. A six-digit code is typed by a human on
   the page that requested it, which also means the reset finishes in the same
   tab and the same session rather than a new one.

   The email template decides which arrives. `{{ .Token }}` sends a code;
   `{{ .ConfirmationURL }}` sends a link that lands on /reset-password. Both end
   at the same `updatePassword` call, so the application works either way — but
   only the code path is finished in one sitting, which is why the copy below
   asks for a code and mentions the link as the fallback.

   IT NEVER SAYS WHETHER THE ADDRESS EXISTS.
   Reporting "no account found" turns this form into an account-enumeration
   oracle: anybody could test a list of addresses and learn which are customers.
   The response is identical either way, and a real error is logged, not shown.
   ========================================================================== */

interface PasswordResetFlowProps {
  /** Where "back to sign in" goes, and where a finished reset lands. */
  signInPath: string
  /** Shown under the heading. */
  audienceNote: string
}

type Step = 'request' | 'verify' | 'done'

export function PasswordResetFlow({ signInPath, audienceNote }: PasswordResetFlowProps) {
  const { requestPasswordReset, verifyResetCode, updatePassword } = useAuth()
  const navigate = useNavigate()

  const [step, setStep] = useState<Step>('request')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    const { error: requestError } = await requestPasswordReset(email)

    // Deliberately not surfaced — see the header.
    if (requestError && import.meta.env.DEV) {
      console.warn('[SolarBros] Password reset request failed:', requestError)
    }

    setBusy(false)
    setStep('verify')
  }

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)

    const password = String(form.get('password') ?? '')
    if (password !== String(form.get('confirm') ?? '')) {
      setError('Those two passwords do not match.')
      return
    }

    setBusy(true)
    setError(null)

    /* The code is exchanged for a session FIRST. Until that succeeds there is
       nobody to change the password of, so doing it the other way round would
       silently update whoever happened to be signed in on this device. */
    const { error: codeError } = await verifyResetCode(email, String(form.get('code') ?? ''))
    if (codeError) {
      setError(codeError)
      setBusy(false)
      return
    }

    const { error: updateError } = await updatePassword(password)
    setBusy(false)

    if (updateError) {
      setError(updateError)
      return
    }

    setStep('done')
  }

  /* ------------------------------------------------------------------ DONE */
  if (step === 'done') {
    return (
      <div className="stack stack--lg center">
        <div style={{ fontSize: '2.5rem' }}>✅</div>
        <h1 style={{ fontSize: 'var(--text-xl)' }}>Password changed</h1>
        <p className="muted small" style={{ maxWidth: '44ch', marginInline: 'auto' }}>
          You are signed in on this device. Anywhere else you were signed in will need the new
          password.
        </p>
        <Button variant="primary" onClick={() => navigate(signInPath, { replace: true })}>
          Continue
        </Button>
      </div>
    )
  }

  /* ---------------------------------------------------------------- VERIFY */
  if (step === 'verify') {
    return (
      <div className="stack stack--lg">
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)' }}>Check your email</h1>
          <p className="muted small" style={{ marginTop: 'var(--space-2)' }}>
            If <strong>{email}</strong> has an account with us, we have sent a six-digit code. It
            expires in one hour and works once.
          </p>
        </div>

        <form className="stack" onSubmit={handleVerify}>
          <div className="field">
            <label className="field__label" htmlFor="reset-code">
              Six-digit code
            </label>
            <input
              id="reset-code"
              name="code"
              className="input"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              maxLength={10}
              style={{
                fontSize: 'var(--text-xl)',
                letterSpacing: '0.35em',
                textAlign: 'center',
                fontVariantNumeric: 'tabular-nums',
              }}
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="reset-password">
              New password
            </label>
            <input
              id="reset-password"
              name="password"
              className="input"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
            />
            <span className="field__hint">At least 8 characters.</span>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="reset-confirm">
              Type it again
            </label>
            <input
              id="reset-confirm"
              name="confirm"
              className="input"
              type="password"
              required
              autoComplete="new-password"
            />
          </div>

          {error && (
            <p
              role="alert"
              className="small"
              style={{
                padding: 'var(--space-3)',
                background: 'var(--danger-bg)',
                color: 'var(--danger-fg)',
                borderRadius: 'var(--radius)',
              }}
            >
              {error}
            </p>
          )}

          <Button type="submit" variant="primary" block size="lg" disabled={busy}>
            {busy ? 'Setting your password…' : 'Set new password'}
          </Button>
        </form>

        <p className="xs dim center" style={{ maxWidth: '44ch', marginInline: 'auto' }}>
          Sent a link instead of a code? Click it — it opens the same form on a page of its own.
          Nothing arrived? Check your spam folder before asking again; a second code makes the first
          one stop working.
        </p>

        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => {
            setStep('request')
            setError(null)
          }}
        >
          Use a different email address
        </button>
      </div>
    )
  }

  /* --------------------------------------------------------------- REQUEST */
  return (
    <div className="stack stack--lg">
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)' }}>Reset your password</h1>
        <p className="muted small" style={{ marginTop: 'var(--space-2)' }}>
          {audienceNote}
        </p>
      </div>

      <form className="stack" onSubmit={handleRequest}>
        <div className="field">
          <label className="field__label" htmlFor="reset-email">
            Email
          </label>
          <input
            id="reset-email"
            className="input"
            type="email"
            required
            autoComplete="email"
            placeholder="you@email.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={busy}
          />
        </div>

        <Button type="submit" variant="primary" block size="lg" disabled={busy}>
          {busy ? 'Sending…' : 'Send me a code'}
        </Button>
      </form>

      <Link to={signInPath} className="small muted center">
        ← Back to sign in
      </Link>
    </div>
  )
}
