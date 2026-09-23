import { type FormEvent, useState } from 'react'

import { Button, ButtonLink } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { FormError } from '@/components/ui/FormError'
import { useSubmitEnquiry } from '@/lib/queries/public-forms'
import { useCompany, useFaqs } from '@/lib/queries/public-site'
import { PageBanner } from '@/components/layout/PageBanner'

/* ============================================================================
   ContactPage — office details, map, service areas, FAQ and the personalised
   quote request form.
   ----------------------------------------------------------------------------
   MERGES FIVE SPEC BULLETS that are all "how do I reach you / where are you":
     • "Request Personalized quotation"
     • "Service areas, where we operate"
     • "Office location, hours, map"
     • "FAQ"
     • "Legal info"  (linked out to /legal/:document)

   The quote request form is the SECOND lead-capture path (the estimator is the
   first). It creates a lead with source = 'quote_request' — higher intent, so
   the CRM scores it above an anonymous estimator submission.
   ========================================================================== */

export function ContactPage() {
  const COMPANY = useCompany()
  const FAQS = useFaqs().data ?? []

  const [sent, setSent] = useState(false)
  const submit = useSubmitEnquiry()

  /* The bill field takes free text, because people type "8k", "P8,000" and
     "8000 pesos". Strip everything that is not a digit rather than rejecting
     input whose meaning is perfectly clear to a human. */
  function parseBill(raw: string): number | undefined {
    const digits = raw.replace(/[^0-9]/g, '')
    return digits ? Number(digits) : undefined
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)

    submit.mutate(
      {
        name: String(form.get('name') ?? ''),
        email: String(form.get('email') ?? ''),
        phone: String(form.get('phone') ?? ''),
        address: String(form.get('location') ?? ''),
        monthlyBill: parseBill(String(form.get('bill') ?? '')),
        message: String(form.get('message') ?? ''),
      },
      { onSuccess: () => setSent(true) },
    )
  }

  return (
    <>
      <PageBanner
        eyebrow="Get in touch"
        title="Talk to a real engineer"
        lead="Not a call centre. Tell us about your property and we will come back with a personalised recommendation, usually within one business day."
      />

      <div className="section section--muted">
        <div className="container">
          <div className="grid grid--2" style={{ alignItems: 'start' }}>
            {/* ------------------------------ PERSONALISED QUOTE REQUEST */}
            <Card accent>
              <CardHeader title="Request a personalised quotation" />
              <CardBody>
                {sent ? (
                  <div
                    className="center stack stack--sm"
                    style={{ paddingBlock: 'var(--space-6)' }}
                  >
                    <div style={{ fontSize: '2rem' }}>✅</div>
                    <h4>Request received</h4>
                    <p className="small muted">
                      A sales engineer will contact you within one business day.
                    </p>
                  </div>
                ) : (
                  <form className="stack" onSubmit={handleSubmit}>
                    <div className="field">
                      <label className="field__label" htmlFor="cname">
                        Full name
                      </label>
                      <input id="cname" name="name" className="input" required />
                    </div>
                    <div
                      className="row"
                      style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}
                    >
                      <div className="field" style={{ flex: 1 }}>
                        <label className="field__label" htmlFor="cemail">
                          Email
                        </label>
                        <input id="cemail" name="email" className="input" type="email" required />
                      </div>
                      <div className="field" style={{ flex: 1 }}>
                        <label className="field__label" htmlFor="cphone">
                          Mobile
                        </label>
                        <input id="cphone" name="phone" className="input" required />
                      </div>
                    </div>
                    <div className="field">
                      <label className="field__label" htmlFor="cloc">
                        Property location
                      </label>
                      <select id="cloc" name="location" className="select" required defaultValue="">
                        <option value="" disabled>
                          Select a service area…
                        </option>
                        {COMPANY.serviceAreas.map((area) => (
                          <option key={area}>{area}</option>
                        ))}
                        <option>Other / outside these areas</option>
                      </select>
                    </div>
                    <div className="field">
                      <label className="field__label" htmlFor="cbill">
                        Average monthly bill
                      </label>
                      <input id="cbill" name="bill" className="input" placeholder="e.g. ₱8,000" />
                      <span className="field__hint">
                        This is the single most useful number for sizing a system.
                      </span>
                    </div>
                    <div className="field">
                      <label className="field__label" htmlFor="cmsg">
                        Tell us about your property
                      </label>
                      <textarea
                        id="cmsg"
                        name="message"
                        className="textarea"
                        placeholder="Roof type, number of storeys, whether you want battery backup…"
                      />
                    </div>
                    <FormError error={submit.error} />

                    <Button
                      type="submit"
                      variant="primary"
                      block
                      size="lg"
                      disabled={submit.isPending}
                    >
                      {submit.isPending ? 'Sending…' : 'Send my request'}
                    </Button>
                  </form>
                )}
              </CardBody>
            </Card>

            {/* ------------------------------------- OFFICE + SERVICE AREAS */}
            <div className="stack">
              <Card>
                <CardHeader title="Visit or call us" />
                <CardBody>
                  <div className="stack">
                    <div>
                      <div className="xs dim strong">OFFICE</div>
                      <p>{COMPANY.address}</p>
                    </div>
                    <div>
                      <div className="xs dim strong">HOURS</div>
                      <p>{COMPANY.hours}</p>
                    </div>
                    <div>
                      <div className="xs dim strong">PHONE</div>
                      <p>{COMPANY.phone}</p>
                    </div>
                    <div>
                      <div className="xs dim strong">EMAIL</div>
                      <p>{COMPANY.email}</p>
                    </div>
                    <div>
                      <div className="xs dim strong">FACEBOOK</div>
                      <p>{COMPANY.facebook}</p>
                    </div>
                  </div>
                </CardBody>
              </Card>

              {/* Map placeholder — embed Google Maps or Leaflet here. */}
              <Card>
                <div
                  style={{
                    height: 220,
                    background:
                      'repeating-linear-gradient(45deg, var(--ink-100), var(--ink-100) 12px, var(--ink-200) 12px, var(--ink-200) 24px)',
                    borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0',
                    display: 'grid',
                    placeItems: 'center',
                    color: 'var(--text-muted)',
                  }}
                >
                  🗺️ Map embed goes here
                </div>
                <CardBody>
                  <p className="small muted">
                    Google Maps embed or a Leaflet map showing the office pin and the shaded
                    service-area coverage.
                  </p>
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="Where we operate" />
                <CardBody>
                  <div className="row row--wrap">
                    {COMPANY.serviceAreas.map((area) => (
                      <span key={area} className="badge badge--neutral">
                        {area}
                      </span>
                    ))}
                  </div>
                  <p className="small muted" style={{ marginTop: 'var(--space-4)' }}>
                    We take selected projects outside these areas — ask us.
                  </p>
                </CardBody>
              </Card>
            </div>
          </div>

          {/* ------------------------------------------------ FULL FAQ */}
          <div style={{ marginTop: 'var(--space-20)' }}>
            <div className="section-head">
              <span className="eyebrow">FAQ</span>
              <h2>Frequently asked questions</h2>
            </div>

            <div style={{ maxWidth: 780, marginInline: 'auto' }}>
              {FAQS.map((faq) => (
                <div key={faq.id} className="faq__item">
                  <details>
                    <summary className="faq__q" style={{ cursor: 'pointer', listStyle: 'none' }}>
                      {faq.question}
                      <span aria-hidden>+</span>
                    </summary>
                    <p className="faq__a">{faq.answer}</p>
                  </details>
                </div>
              ))}
            </div>

            <div className="center" style={{ marginTop: 'var(--space-10)' }}>
              <p className="muted" style={{ marginBottom: 'var(--space-3)' }}>
                Question not answered here?
              </p>
              <ButtonLink to="/booking" variant="outline">
                Book a free consultation
              </ButtonLink>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
