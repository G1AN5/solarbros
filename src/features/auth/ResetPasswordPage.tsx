import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/Button'
import { useAuth } from '@/app/auth/useAuth'
import { supabase } from '@/lib/supabase'

/* ============================================================================
   ResetPasswordPage — where a recovery link actually lands.
   ----------------------------------------------------------------------------
   THIS PAGE WAS MISSING, AND THE WHOLE FLOW WAS BROKEN WITHOUT IT.
   /forgot-password sent a real email through Supabase, but the link pointed at
   /login. Supabase would exchange the token for a temporary session, the
   visitor would arrive signed in — and there was nowhere to set a new password.
   The one thing they came to do was impossible, and because they were signed in
   it looked like it had worked.

   HOW THE LINK PROVES WHO THEY ARE
   The email contains a single-use, short-lived token. supabase-js reads it out
   of the URL, exchanges it for a recovery session, and clears it from the
   address bar. Possession of the mailbox is the proof of identity — which is
   why the reset goes by EMAIL and not SMS: it costs nothing per message, the
   token is long enough to be unguessable, and a mailbox is harder to intercept
   than a text on a swapped SIM.

   ARRIVING WITHOUT A SESSION IS THE NORMAL FAILURE
   Links expire, get opened twice, or are forwarded. That case is handled
   explicitly rather than left to fail on submit, because "nothing happens when
   I press the button" is the worst possible version of it.
   ========================================================================== */

export function ResetPasswordPage() {
  const { updatePassword } = useAuth()
  const navigate = useNavigate()

  /* Unconfigured builds have no session to wait for, so start ready rather
     than setting it synchronously inside the effect — which is both an extra
     render and a lint error. */
  const [ready, setReady] = useState<'checking' | 'ready' | 'no-session'>(
    supabase ? 'checking' : 'ready',
  )
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  /* supabase-js parses the recovery token out of the URL on load, so the
     session may not exist yet on the first render. Wait for it rather than
     deciding immediately that the link was bad. */
  useEffect(() => {
    if (!supabase) return

    let cancelled = false

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setReady(data.session ? 'ready' : 'no-session')
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!cancelled && session) setReady('ready')
    })

    return () => {
      cancelled = true
      listener.subscription.unsubscribe()
    }
  }, [])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('Please use at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('The two passwords do not match.')
      return
    }

    setBusy(true)
    const { error: updateError } = await updatePassword(password)
    setBusy(false)

    if (updateError) {
      setError(updateError)
      return
    }
    setDone(true)
  }

  if (done) {
    return (
      <div className="stack center">
        <div style={{ fontSize: '2rem' }}>✅</div>
        <h1>Password changed</h1>
        <p className="muted">
          You are signed in already. Use your new password the next time you come back.
        </p>
        <Button variant="primary" block onClick={() => navigate('/portal')}>
          Go to my portal
        </Button>
      </div>
    )
  }

  if (ready === 'checking') {
    return (
      <div className="stack center" role="status" aria-live="polite">
        <span className="muted">Checking your link…</span>
      </div>
    )
  }

  if (ready === 'no-session') {
    return (
      <div className="stack">
        <h1>This link has expired</h1>
        <p className="muted">
          Reset links can only be used once, and they stop working after a short time. Request a new
          one and it will arrive within a minute.
        </p>
        <Link to="/forgot-password">
          <Button variant="primary" block>
            Send me a new link
          </Button>
        </Link>
        <p className="small center">
          <Link to="/login" style={{ color: 'var(--text-brand)' }}>
            Back to sign in
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div className="stack">
      <div>
        <h1>Choose a new password</h1>
        <p className="muted" style={{ marginTop: 'var(--space-2)' }}>
          Pick something you have not used on another site.
        </p>
      </div>

      <form className="stack" onSubmit={handleSubmit}>
        <div className="field">
          <label className="field__label" htmlFor="newPassword">
            New password
          </label>
          <input
            id="newPassword"
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
            Confirm new password
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
          {busy ? 'Saving…' : 'Save new password'}
        </Button>
      </form>
    </div>
  )
}
