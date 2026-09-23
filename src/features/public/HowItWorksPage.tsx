import { ButtonLink } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { useCompany } from '@/lib/queries/public-site'
import { PageBanner } from '@/components/layout/PageBanner'

/* ============================================================================
   HowItWorksPage — the full end-to-end process.
   ----------------------------------------------------------------------------
   Consolidates four spec bullets that all answer "what happens after I say yes?":
     • "How it works (Process from start to finish)"
     • "Flexible Payment options (Financing options, etc.)"
     • "Lifetime after-sales support"
     • "# of days to install"

   Deliberately maps each customer-facing step to the MILESTONE the client will
   later watch tick over in their portal — so the sales promise and the
   operational reality use the same vocabulary.
   ========================================================================== */

function buildStages(installDays: number) {
  return [
    {
      title: 'Free consultation',
      duration: 'Day 0',
      body: 'Virtual or on-site. We look at your last three bills, discuss goals and give an honest indication of size and budget.',
      milestone: null,
    },
    {
      title: 'Engineering survey',
      duration: 'Days 1–3',
      body: 'An engineer measures the roof, checks structural capacity, assesses shading and confirms your electrical panel can take the system.',
      milestone: 'Engineering Survey',
    },
    {
      title: 'Proposal & contract',
      duration: 'Days 3–7',
      body: 'A fixed-price quotation with the full bill of materials, panel layout drawing and a production forecast. Nothing gets added later.',
      milestone: null,
    },
    {
      title: 'Permits & net-metering',
      duration: 'Weeks 2–5',
      body: 'We prepare the electrical plans, secure the LGU permit and file the net-metering application with your distribution utility.',
      milestone: 'Permitting & Approvals',
    },
    {
      title: 'Installation',
      duration: `${installDays} working days`,
      body: 'Mounting, panels, DC and AC wiring. Your portal updates as each stage is signed off by the technician on site.',
      milestone: 'Structural Mounting → DC Wiring → AC Wiring',
    },
    {
      title: 'Testing & commissioning',
      duration: 'Final day',
      body: 'Full system test, safety checks, monitoring app setup, and a walkthrough so you know what every reading means.',
      milestone: 'Testing & Commissioning',
    },
    {
      title: 'Turnover & warranty',
      duration: 'Same day',
      body: 'You receive the turnover certificate, serialised warranty registration and all documentation in your portal vault.',
      milestone: 'Final Turnover',
    },
  ]
}

const AFTER_SALES = [
  {
    title: 'Client portal',
    body: 'Track your project live, download documents and raise tickets without phoning anyone.',
  },
  {
    title: 'Support ticketing',
    body: 'Report a fault with photos. We route it to a technician and you watch the resolution progress.',
  },
  {
    title: 'Preventive maintenance',
    body: 'Annual check-ups: panel cleaning, connection torque check, inverter log review.',
  },
  {
    title: 'Warranty transfers',
    body: 'Selling the property? Transfer the warranty to the new owner from inside your portal.',
  },
  {
    title: 'System expansion',
    body: 'Added an aircon or an EV? Request an upgrade and we size the extension against your existing array.',
  },
  {
    title: 'Monitoring',
    body: 'Live production data on your phone, with alerts if output drops unexpectedly.',
  },
]

export function HowItWorksPage() {
  const COMPANY = useCompany()
  const STAGES = buildStages(COMPANY.installDays)

  return (
    <>
      <PageBanner
        eyebrow="The process"
        title="From enquiry to switch-on"
        lead={`Most residential projects run 5-7 weeks end to end, with only ${COMPANY.installDays} of those days spent on your roof. Permitting is usually the longest stretch — and we handle it.`}
        stats={[
          { value: '5–7 weeks', label: 'Typical end to end' },
          { value: `${COMPANY.installDays} days`, label: 'On your roof' },
          { value: 'We file it', label: 'Permits & net-metering' },
        ]}
      />

      <div className="section section--muted">
        <div className="container">
          {/* Stage list. Each card names the portal milestone it corresponds to. */}
          <div className="stack" style={{ maxWidth: 860, marginInline: 'auto' }}>
            {STAGES.map((stage, i) => (
              <Card key={stage.title}>
                <CardBody>
                  <div className="row" style={{ alignItems: 'flex-start', gap: 'var(--space-5)' }}>
                    <div className="step__num" style={{ marginBottom: 0, flexShrink: 0 }}>
                      {i + 1}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div className="row row--between row--wrap">
                        <h4>{stage.title}</h4>
                        <span className="badge badge--neutral">{stage.duration}</span>
                      </div>
                      <p className="muted small" style={{ marginTop: 'var(--space-2)' }}>
                        {stage.body}
                      </p>
                      {stage.milestone && (
                        <p className="xs dim" style={{ marginTop: 'var(--space-2)' }}>
                          Portal milestone: <strong>{stage.milestone}</strong>
                        </p>
                      )}
                    </div>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>

          {/* ------------------------------------------- PAYMENT STRUCTURE */}
          <div style={{ marginTop: 'var(--space-20)' }}>
            <div className="section-head">
              <span className="eyebrow">Payment</span>
              <h2>You pay as the work completes</h2>
              <p>Three staged payments tied to real milestones — never one lump sum upfront.</p>
            </div>

            <div className="grid">
              <Card>
                <CardBody>
                  <span className="badge badge--brand">Stage 1</span>
                  <h4 style={{ marginTop: 'var(--space-2)' }}>Down payment — 50%</h4>
                  <p className="small muted" style={{ marginTop: 'var(--space-2)' }}>
                    On contract signing. Releases the equipment reservation and starts the
                    permitting work.
                  </p>
                </CardBody>
              </Card>
              <Card>
                <CardBody>
                  <span className="badge badge--brand">Stage 2</span>
                  <h4 style={{ marginTop: 'var(--space-2)' }}>Delivery — 35%</h4>
                  <p className="small muted" style={{ marginTop: 'var(--space-2)' }}>
                    When panels, inverter and racking arrive on site, before installation begins.
                  </p>
                </CardBody>
              </Card>
              <Card>
                <CardBody>
                  <span className="badge badge--brand">Stage 3</span>
                  <h4 style={{ marginTop: 'var(--space-2)' }}>Commissioning — 15%</h4>
                  <p className="small muted" style={{ marginTop: 'var(--space-2)' }}>
                    Only after the system is tested, working and you have signed the turnover
                    certificate.
                  </p>
                </CardBody>
              </Card>
            </div>

            <p className="center muted" style={{ marginTop: 'var(--space-6)' }}>
              Bank financing (12–36 months) and in-house instalment terms are also available for
              qualified clients.
            </p>
          </div>

          {/* --------------------------------------------- AFTER-SALES */}
          <div style={{ marginTop: 'var(--space-20)' }}>
            <div className="section-head">
              <span className="eyebrow">After-sales</span>
              <h2>Lifetime support</h2>
              <p>The relationship starts at turnover — it does not end there.</p>
            </div>

            <div className="grid">
              {AFTER_SALES.map((item) => (
                <Card key={item.title}>
                  <CardBody>
                    <h4>{item.title}</h4>
                    <p className="small muted" style={{ marginTop: 'var(--space-2)' }}>
                      {item.body}
                    </p>
                  </CardBody>
                </Card>
              ))}
            </div>
          </div>

          <div className="center" style={{ marginTop: 'var(--space-16)' }}>
            <ButtonLink to="/booking" variant="primary" size="lg">
              Start with a free consultation
            </ButtonLink>
          </div>
        </div>
      </div>
    </>
  )
}
