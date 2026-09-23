import { type FormEvent, useState } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { FormError } from '@/components/ui/FormError'
import { Modal } from '@/components/ui/Modal'
import { useAuth } from '@/app/auth/useAuth'
import { useChangePassword, useMyTimeLogs, useOfflineQueue } from '@/lib/queries/field'
import { useRaiseTicket } from '@/lib/queries/client-portal'
import { dateTime, relative } from '@/lib/format'
import { ROLE_LABEL } from '@/lib/labels'

/* ============================================================================
   FieldAccountPage — profile, sync status and sign-out.
   ----------------------------------------------------------------------------
   The sync panel is the important part. A technician needs to KNOW whether
   their morning's work has reached the office before they drive away from a
   site — an app that silently holds unsynced data is worse than no app.

   Time-log summary feeds the payroll module; it is shown here so a technician
   can sanity-check their own hours before payday rather than disputing them
   after.
   ========================================================================== */

export function FieldAccountPage() {
  const { user, signOut } = useAuth()
  const { queue, pending, isOnline, syncing, lastSync, sync } = useOfflineQueue()
  const timeQuery = useMyTimeLogs()
  const time = timeQuery.data

  /* Three buttons on this card did nothing at all. A technician cannot get to
     a desktop to change a password, has no other copy of the safety rules on
     site, and had no route at all for telling the office the app is broken -
     which is the report that matters most, because they are the only ones who
     ever see it fail on a bad connection. */
  const [panel, setPanel] = useState<'password' | 'safety' | 'problem' | null>(null)
  const changePassword = useChangePassword()
  const reportProblem = useRaiseTicket()
  const [done, setDone] = useState<string | null>(null)

  function closePanel() {
    setPanel(null)
    setDone(null)
    changePassword.reset()
    reportProblem.reset()
  }

  function handlePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const password = String(form.get('password') ?? '')

    if (password !== String(form.get('confirm') ?? '')) {
      setDone('mismatch')
      return
    }

    setDone(null)
    changePassword.mutate({ password }, { onSuccess: () => setDone('password') })
  }

  function handleProblem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)

    /* Raised as a normal ticket against the technician's own profile, so it
       lands in the same queue the office already works and they can still see
       it themselves. A separate reporting channel would be one more inbox
       nobody reads. */
    reportProblem.mutate(
      {
        subject: String(form.get('subject') ?? ''),
        description: String(form.get('detail') ?? ''),
        category: 'other',
        priority: 'normal',
      },
      { onSuccess: () => setDone('problem') },
    )
  }

  return (
    <div className="stack">
      <div>
        <h1 style={{ fontSize: 'var(--text-xl)' }}>Account</h1>
      </div>

      <Card>
        <CardBody>
          <div className="row">
            <span className="avatar" style={{ width: 52, height: 52, fontSize: 'var(--text-lg)' }}>
              {user?.avatarInitials}
            </span>
            <div>
              <div className="strong">{user?.fullName}</div>
              <div className="small muted">{user && ROLE_LABEL[user.role]}</div>
              <div className="xs dim">{user?.email}</div>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* ------------------------------------------------ SYNC STATUS */}
      <Card>
        <CardBody>
          <div className="row row--between" style={{ marginBottom: 'var(--space-3)' }}>
            <h3 style={{ fontSize: 'var(--text-base)' }}>Sync status</h3>
            <Badge tone={pending === 0 ? 'success' : 'warning'}>
              {pending === 0 ? 'All synced' : `${pending} pending`}
            </Badge>
          </div>

          <div className="stack stack--sm">
            <div className="row row--between small">
              <span className="muted">Connection</span>
              <span
                className="strong"
                style={{ color: isOnline ? 'var(--success-fg)' : 'var(--danger-fg)' }}
              >
                {isOnline ? '● Online' : '● Offline'}
              </span>
            </div>
            <div className="row row--between small">
              <span className="muted">Last successful sync</span>
              <span className="strong">
                {lastSync ? dateTime(lastSync) : 'Not yet this session'}
              </span>
            </div>
            <div className="row row--between small">
              <span className="muted">Waiting to send</span>
              <span className="strong">{pending}</span>
            </div>
          </div>

          {/* Naming each queued item matters. "2 pending" tells a technician
              nothing; "DC Wiring -> done" tells them exactly what the office has
              not seen yet, and whether it is safe to drive away. */}
          {queue.length > 0 && (
            <div
              className="stack stack--sm"
              style={{
                marginTop: 'var(--space-4)',
                padding: 'var(--space-3)',
                background: 'var(--warning-bg)',
                borderRadius: 'var(--radius)',
              }}
            >
              <div className="xs strong" style={{ color: 'var(--warning-fg)' }}>
                SAVED ON THIS PHONE, NOT YET SENT
              </div>
              {queue.map((item) => (
                <div key={item.id} className="row row--between xs">
                  <span>{item.label}</span>
                  <span className="dim">{relative(item.queuedAt)}</span>
                </div>
              ))}
            </div>
          )}

          <Button
            variant="primary"
            block
            style={{ marginTop: 'var(--space-4)' }}
            disabled={syncing || pending === 0 || !isOnline}
            onClick={() => void sync()}
          >
            {syncing ? 'Syncing…' : pending === 0 ? '✓ Everything is synced' : '⟳ Sync now'}
          </Button>

          <p className="xs dim" style={{ marginTop: 'var(--space-3)' }}>
            {isOnline
              ? 'Check this before leaving a site with no signal. Anything listed above has not yet reached the office.'
              : 'You are offline. Your work is saved on this phone and will send itself as soon as you have signal again.'}
          </p>
        </CardBody>
      </Card>

      {/* --------------------------------------------- TIME SUMMARY */}
      <Card>
        <CardBody>
          <h3 style={{ fontSize: 'var(--text-base)', marginBottom: 'var(--space-3)' }}>
            This period
          </h3>
          <div className="stack stack--sm">
            <div className="row row--between small">
              <span className="muted">Regular hours</span>
              <span className="strong num">{time?.regularHours ?? 0}</span>
            </div>
            <div className="row row--between small">
              <span className="muted">Overtime hours</span>
              <span
                className="strong num"
                style={{
                  color: (time?.overtimeHours ?? 0) > 0 ? 'var(--warning-fg)' : undefined,
                }}
              >
                {time?.overtimeHours ?? 0}
              </span>
            </div>
            <div className="row row--between small">
              <span className="muted">Jobs logged</span>
              <span className="strong num">{time?.jobsCompleted ?? 0}</span>
            </div>
          </div>
          <p className="xs dim" style={{ marginTop: 'var(--space-3)' }}>
            Hours come from your job check-ins. Raise anything that looks wrong with the office
            before the payroll cut-off.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <div className="stack stack--sm">
            <Button variant="outline" block onClick={() => setPanel('password')}>
              Change password
            </Button>
            <Button variant="outline" block onClick={() => setPanel('safety')}>
              Safety documents
            </Button>
            <Button variant="outline" block onClick={() => setPanel('problem')}>
              Report an app problem
            </Button>
            <Button variant="danger" block onClick={signOut}>
              Sign out
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* ------------------------------------------- CHANGE PASSWORD */}
      <Modal open={panel === 'password'} onClose={closePanel} title="Change password">
        {done === 'password' ? (
          <div className="stack stack--sm">
            <div style={{ fontSize: '1.75rem' }}>✅</div>
            <h4 style={{ margin: 0 }}>Password changed</h4>
            <p className="small muted">
              Use the new one next time you sign in. You are still signed in on this device.
            </p>
            <Button variant="outline" block onClick={closePanel}>
              Done
            </Button>
          </div>
        ) : (
          <form className="stack" onSubmit={handlePassword}>
            <div className="field">
              <label className="field__label" htmlFor="new-pw">
                New password
              </label>
              <input
                id="new-pw"
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
              <label className="field__label" htmlFor="confirm-pw">
                Type it again
              </label>
              <input
                id="confirm-pw"
                name="confirm"
                className="input"
                type="password"
                required
                autoComplete="new-password"
              />
            </div>

            {done === 'mismatch' && (
              <p className="small" style={{ color: 'var(--danger-fg)' }}>
                Those two do not match.
              </p>
            )}

            <FormError error={changePassword.error} />

            <Button type="submit" variant="primary" block disabled={changePassword.isPending}>
              {changePassword.isPending ? 'Saving…' : 'Change it'}
            </Button>
          </form>
        )}
      </Modal>

      {/* -------------------------------------------- SAFETY BRIEFING
          Written into the page rather than fetched. A technician standing on a
          roof with one bar of signal is exactly who needs this, and exactly
          who cannot download a PDF. It costs nothing to ship and works with
          the connection off entirely. */}
      <Modal open={panel === 'safety'} onClose={closePanel} title="Safety documents">
        <div className="stack stack--sm">
          <p className="small muted">
            The standing site rules. Available with the connection off — nothing here is fetched.
          </p>

          {[
            {
              title: 'Before you go up',
              points: [
                'Harness, lanyard and anchor point inspected and in date.',
                'Ladder tied off at the top and extending a metre past the edge.',
                'Wet or windy: stop. A postponed job costs less than a fall.',
              ],
            },
            {
              title: 'Working on DC',
              points: [
                'Panels generate whenever there is light. There is no off switch on the array.',
                'Open the AC breaker first, then the DC isolator, then verify dead at the terminals.',
                'Never break a live DC connector — the arc does not self-extinguish.',
              ],
            },
            {
              title: 'Batteries',
              points: [
                'No metal tools resting on top of a battery bank. Ever.',
                'Lithium unit swollen, hot or venting: evacuate, do not douse, call the office.',
              ],
            },
            {
              title: 'If something goes wrong',
              points: [
                'Make the area safe first. The job can wait; nothing here cannot.',
                'Call the office on +63 917 555 0142 before you call anyone else.',
                'Photograph the scene once it is safe — it is what the incident report needs.',
              ],
            },
          ].map((section) => (
            <div key={section.title}>
              <h4 style={{ fontSize: 'var(--text-base)' }}>{section.title}</h4>
              <ul className="small muted" style={{ marginTop: 'var(--space-1)', paddingLeft: 18 }}>
                {section.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>
          ))}

          <Button variant="outline" block onClick={closePanel}>
            Close
          </Button>
        </div>
      </Modal>

      {/* ------------------------------------------ REPORT A PROBLEM */}
      <Modal open={panel === 'problem'} onClose={closePanel} title="Report an app problem">
        {done === 'problem' ? (
          <div className="stack stack--sm">
            <div style={{ fontSize: '1.75rem' }}>✅</div>
            <h4 style={{ margin: 0 }}>Sent to the office</h4>
            <p className="small muted">
              It is in the support queue with your name on it. You can follow it up with the
              coordinator if it is stopping you working.
            </p>
            <Button variant="outline" block onClick={closePanel}>
              Done
            </Button>
          </div>
        ) : (
          <form className="stack" onSubmit={handleProblem}>
            <div className="field">
              <label className="field__label" htmlFor="prob-subject">
                What went wrong
              </label>
              <input
                id="prob-subject"
                name="subject"
                className="input"
                required
                placeholder="Photos will not upload on site"
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="prob-detail">
                What were you doing at the time?
              </label>
              <textarea id="prob-detail" name="detail" className="textarea" rows={4} required />
              <span className="field__hint">
                The screen you were on and whether you had signal is usually enough to find it.
              </span>
            </div>

            <FormError error={reportProblem.error} />

            <Button type="submit" variant="primary" block disabled={reportProblem.isPending}>
              {reportProblem.isPending ? 'Sending…' : 'Send it'}
            </Button>
          </form>
        )}
      </Modal>
    </div>
  )
}
