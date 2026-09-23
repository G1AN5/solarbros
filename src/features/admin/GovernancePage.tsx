import { useState } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { QueryState } from '@/components/ui/QueryState'
import { Modal } from '@/components/ui/Modal'
import { usePendingStaff, useReviewStaffRegistration } from '@/lib/queries/staff-approval'
import { relative } from '@/lib/format'
import { ADMIN_NAV, CLIENT_NAV } from '@/app/navigation'
import { useAuth } from '@/app/auth/useAuth'
import { useSetStaffActive, useStaff } from '@/lib/queries/admin'
import { ROLE_LABEL } from '@/lib/labels'
import { STAFF_ROLES } from '@/types/domain'
import type { UserRole } from '@/types/domain'

/* ============================================================================
   GovernancePage — Role-Based Access Control (RBAC) settings.
   ----------------------------------------------------------------------------
   The matrix below is GENERATED from the `roles` field on each item in
   src/app/navigation.ts — it is not a hand-maintained copy. That means the
   documentation of who-can-see-what cannot drift out of sync with the actual
   navigation, which is the usual failure mode for permission tables.

   ⚠️⚠️ CRITICAL SECURITY NOTE ⚠️⚠️
   What this page controls is the NAVIGATION layer only. Hiding a menu item does
   not protect data — anyone can edit client-side JavaScript, or call the API
   directly with a valid token.

   REAL ENFORCEMENT MUST BE ROW LEVEL SECURITY IN POSTGRES. For every table,
   write policies that check the caller's role, e.g.:

       create policy "accountants read invoices"
       on invoices for select
       using (
         (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin','accountant')
       );

   Treat the matrix here as the SPEC the RLS policies must implement, and test
   the policies directly against the database — never through the UI alone.
   ========================================================================== */

const ALL_ROLES: UserRole[] = [...STAFF_ROLES, 'technician', 'client']

/* What an approval may grant. Deliberately excludes 'admin' — the first
   administrator is made by hand in Supabase and so is every later one, because
   an approval queue that can mint administrators is a queue worth attacking —
   and 'client', which is not a staff role. The database enforces both; this
   list only keeps them off the screen. */
const GRANTABLE_ROLES: UserRole[] = [
  'sales',
  'project_engineer',
  'inventory_manager',
  'accountant',
  'technician',
]

/** Flatten both navigation trees into one list of (module, allowed roles). */
const MODULES = [
  ...ADMIN_NAV.flatMap((group) =>
    group.items.map((item) => ({
      area: 'Operations Hub',
      group: group.heading,
      label: item.label,
      roles: item.roles ?? STAFF_ROLES,
    })),
  ),
  ...CLIENT_NAV.flatMap((group) =>
    group.items.map((item) => ({
      area: 'Client Portal',
      group: group.heading,
      label: item.label,
      roles: ['client'] as UserRole[],
    })),
  ),
  {
    area: 'Field Portal',
    group: 'Mobile',
    label: 'All field screens',
    roles: ['technician'] as UserRole[],
  },
]

