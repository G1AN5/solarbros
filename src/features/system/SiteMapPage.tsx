import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/Badge'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { ADMIN_NAV, CLIENT_NAV, FIELD_NAV, PUBLIC_NAV } from '@/app/navigation'
import { ROLE_LABEL } from '@/lib/labels'
import type { UserRole } from '@/types/domain'

/* ============================================================================
   SiteMapPage — a rendered map of the whole application. (/site-map)
   ----------------------------------------------------------------------------
   A REVIEW TOOL, not a customer-facing page. It exists so the structure can be
   discussed without clicking through fifty screens, and so nobody has to read
   router.tsx to understand how the portals relate.

   Everything here is generated from src/app/navigation.ts, so it cannot go
   stale: add a page to the nav config and it appears on this map automatically.
   ========================================================================== */

/* The cross-portal data flows. This is the part a spec document usually gets
   wrong — it is where most of the system's real complexity lives. */
const DATA_FLOWS = [
  {
    trigger: 'Visitor completes the solar estimator',
    from: '/estimator',
    to: '/admin/crm',
    effect: "Creates a lead (source 'estimator', stage 'new') and emails a PDF quotation.",
  },
  {
    trigger: 'Visitor requests a personalised quote',
    from: '/contact',
    to: '/admin/crm',
    effect: "Creates a higher-intent lead (source 'quote_request').",
  },
  {
    trigger: 'Visitor books a consultation or survey',
    from: '/booking',
    to: '/admin/dispatch',
    effect: "Creates an appointment with status 'requested', awaiting crew assignment.",
  },
  {
    trigger: 'Sales rep builds a quote from a package',
    from: '/admin/quotes',
    to: '/admin/inventory',
    effect: 'Generates the Bill of Materials and checks stock availability.',
  },
  {
    trigger: 'Contract is signed (lead reaches stage “contract”)',
    from: '/admin/crm',
    to: '/admin/projects',
    effect: 'Creates the project, reserves stock against the BOM, issues the down-payment invoice.',
  },
  {
    trigger: 'Coordinator assigns a crew to an appointment',
    from: '/admin/dispatch',
    to: '/field',
    effect: "Appointment status becomes 'dispatched' and appears on the technician's Today list.",
  },
  {
    trigger: 'Technician ticks a milestone complete',
    from: '/field/jobs/:id',
    to: '/portal/project + /admin/projects',
    effect:
      "Single write updates the customer's progress bar AND operations. Fires a milestone notification.",
  },
  {
    trigger: 'Technician scans hardware serial numbers',
    from: '/field/logging',
    to: '/admin/assets + /portal/warranty',
    effect: 'Creates asset registry rows; the client sees their registered warranties.',
  },
  {
    trigger: 'Technician logs consumed materials',
    from: '/field/logging',
    to: '/admin/inventory',
    effect: 'Deducts on-hand stock and clears the reservation.',
  },
  {
    trigger: 'Milestone “commissioning” completes',
    from: '/field',
    to: '/admin/finance',
    effect: 'Triggers the final staged invoice automatically.',
  },
  {
    trigger: 'Client raises a support ticket',
    from: '/portal/tickets',
    to: '/admin/tickets',
    effect: 'Enters the triage queue; may become a dispatched repair visit.',
  },
  {
    trigger: 'Client requests a warranty transfer',
    from: '/portal/warranty',
    to: '/admin/warranty',
    effect: 'Enters the approval queue; approval rewrites asset ownership and is audited.',
  },
  {
    trigger: 'Client requests a system upgrade',
    from: '/portal/upgrade',
    to: '/admin/crm',
    effect: "Creates a new lead (source 'referral') — an expansion sale, not a support case.",
  },
  {
    trigger: 'Any privileged action, anywhere',
    from: 'All modules',
    to: '/admin/audit',
    effect: 'Written by database triggers to an append-only audit table.',
  },
]

