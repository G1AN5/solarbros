import { Link, useParams } from 'react-router-dom'

import { useCompany } from '@/lib/queries/public-site'

/* ============================================================================
   LegalPage — one route serving privacy policy, terms and warranty terms.
   ----------------------------------------------------------------------------
   The spec listed "Legal info" as a single landing-page bullet. In practice
   that is three separate documents, all with identical layout — so they share
   one route (/legal/:document) rather than three near-identical components.

   ⚠️ The text below is PLACEHOLDER SCAFFOLDING, not legal advice. Have counsel
   draft the real documents; a Philippine solar installer's privacy policy also
   needs to satisfy the Data Privacy Act (RA 10173).
   ========================================================================== */

/* Built from the live company profile, so the warranty term quoted in the legal
   copy always matches the one configured in settings and shown on the site. */
function buildDocuments(company: {
  warrantyPanelYears: number
  name: string
  email: string
}): Record<string, { title: string; sections: { heading: string; body: string }[] }> {
  return {
    privacy: {
      title: 'Privacy Policy',
      sections: [
        {
          heading: 'What we collect',
          body: 'Contact details you submit through the estimator, booking and quotation forms; property details needed to size a system; and account activity within the client portal.',
        },
        {
          heading: 'Why we collect it',
          body: 'To prepare quotations, schedule site visits, deliver and support your installation, and meet our record-keeping obligations.',
        },
        {
          heading: 'Who we share it with',
          body: 'Distribution utilities for net-metering applications, equipment suppliers for warranty registration, and financing partners only where you have applied for financing.',
        },
        {
          heading: 'Your rights',
          body: 'Under the Data Privacy Act of 2012 (RA 10173) you may access, correct, or request erasure of your personal data. Contact our Data Protection Officer at the address below.',
        },
        {
          heading: 'Retention',
          body: 'Project and warranty records are retained for the life of the warranty plus the period required by tax and corporate law.',
        },
      ],
    },
    terms: {
      title: 'Terms of Service',
      sections: [
        {
          heading: 'Scope',
          body: 'These terms govern use of this website, the client portal, and the estimator tool. Installation work is governed separately by your signed contract.',
        },
        {
          heading: 'Estimates are indicative',
          body: 'Figures produced by the online estimator are indicative only, based on stated assumptions. The binding figure is the one in your signed quotation following a site survey.',
        },
        {
          heading: 'Account security',
          body: 'You are responsible for keeping your portal credentials confidential and for activity under your account.',
        },
        {
          heading: 'Booking and cancellation',
          body: 'Appointments may be rescheduled free of charge with at least 24 hours notice.',
        },
        {
          heading: 'Limitation of liability',
          body: 'Nothing in these terms limits liability that cannot be limited under Philippine law.',
        },
      ],
    },
    warranty: {
      title: 'Warranty Terms',
      sections: [
        {
          heading: 'Panel performance warranty',
          body: `${company.warrantyPanelYears}-year manufacturer performance warranty, honoured through us as the installing partner.`,
        },
        {
          heading: 'Inverter warranty',
          body: '5 to 10 years depending on the brand and model installed. The exact term for your unit is recorded against its serial number in your portal.',
        },
        {
          heading: 'Battery warranty',
          body: '10 years or a stated cycle count, whichever comes first.',
        },
        {
          heading: 'Workmanship warranty',
          body: '2 years covering installation defects, mounting integrity and wiring.',
        },
        {
          heading: 'What is not covered',
          body: 'Damage from force majeure, third-party modification, or failure to carry out required preventive maintenance.',
        },
        {
          heading: 'Transfers',
          body: 'Warranties transfer to a new property owner at no cost. Submit a transfer request from the client portal and we process it within five business days.',
        },
      ],
    },
  }
}

export function LegalPage() {
  const COMPANY = useCompany()
  const DOCUMENTS = buildDocuments(COMPANY)

  const { document: docKey } = useParams<{ document: string }>()
  const doc = docKey ? DOCUMENTS[docKey] : undefined

  if (!doc) {
    return (
      <div className="section">
        <div className="container container--narrow">
          <h1>Document not found</h1>
          <p className="muted" style={{ marginBlock: 'var(--space-4)' }}>
            Available documents:
          </p>
          <ul className="stack stack--sm">
            {Object.entries(DOCUMENTS).map(([key, value]) => (
              <li key={key}>
                <Link to={`/legal/${key}`} style={{ color: 'var(--text-brand)', fontWeight: 600 }}>
                  {value.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    )
  }

  return (
    <div className="section">
      <div className="container container--narrow">
        <span className="eyebrow">Legal</span>
        <h1 style={{ marginBlock: 'var(--space-3)' }}>{doc.title}</h1>
        <p className="small dim">
          Last updated {new Date().toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}
        </p>

        {/* Visible reminder so placeholder text never reaches production unnoticed. */}
        <div
          style={{
            marginBlock: 'var(--space-6)',
            padding: 'var(--space-4)',
            background: 'var(--warning-bg)',
            color: 'var(--warning-fg)',
            borderRadius: 'var(--radius)',
            fontSize: 'var(--text-sm)',
          }}
        >
          ⚠ Placeholder content. Replace with the version drafted by legal counsel before launch.
        </div>

        <div className="stack stack--lg">
          {doc.sections.map((section) => (
            <section key={section.heading}>
              <h3>{section.heading}</h3>
              <p className="muted" style={{ marginTop: 'var(--space-2)', lineHeight: 1.7 }}>
                {section.body}
              </p>
            </section>
          ))}
        </div>

        <hr style={{ marginBlock: 'var(--space-10)' }} />

        <div className="row row--wrap">
          {Object.entries(DOCUMENTS)
            .filter(([key]) => key !== docKey)
            .map(([key, value]) => (
              <Link key={key} to={`/legal/${key}`} className="btn btn--outline btn--sm">
                {value.title}
              </Link>
            ))}
        </div>
      </div>
    </div>
  )
}
