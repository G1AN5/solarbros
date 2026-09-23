import { type FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/Button'
import { useAuth } from '@/app/auth/useAuth'
import { ROLE_LABEL } from '@/lib/labels'
import type { UserRole } from '@/types/domain'

/* ============================================================================
   StaffRegisterPage — the unlisted employee sign-up.
   ----------------------------------------------------------------------------
   Not linked from anywhere. The company sends the URL to a new employee, who
   registers and says which role they were given. An administrator then confirms
   that claim before it grants anything.

   BEING UNLISTED IS NOT THE SECURITY. Anybody who finds this page can submit
   it, and that is fine, because submitting it achieves nothing on its own:
   migration 0052 creates the account on the 'client' role and INACTIVE, so the
   database denies every staff policy until an administrator approves. A
   stranger who registers here claiming to be an administrator gets an account
   that can read its own name and nothing else, and an entry in a queue where a
   real administrator will refuse it.

   'admin' is not offered, and is refused by the database even if the request is
   edited. The first administrator is made by hand in Supabase, and so is every
   later one — an approval queue that can mint administrators is a queue worth
   attacking.
   ========================================================================== */

/** The roles a person may claim. Deliberately excludes 'admin' and 'client'. */
const CLAIMABLE: UserRole[] = [
  'sales',
  'project_engineer',
  'inventory_manager',
  'accountant',
  'technician',
]

export function StaffRegisterPage() {
  const { signUp } = useAuth()
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)

    const password = String(form.get('password') ?? '')
    if (password !== String(form.get('confirm') ?? '')) {
      setError('Those two passwords do not match.')
      return
    }

    setBusy(true)
    setError(null)

    const { error: signUpError } = await signUp({
      email: String(form.get('email') ?? ''),
      password,
      fullName: String(form.get('fullName') ?? ''),
      phone: String(form.get('phone') ?? ''),
      requestedRole: String(form.get('requestedRole') ?? '') as UserRole,
    })

    setBusy(false)

    if (signUpError) {
      setError(signUpError)
      return
    }

    setSubmitted(true)
  }

  if (submitted) {
    return (
      <div className="stack stack--lg center">
        <div style={{ fontSize: '3rem' }}>✉️</div>
        <h1>Check your email</h1>
        <p className="muted" style={{ maxWidth: '46ch', marginInline: 'auto' }}>
          Confirm your address using the link we have just sent. After that, an administrator checks
          that the role you selected is the one you were given — you will not be able to sign in
          until they have.
        </p>
        <p className="small muted" style={{ maxWidth: '46ch', marginInline: 'auto' }}>
          If it has not arrived in a few minutes, look in your spam folder before registering again.
          Registering twice creates a second account for somebody to refuse.
        </p>
        <Link to="/staff/login" className="small" style={{ color: 'var(--text-brand)' }}>
          Go to the staff sign-in
        </Link>
      </div>
    )
  }

  return (
    <div className="stack stack--lg">
      <div>
        <h1>Staff registration</h1>
        <p className="muted">
          For SolarBros employees. Customers register on the{' '}
          <Link to="/register" style={{ color: 'var(--text-brand)' }}>
            main site
          </Link>
          .
        </p>
      </div>

      <form className="stack" onSubmit={handleSubmit}>
        <div className="field">
          <label className="field__label" htmlFor="staff-name">
            Full name
          </label>
          <input id="staff-name" name="fullName" className="input" required autoComplete="name" />
          <span className="field__hint">
            As your manager knows you — it is how they will recognise your request.
          </span>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="staff-email">
            Work email
          </label>
          <input
            id="staff-email"
            name="email"
            className="input"
            type="email"
            required
            autoComplete="email"
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="staff-phone">
            Mobile <span className="dim">(optional)</span>
          </label>
          <input
            id="staff-phone"
            name="phone"
            className="input"
            placeholder="+63 9XX XXX XXXX"
            autoComplete="tel"
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="staff-role">
            Your role
          </label>
          <select id="staff-role" name="requestedRole" className="select" required defaultValue="">
            <option value="" disabled>
              Choose the role you were given…
            </option>
            {CLAIMABLE.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABEL[role]}
              </option>
            ))}
          </select>
          <span className="field__hint">
            An administrator confirms this before your account does anything. Choosing the wrong one
            will have your registration refused, not silently corrected.
          </span>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="staff-password">
            Password
          </label>
          <input
            id="staff-password"
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
          <label className="field__label" htmlFor="staff-confirm">
            Type it again
          </label>
          <input
            id="staff-confirm"
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
          {busy ? 'Registering…' : 'Register'}
        </Button>
      </form>

      <p className="small muted center">
        Already approved?{' '}
        <Link to="/staff/login" style={{ color: 'var(--text-brand)', fontWeight: 600 }}>
          Sign in
        </Link>
      </p>
    </div>
  )
}
