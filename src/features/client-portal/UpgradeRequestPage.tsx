import { type FormEvent, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { currency } from '@/lib/format'
import { FormError } from '@/components/ui/FormError'
import { useMyProject, useRequestUpgrade } from '@/lib/queries/client-portal'

/* ============================================================================
   UpgradeRequestPage — "System Expansion / Upgrade Request" from the spec.
   ----------------------------------------------------------------------------
   COMMERCIALLY THIS IS A LEAD, NOT A SUPPORT TICKET — which is why it does not
   live under Support. Submitting it creates a CRM lead with:

       source = 'referral'  (an existing customer, so scored high)
       stage  = 'new'

   and it lands on /admin/crm beside brand-new prospects. Expansion sales have
   the shortest cycle in the business: the roof is surveyed, the client is
   known, and the existing array documents itself.
   ========================================================================== */

const REASONS = [
  { value: 'more_consumption', label: 'My bill went up (new appliance, aircon, EV)' },
  { value: 'battery', label: 'I want to add battery backup' },
  { value: 'expansion', label: 'I want more panels for a bigger offset' },
  { value: 'new_property', label: 'I want a system at another property' },
]

export function UpgradeRequestPage() {
  const [submitted, setSubmitted] = useState(false)
  const projectQuery = useMyProject()
  const project = projectQuery.data

  /* The handler was `e.preventDefault(); setSubmitted(true)` - a confirmation
     screen for a request that reached nobody. */
  const requestUpgrade = useRequestUpgrade()

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)

    /* The bill is typed by a person into a field hinted "e.g. PHP 4,200", so
       it arrives with a peso sign, commas, or both. Strip anything that is not
       a digit or a decimal point rather than sending NaN. */
    const rawBill = String(form.get('newBill') ?? '').replace(/[^\d.]/g, '')
    const monthlyBill = rawBill ? Number(rawBill) : undefined

    requestUpgrade.mutate(
      {
        reason: String(form.get('reason') ?? 'not stated'),
        monthlyBill: Number.isFinite(monthlyBill) ? monthlyBill : undefined,
        details: String(form.get('upgDetails') ?? ''),
      },
      { onSuccess: () => setSubmitted(true) },
    )
  }

  if (submitted) {
    return (
      <>
        <PageHeader
          title="Request submitted"
          breadcrumbs={[{ label: 'Portal', to: '/portal' }, { label: 'Upgrade' }]}
        />
        <Card>
          <CardBody className="center">
            <div style={{ fontSize: '3rem' }}>🎉</div>
            <h3 style={{ marginBlock: 'var(--space-4)' }}>We will be in touch</h3>
            <p className="muted" style={{ maxWidth: '52ch', marginInline: 'auto' }}>
              A sales engineer will review your existing system and come back with expansion options
              within two business days. Because we already have your site survey on file, this is
              usually much faster than a new installation.
            </p>
          </CardBody>
        </Card>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Request a system upgrade"
        description="Expanding an existing array is faster and cheaper than starting from scratch."
        breadcrumbs={[{ label: 'Portal', to: '/portal' }, { label: 'Upgrade' }]}
      />

      <div className="grid grid--2" style={{ alignItems: 'start' }}>
        <Card>
          <CardHeader title="Tell us what you need" />
          <CardBody>
            <form className="stack" onSubmit={handleSubmit}>
              <div className="field">
                <span className="field__label">What has changed?</span>
                <div className="stack stack--sm">
                  {REASONS.map((reason) => (
                    <label
                      key={reason.value}
                      className="row"
                      style={{
                        padding: 'var(--space-3)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius)',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="radio"
                        name="reason"
                        defaultChecked={reason.value === 'more_consumption'}
                      />
                      <span className="small">{reason.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="newBill">
                  Your current monthly bill
                </label>
                <input id="newBill" name="newBill" className="input" placeholder="e.g. ₱4,200" />
                <span className="field__hint">
                  What you pay now, after your existing system's offset.
                </span>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="upgDetails">
                  Anything else?
                </label>
                <textarea
                  id="upgDetails"
                  name="upgDetails"
                  className="textarea"
                  placeholder="e.g. installing an EV charger next month, want backup for the fridge and router during brownouts"
                />
              </div>

              <FormError error={requestUpgrade.error} />

              <Button
                type="submit"
                variant="primary"
                block
                size="lg"
                disabled={requestUpgrade.isPending}
              >
                {requestUpgrade.isPending ? 'Sending…' : 'Submit upgrade request'}
              </Button>
            </form>
          </CardBody>
        </Card>

        <div className="stack">
          {/* Only shown once there is an installation to expand. A prospect
              can still submit this form before their first system exists. */}
          {project && (
            <Card>
              <CardHeader title="Your current system" />
              <CardBody>
                <div className="stack stack--sm">
                  <div className="row row--between">
                    <span className="muted">Reference</span>
                    <span className="strong">{project.reference}</span>
                  </div>
                  <div className="row row--between">
                    <span className="muted">Size</span>
                    <span className="strong">{project.systemKw} kW</span>
                  </div>
                  <div className="row row--between">
                    <span className="muted">Original contract</span>
                    <span className="strong num">{currency(project.contractValue)}</span>
                  </div>
                  <div className="row row--between">
                    <span className="muted">Address</span>
                    <span className="strong small" style={{ textAlign: 'right', maxWidth: '22ch' }}>
                      {project.address}
                    </span>
                  </div>
                </div>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Why upgrading is easier" />
            <CardBody>
              <ul className="pkg__features">
                <li>Your roof is already surveyed and structurally assessed</li>
                <li>Existing racking often accommodates extra panels</li>
                <li>Net-metering application is an amendment, not a new filing</li>
                <li>Same warranty terms extend to the added hardware</li>
                <li>Typically 1–2 days of installation instead of three</li>
              </ul>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  )
}
