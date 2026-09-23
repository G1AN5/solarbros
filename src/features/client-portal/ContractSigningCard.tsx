import { type FormEvent, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { FormError } from '@/components/ui/FormError'
import { useAuth } from '@/app/auth/useAuth'
import { currency, date } from '@/lib/format'
import { useMyContracts, useSignContract } from '@/lib/queries/sales'

/* ============================================================================
   ContractSigningCard — where the customer signs.
   ----------------------------------------------------------------------------
   Renders nothing unless there is a contract waiting on them, which is most of
   the time. When there is, it is the most important thing on the screen: until
   it is signed there is no project, no schedule and no installation, so the
   customer's dashboard would otherwise say "no installation yet" and offer them
   no way to change that.

   WHY IT SITS ON THE DASHBOARD RATHER THAN ON ITS OWN PAGE
   A page has to be navigated to. The one action blocking everything else should
   be in front of the customer the moment they log in.

   WHAT THE SIGNATURE ACTUALLY IS
   A typed name plus a server-side timestamp, recorded against the contract. Not
   a drawn squiggle: a canvas signature looks more official and proves less,
   since it is trivially copied from a previous document and carries no
   provenance. What makes this defensible is that the customer authenticated,
   the timestamp came from the database rather than the browser, and the terms
   are shown on the same screen as the button.

   THE TERMS ARE DISPLAYED FROM THE CONTRACT ROW ITSELF, not from anything the
   page was passed. A customer must be agreeing to the figures the company holds
   — otherwise the two can differ and the signature is worthless.
   ========================================================================== */

export function ContractSigningCard() {
  const { user } = useAuth()
  const contractsQuery = useMyContracts(user?.id)
  const sign = useSignContract()

  const [confirmed, setConfirmed] = useState(false)
  const [justSigned, setJustSigned] = useState(false)

  const contracts = contractsQuery.data ?? []
  const awaiting = contracts.find((c) => c.status === 'awaiting_client')
  const pendingCounterSign = contracts.find((c) => c.status === 'awaiting_company')

  function handleSign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!awaiting) return
    const form = new FormData(event.currentTarget)

    sign.mutate(
      {
        contractId: awaiting.id,
        signatureName: String(form.get('signature') ?? ''),
      },
      { onSuccess: () => setJustSigned(true) },
    )
  }

  /* Signed and now with us. Shown so the customer knows the ball is in our
     court — silence after signing reads as "did that work?" and produces a
     phone call, which is the exact thing this portal exists to prevent. */
  if (justSigned || (pendingCounterSign && !awaiting)) {
    return (
      <Card style={{ marginBottom: 'var(--space-6)', borderColor: 'var(--success-solid)' }}>
        <CardBody>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <span style={{ fontSize: '1.5rem' }}>✅</span>
            <div>
              <h4 style={{ margin: 0 }}>Contract signed — thank you</h4>
              <p className="small muted" style={{ marginTop: 'var(--space-1)' }}>
                We are counter-signing it now. As soon as that is done your project is created, your
                equipment is reserved from our warehouse and your down-payment invoice appears under
                Billing. You will be notified.
              </p>
            </div>
          </div>
        </CardBody>
      </Card>
    )
  }

  if (!awaiting) return null

  const downPayment = (awaiting.contractValue * awaiting.downPaymentPct) / 100

  return (
    <Card accent style={{ marginBottom: 'var(--space-6)' }}>
      <CardHeader title="Your contract is ready to sign" />
      <CardBody>
        <p className="small muted" style={{ marginBottom: 'var(--space-4)' }}>
          Nothing starts until this is signed. Please read the terms below — they are the figures we
          hold on file, and they are what you are agreeing to.
        </p>

        <div
          className="stack stack--sm"
          style={{
            padding: 'var(--space-4)',
            background: 'var(--ink-50)',
            borderRadius: 'var(--radius)',
            marginBottom: 'var(--space-5)',
          }}
        >
          <div className="row row--between">
            <span className="muted small">Contract reference</span>
            <code>{awaiting.reference}</code>
          </div>
          <div className="row row--between">
            <span className="muted small">Total contract value</span>
            <span className="num strong">{currency(awaiting.contractValue)}</span>
          </div>
          <hr />
          <div className="row row--between">
            <span className="muted small">Due on signing ({awaiting.downPaymentPct}%)</span>
            <span className="num strong">{currency(downPayment)}</span>
          </div>
          <div className="row row--between">
            <span className="muted small">On equipment delivery ({awaiting.deliveryPct}%)</span>
            <span className="num">
              {currency((awaiting.contractValue * awaiting.deliveryPct) / 100)}
            </span>
          </div>
          <div className="row row--between">
            <span className="muted small">On commissioning ({awaiting.commissioningPct}%)</span>
            <span className="num">
              {currency((awaiting.contractValue * awaiting.commissioningPct) / 100)}
            </span>
          </div>
          <p className="xs dim" style={{ marginTop: 'var(--space-2)' }}>
            Issued {date(awaiting.createdAt)}. You will never be asked to pay more than the total
            above; each stage is invoiced only when that stage is reached.
          </p>
        </div>

        <form className="stack" onSubmit={handleSign}>
          <div className="field">
            <label className="field__label" htmlFor="signature">
              Type your full name to sign
            </label>
            <input
              id="signature"
              name="signature"
              className="input"
              required
              minLength={2}
              placeholder="Juan Dela Cruz"
              autoComplete="name"
            />
            <span className="field__hint">
              Signing records your name, the exact time, and that it came from your account. This is
              legally binding.
            </span>
          </div>

          <label className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span className="small">
              I have read and agree to the contract terms and the payment schedule above.
            </span>
          </label>

          <FormError error={sign.error} />

          <Button
            type="submit"
            variant="primary"
            block
            size="lg"
            disabled={!confirmed || sign.isPending}
          >
            {sign.isPending ? 'Signing…' : 'Sign contract'}
          </Button>
        </form>
      </CardBody>
    </Card>
  )
}