/* Spec bullets that were consolidated rather than built as separate pages. */
const CONSOLIDATIONS = [
  {
    merged: 'Four separate "calendar scheduling systems"',
    into: 'One appointments model with four views',
    why: 'The spec listed a calendar under all four portals. They are the same records seen by different audiences — public booking, client portal, admin dispatch, technician schedule. Separate systems would need constant reconciliation.',
  },
  {
    merged: '"Compare packages toggle" + "System comparison table" + "Packages pricing"',
    into: 'One /packages page with a card ⇄ table toggle plus an architecture comparison',
    why: 'A visitor decides "which package" and "which system type" in the same sitting. Splitting them across pages forces back-and-forth.',
  },
  {
    merged: '"Support ticketing" + "Preventive maintenance & ticketing"',
    into: 'One tickets model with a category field',
    why: 'A maintenance request and a fault report follow the same triage-assign-dispatch-resolve lifecycle.',
  },
  {
    merged: '"Asset & Document Vault" + "Warranty & Asset Registry" + "Media/hardware logging"',
    into: 'Separate `documents` (files) and `serialized_assets` (hardware) models',
    why: 'These were one bullet but are genuinely two things: files a client downloads, and physical units with serial numbers. Splitting them was necessary; conflating them would have made warranty tracking impossible.',
  },
  {
    merged: '"Projects Portfolio" (public) vs "Projects" (admin)',
    into: 'Deliberately kept SEPARATE',
    why: 'Portfolio is curated marketing content with consented photos. Operational projects contain addresses and contract values. Wiring them together would leak customer data onto the public internet.',
  },
  {
    merged: '"Solar estimator" + "Request personalised quotation"',
    into: 'Two entry points into one lead funnel',
    why: 'Different intent levels feeding the same CRM pipeline — the source field distinguishes them for lead scoring.',
  },
  {
    merged: '"How it works" + "Flexible payment options" + "Lifetime after-sales support"',
    into: 'One /how-it-works page with three sections',
    why: 'All three answer the same customer question: "what happens after I say yes?"',
  },
]

const PORTALS = [
  {
    name: 'Public Web Platform',
    path: '/',
    audience: 'Anyone (unauthenticated)',
    purpose: 'Lead generation — capture prospects and funnel them into the CRM.',
    tone: 'info' as const,
    items: PUBLIC_NAV.map((item) => ({
      label: item.label,
      to: item.to,
      description: item.description,
    })),
  },
  {
    name: 'Client Self-Service Portal',
    path: '/portal',
    audience: 'Client',
    purpose: 'Transparency — answer customer questions without a phone call.',
    tone: 'success' as const,
    items: CLIENT_NAV.flatMap((group) => group.items),
  },
  {
    name: 'Enterprise Operations Hub',
    path: '/admin',
    audience: 'Sales · Engineer · Inventory · Accountant · Admin',
    purpose: 'Run the business — CRM, projects, dispatch, supply chain, finance, governance.',
    tone: 'brand' as const,
    items: ADMIN_NAV.flatMap((group) => group.items),
  },
  {
    name: 'Field Technician Portal',
    path: '/field',
    audience: 'Technician',
    purpose: 'Capture accurate data at the job site, in real time, offline-tolerant.',
    tone: 'warning' as const,
    items: FIELD_NAV,
  },
]