export function GovernancePage() {
  const { user } = useAuth()
  const staffQuery = useStaff()
  const setActive = useSetStaffActive()

  /* Accounts are no longer created from this screen, and roles are no longer
     changed from it. Staff register themselves and an administrator confirms
     the role they claimed — see src/lib/queries/staff-approval.ts. */
  const pending = usePendingStaff().data ?? []
  const review = useReviewStaffRegistration()
  const [confirming, setConfirming] = useState<{
    id: string
    name: string
    email: string
    role: UserRole
    approve: boolean
  } | null>(null)

  /* The role actually being granted, which starts as the one they claimed.
     Separate state so the dialog can correct it without editing the record of
     what they asked for — the audit entry needs both. */
  const [grantRole, setGrantRole] = useState<UserRole | null>(null)

  return (
    <>
      <PageHeader
        title="Roles & access control"
        description="Which role may open which module across all four portals."
        actions={
          <>
            <ButtonLink to="/admin/audit" variant="outline">
              View audit log
            </ButtonLink>
            {pending.length > 0 && (
              <span className="badge badge--warning">{pending.length} awaiting approval</span>
            )}
          </>
        }
      />

      {/* ------------------------------------------ AWAITING APPROVAL */}
      {pending.length > 0 && (
        <Card style={{ marginBottom: 'var(--space-6)', borderColor: 'var(--warning-solid)' }}>
          <CardHeader
            title={`Staff registrations awaiting approval (${pending.length})`}
            action={<span className="xs dim">Nobody can sign in until you decide</span>}
          />
          <CardBody>
            <p className="small muted" style={{ marginBottom: 'var(--space-4)' }}>
              Each person registered themselves and said which role the company gave them. The claim
              grants nothing on its own — until you approve it the account is inactive and the
              database refuses it everything. Confirm the role is the one they were actually given.
            </p>

            <div className="stack stack--sm">
              {pending.map((person) => (
                <div key={person.id} className="row row--between row--wrap">
                  <div>
                    <span className="small strong">{person.fullName}</span>
                    <span className="xs dim" style={{ display: 'block' }}>
                      {person.email}
                      {person.phone ? ` · ${person.phone}` : ''} · registered{' '}
                      {relative(person.registeredAt)}
                    </span>
                  </div>

                  <div className="row">
                    <span className="badge badge--warning">
                      claims {ROLE_LABEL[person.requestedRole]}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={review.isPending}
                      onClick={() => {
                        setGrantRole(person.requestedRole)
                        setConfirming({
                          id: person.id,
                          name: person.fullName,
                          email: person.email,
                          role: person.requestedRole,
                          approve: false,
                        })
                      }}
                    >
                      Refuse
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={review.isPending}
                      onClick={() => {
                        setGrantRole(person.requestedRole)
                        setConfirming({
                          id: person.id,
                          name: person.fullName,
                          email: person.email,
                          role: person.requestedRole,
                          approve: true,
                        })
                      }}
                    >
                      Approve
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {review.error && (
              <p
                className="small"
                style={{ color: 'var(--danger-fg)', marginTop: 'var(--space-3)' }}
              >
                {(review.error as Error).message}
              </p>
            )}
          </CardBody>
        </Card>
      )}

      {/* Security warning is deliberately prominent and permanent. */}
      <Card style={{ marginBottom: 'var(--space-6)', borderColor: 'var(--danger-solid)' }}>
        <CardBody>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <span style={{ fontSize: '1.5rem' }}>🔐</span>
            <div>
              <h4>This matrix controls menus, not data</h4>
              <p className="small muted" style={{ marginTop: 'var(--space-1)', maxWidth: '90ch' }}>
                Hiding a navigation item stops a user stumbling into a screen; it does not stop a
                determined one reading the data. Every table must additionally carry Row Level
                Security policies in Postgres that enforce exactly what is shown below. Test those
                policies against the database directly — passing in the UI proves nothing.
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* --------------------------------------------- THE RBAC MATRIX */}
      <Card style={{ marginBottom: 'var(--space-6)' }}>
        <CardHeader
          title="Permission matrix"
          action={<span className="xs dim">Generated from the navigation config</span>}
        />
        <CardBody>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ minWidth: 200 }}>Module</th>
                  {ALL_ROLES.map((role) => (
                    <th key={role} className="center" style={{ fontSize: '10px' }}>
                      {ROLE_LABEL[role].replace(' Representative', '').replace(' Manager', '')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MODULES.map((module) => (
                  <tr key={`${module.area}-${module.label}`}>
                    <td>
                      <div className="strong small">{module.label}</div>
                      <div className="xs dim">
                        {module.area} · {module.group}
                      </div>
                    </td>
                    {ALL_ROLES.map((role) => (
                      <td key={role} className="center">
                        {module.roles.includes(role) ? (
                          <span style={{ color: 'var(--success-fg)', fontWeight: 700 }}>✓</span>
                        ) : (
                          <span className="dim">·</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <div className="grid grid--2" style={{ alignItems: 'start' }}>
        {/* ------------------------------------------------- USER LIST */}
        <Card>
          <CardHeader
            title="Staff accounts"
            action={
              <Badge tone="neutral">
                {staffQuery.data?.filter((s) => s.isActive).length ?? 0} active
              </Badge>
            }
          />
          <CardBody>
            {/* Accounts are NOT created here any more.

                They used to be: an administrator typed somebody's name, email
                and role, and the Edge Function generated a password shown once.
                That is two chances to be wrong — a mistyped address and a
                mis-picked role — and the person affected sees neither.

                Staff now register themselves at /staff/register and state the
                role they were given, and an administrator confirms it above. A
                wrong role becomes a disagreement between two people rather than
                one person's slip. */}

            {/* --------------------------------------- THE DIRECTORY */}
            <QueryState
              isLoading={staffQuery.isLoading}
              error={staffQuery.error as Error | null}
              isEmpty={(staffQuery.data?.length ?? 0) === 0}
              emptyIcon="&#128101;"
              emptyTitle="No staff accounts yet"
              emptyMessage="Staff register themselves at /staff/register; approve them above."
            >
              <div className="stack stack--sm">
                {(staffQuery.data ?? []).map((person) => (
                  <div key={person.id} className="row row--between">
                    <div className="row">
                      <span className="avatar">{person.avatarInitials}</span>
                      <div>
                        <div className="small strong">
                          {person.fullName}
                          {person.id === user?.id && <span className="xs dim"> (you)</span>}
                        </div>
                        <div className="xs dim">{person.email}</div>
                      </div>
                    </div>
                    <div className="row">
                      {/* The role is shown, not offered. It can only be set
                          by approving a registration, and migration 0052
                          enforces that in the database — so removing this
                          dropdown removed an accident rather than just a
                          control. Somebody who changes roles genuinely does it
                          in Supabase, deliberately. */}
                      <span className="badge">{ROLE_LABEL[person.role]}</span>

                      {/* DEACTIVATION, which had no control at all. A leaver
                          could have their role changed and never have their
                          access removed — and migration 0016 made `is_active`
                          a real check inside the role helpers, so this is what
                          actually stops them reading anything. Deactivating
                          rather than deleting keeps their history intact. */}
                      <Button
                        variant={person.isActive ? 'ghost' : 'outline'}
                        size="sm"
                        disabled={person.id === user?.id || setActive.isPending}
                        title={
                          person.id === user?.id
                            ? 'You cannot deactivate yourself'
                            : person.isActive
                              ? 'Revoke access, keeping their history'
                              : 'Restore access'
                        }
                        onClick={() =>
                          setActive.mutate({
                            userId: person.id,
                            isActive: !person.isActive,
                          })
                        }
                      >
                        {person.isActive ? 'Deactivate' : 'Reactivate'}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </QueryState>
          </CardBody>
        </Card>

        {/* ------------------------------------------ SECURITY POLICY
            This was seven checkboxes and a Save button, none of them connected
            to anything. A security toggle that saves and changes nothing is
            considerably worse than no toggle: it tells an administrator a
            control is on when it is not.

            What is actually enforced is enforced in the DATABASE, where a
            tampered browser cannot reach it - so this card now names each
            control and the mechanism behind it. The figures that genuinely are
            adjustable live on the settings page, which writes to the same rows
            the triggers read. */}
        <Card>
          <CardHeader
            title="Security policy"
            action={
              <ButtonLink to="/admin/settings" variant="outline" size="sm">
                Adjustable settings →
              </ButtonLink>
            }
          />
          <CardBody>
            <p className="small muted" style={{ marginBottom: 'var(--space-4)' }}>
              These controls are enforced by the database itself, not by this screen. Signing in as
              a different role, or editing the page in developer tools, does not move any of them.
            </p>

            <div className="stack stack--sm">
              {[
                {
                  label: 'A customer can only ever read their own records',
                  by: 'Row-level security on every table',
                },
                {
                  label: 'A customer signing a contract can change nothing but the signature',
                  by: 'BEFORE UPDATE trigger · migration 0023',
                },
                {
                  label: 'Every financial record change is written to the audit trail',
                  by: 'Append-only audit table with no UPDATE or DELETE policy',
                },
                {
                  label: 'A discount beyond the sales authority needs an administrator',
                  by: 'Trigger reading sales.discount_authority_pct',
                },
                {
                  // Switched off by default at the owner's request (0050), so
                  // the card says so rather than claiming a control that is not
                  // currently running.
                  label: 'A large payment can require a second person to confirm it',
                  by: 'Dual control · off by default, set a threshold to enable',
                },
                {
                  label: 'A recorded payment cannot be edited into a different one',
                  by: 'BEFORE UPDATE trigger · corrections are refunds',
                },
                {
                  label: 'A purchase order above the requisition limit needs approval',
                  by: 'Trigger reading inventory.requisition_approval_limit',
                },
                {
                  label: 'Payroll and client exports are limited by role',
                  by: 'Role checks in policy, not in the menu',
                },
              ].map((rule) => (
                <div key={rule.label} className="row row--between">
                  <span className="small" style={{ maxWidth: '32ch' }}>
                    {rule.label}
                  </span>
                  <span className="xs dim" style={{ textAlign: 'right', maxWidth: '28ch' }}>
                    {rule.by}
                  </span>
                </div>
              ))}
            </div>

            <p className="xs dim" style={{ marginTop: 'var(--space-4)' }}>
              Multi-factor authentication and session expiry are configured in the Supabase Auth
              dashboard rather than here, because that is where they are actually applied.
            </p>
          </CardBody>
        </Card>
      </div>

      {/* ------------------------------------- CONFIRM BEFORE GRANTING
          Granting a role is the single most consequential action on this
          screen, and the two buttons that do it sit next to each other on a
          list. A dialog that restates WHO and WHICH ROLE is the difference
          between a decision and a mis-click. */}
      <Modal
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title={confirming?.approve ? 'Approve this registration' : 'Refuse this registration'}
      >
        {confirming && (
          <div className="stack">
            <div
              style={{
                padding: 'var(--space-4)',
                background: 'var(--ink-50)',
                borderRadius: 'var(--radius)',
              }}
            >
              <div className="strong">{confirming.name}</div>
              <div className="xs dim">{confirming.email}</div>
              <div style={{ marginTop: 'var(--space-3)' }}>
                <span className="xs dim">Role they asked for</span>
                <div className="strong" style={{ fontSize: 'var(--text-lg)' }}>
                  {ROLE_LABEL[confirming.role]}
                </div>
              </div>
            </div>

            {confirming.approve ? (
              <>
                {/* Correcting the claim rather than refusing it. Picking the
                    wrong role is the most likely mistake a new employee makes
                    on their first day, and making them register again leaves
                    one person holding two accounts. */}
                <div className="field">
                  <label className="field__label" htmlFor="grant-role">
                    Grant this role
                  </label>
                  <select
                    id="grant-role"
                    className="select"
                    value={grantRole ?? confirming.role}
                    onChange={(event) => setGrantRole(event.target.value as UserRole)}
                  >
                    {GRANTABLE_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABEL[role]}
                        {role === confirming.role ? ' — as claimed' : ''}
                      </option>
                    ))}
                  </select>
                  <span className="field__hint">
                    Change it if they picked the wrong one. The correction is recorded against what
                    they originally asked for.
                  </span>
                </div>

                <p className="small muted">
                  This grants {confirming.name} everything a{' '}
                  {ROLE_LABEL[grantRole ?? confirming.role]} may read and change, immediately. This
                  is the one moment somebody checks.
                </p>
              </>
            ) : (
              <p className="small muted">
                Their account stays, inactive, so they can be approved later if they simply picked
                the wrong role. Nothing is deleted.
              </p>
            )}

            <div className="row row--between">
              <Button variant="ghost" onClick={() => setConfirming(null)}>
                Cancel
              </Button>
              <Button
                variant={confirming.approve ? 'primary' : 'danger'}
                disabled={review.isPending}
                onClick={() =>
                  review.mutate(
                    {
                      userId: confirming.id,
                      approve: confirming.approve,
                      role: confirming.approve ? (grantRole ?? confirming.role) : undefined,
                    },
                    { onSuccess: () => setConfirming(null) },
                  )
                }
              >
                {review.isPending
                  ? 'Saving…'
                  : confirming.approve
                    ? `Yes — make them a ${ROLE_LABEL[grantRole ?? confirming.role]}`
                    : 'Yes — refuse it'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