export function SiteMapPage() {
  return (
    <div className="section">
      <div className="container">
        <div className="section-head">
          <span className="eyebrow">Development reference</span>
          <h1>Application map</h1>
          <p>
            Every screen, who can reach it, and how data moves between the four portals. Generated
            from the navigation config, so it stays in sync with the code.
          </p>
        </div>

        {/* ------------------------------------------------ THE PORTALS */}
        <h2 style={{ marginBottom: 'var(--space-5)' }}>1. The four portals</h2>

        <div
          className="grid grid--2"
          style={{ marginBottom: 'var(--space-16)', alignItems: 'start' }}
        >
          {PORTALS.map((portal) => (
            <Card key={portal.path}>
              <CardHeader
                title={
                  <span className="row">
                    <Badge tone={portal.tone}>{portal.path}</Badge>
                    {portal.name}
                  </span>
                }
              />
              <CardBody>
                <p className="small muted">{portal.purpose}</p>
                <p className="xs dim" style={{ marginTop: 'var(--space-2)' }}>
                  <strong>Audience:</strong> {portal.audience}
                </p>

                <div className="stack stack--sm" style={{ marginTop: 'var(--space-4)' }}>
                  {portal.items.map((item) => (
                    <div key={item.to}>
                      <Link
                        to={item.to}
                        className="small strong"
                        style={{ color: 'var(--text-brand)' }}
                      >
                        {item.label}
                      </Link>
                      <span className="xs dim"> — {item.to}</span>
                      {item.description && (
                        <div className="xs dim" style={{ marginTop: 2 }}>
                          {item.description}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>

        {/* ------------------------------------------------ DATA FLOWS */}
        <h2 style={{ marginBottom: 'var(--space-3)' }}>2. How the portals connect</h2>
        <p className="muted" style={{ marginBottom: 'var(--space-5)', maxWidth: '80ch' }}>
          These flows are the actual system. Each row is an event in one portal that creates or
          changes a record another portal reads.
        </p>

        <div className="table-wrap" style={{ marginBottom: 'var(--space-16)' }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ minWidth: 220 }}>Trigger</th>
                <th>From</th>
                <th>To</th>
                <th style={{ minWidth: 280 }}>Effect</th>
              </tr>
            </thead>
            <tbody>
              {DATA_FLOWS.map((flow) => (
                <tr key={flow.trigger}>
                  <td className="strong small">{flow.trigger}</td>
                  <td>
                    <code className="xs">{flow.from}</code>
                  </td>
                  <td>
                    <code className="xs">{flow.to}</code>
                  </td>
                  <td className="small muted">{flow.effect}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* -------------------------------------------- CONSOLIDATIONS */}
        <h2 style={{ marginBottom: 'var(--space-3)' }}>3. Where the spec was consolidated</h2>
        <p className="muted" style={{ marginBottom: 'var(--space-5)', maxWidth: '80ch' }}>
          The uploaded requirements listed some capabilities several times under different portals.
          These are the merges (and one deliberate split), with the reasoning — worth reviewing in
          case any of it contradicts your intent.
        </p>

        <div className="stack" style={{ marginBottom: 'var(--space-16)' }}>
          {CONSOLIDATIONS.map((item) => (
            <Card key={item.merged}>
              <CardBody>
                <div className="small dim">{item.merged}</div>
                <div className="strong" style={{ marginBlock: 'var(--space-1)' }}>
                  ↳ {item.into}
                </div>
                <p className="small muted">{item.why}</p>
              </CardBody>
            </Card>
          ))}
        </div>

        {/* ------------------------------------------------- RBAC */}
        <h2 style={{ marginBottom: 'var(--space-5)' }}>4. Roles and where they land</h2>

        <div className="grid" style={{ marginBottom: 'var(--space-12)' }}>
          {(
            [
              ['client', '/portal', 'Their own project only'],
              ['technician', '/field', 'Only jobs assigned to them'],
              ['sales', '/admin', 'CRM, quotes, projects, tickets'],
              ['project_engineer', '/admin', 'Projects, dispatch, tickets, inventory'],
              ['inventory_manager', '/admin', 'Inventory, assets, warranty approvals'],
              ['accountant', '/admin', 'Finance, payroll, analytics'],
              ['admin', '/admin', 'Everything, including governance and audit'],
            ] as [UserRole, string, string][]
          ).map(([role, home, scope]) => (
            <Card key={role}>
              <CardBody>
                <div className="strong">{ROLE_LABEL[role]}</div>
                <code className="xs">{home}</code>
                <p className="small muted" style={{ marginTop: 'var(--space-2)' }}>
                  {scope}
                </p>
              </CardBody>
            </Card>
          ))}
        </div>

        <Card style={{ borderColor: 'var(--danger-solid)' }}>
          <CardBody>
            <h4>🔐 A standing reminder</h4>
            <p className="small muted" style={{ marginTop: 'var(--space-2)', maxWidth: '85ch' }}>
              Every role restriction in this application is currently navigation-level only. Before
              any real data goes in, each table needs Row Level Security policies in Postgres that
              enforce the same rules server-side. Client-side checks decide what to render; they
              cannot decide what a determined user is allowed to read.
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
