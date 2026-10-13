import { type FormEvent, useRef, useState } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { FormError } from '@/components/ui/FormError'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { QueryState } from '@/components/ui/QueryState'
import { StatTile } from '@/components/ui/StatTile'
import { currency, currencyCompact, date, humanize } from '@/lib/format'
import { datedFilename, downloadCsv } from '@/lib/csv'
import { useStaff } from '@/lib/queries/admin'
import {
  useDeletePayrollLine,
  useFieldHours,
  useOpenPayrollRun,
  usePayrollPeriod,
  useSavePayrollLine,
  useSetPayrollStatus,
  type PayrollLine,
} from '@/lib/queries/payroll'

/* ============================================================================
   HrPayrollPage — the payroll register.
   ----------------------------------------------------------------------------
   WHAT THIS IS
   A record of what the company paid, to whom, for which period. Entries are
   typed in, corrected, approved and exported.

   WHAT THIS DELIBERATELY IS NOT
   A payroll calculator. SSS, PhilHealth, Pag-IBIG, withholding tax and
   13th-month pay change, interact, and carry legal consequences when they are
   wrong. Whoever runs payroll works them out and enters the result; the
   software totals what it is given and never invents a contribution.

   This screen used to be seven salaries written into the file as a constant,
   with a disabled "Run payroll" button. Nothing on it came from anywhere. The
   figures are now real, or the table is empty — and an empty register is worth
   more than a full one that was never true.

   SALARY IS THE MOST SENSITIVE DATA IN THE COMPANY.
   `payroll_lines_read` limits an employee to their own line, so the protection
   does not rest on this page being hard to find. A curious colleague is a much
   more likely reader than an outside attacker.
   ========================================================================== */

const STATUS_TONE = {
  draft: 'neutral',
  pending_approval: 'warning',
  approved: 'info',
  paid: 'success',
} as const

/** First and last day of a month, as the date inputs want them. */
function monthBounds(month: string): { start: string; end: string } {
  const [year, m] = month.split('-').map(Number)
  const last = new Date(year, m, 0).getDate()
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, '0')}` }
}

/** The current month as YYYY-MM, in local time — toISOString would drift. */
function currentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function HrPayrollPage() {
  const [month, setMonth] = useState(currentMonth)
  const bounds = monthBounds(month)

  const periodQuery = usePayrollPeriod(bounds.start, bounds.end)
  const run = periodQuery.data?.run ?? null
  const lines = periodQuery.data?.lines ?? []

  const staff = (useStaff().data ?? []).filter((s) => s.isActive)
  const openRun = useOpenPayrollRun()
  const saveLine = useSavePayrollLine()
  const deleteLine = useDeletePayrollLine()
  const setStatus = useSetPayrollStatus()

  const [editing, setEditing] = useState<PayrollLine | null>(null)
  const [composing, setComposing] = useState(false)

  /* What the field app logged for each person this period, shown beside the
     hours inputs so the register and the field cannot quietly disagree. */
  const fieldHours = useFieldHours(bounds.start, bounds.end).data ?? {}
  const [formUser, setFormUser] = useState('')
  const regularRef = useRef<HTMLInputElement>(null)
  const overtimeRef = useRef<HTMLInputElement>(null)
  const logged = fieldHours[formUser || editing?.userId || '']

  const gross = lines.reduce((sum, l) => sum + l.grossPay, 0)
  const deductions = lines.reduce((sum, l) => sum + l.deductions, 0)
  const net = lines.reduce((sum, l) => sum + l.netPay, 0)

  // Once a period is approved the figures have been checked and signed for.
  const locked = run?.status === 'approved' || run?.status === 'paid'

  function closeForm() {
    setComposing(false)
    setEditing(null)
    setFormUser('')
    saveLine.reset()
  }

  function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!run) return
    const form = new FormData(event.currentTarget)

    saveLine.mutate(
      {
        id: editing?.id,
        runId: run.id,
        userId: String(form.get('userId')),
        regularHours: Number(form.get('regularHours') ?? 0),
        overtimeHours: Number(form.get('overtimeHours') ?? 0),
        basePay: Number(form.get('basePay') ?? 0),
        overtimePay: Number(form.get('overtimePay') ?? 0),
        commissionPay: Number(form.get('commissionPay') ?? 0),
        deductions: Number(form.get('deductions') ?? 0),
        notes: String(form.get('notes') ?? ''),
      },
      { onSuccess: closeForm },
    )
  }

  const columns: Column<PayrollLine>[] = [
    {
      header: 'Employee',
      cell: (l) => (
        <div>
          <div className="strong">{l.staffName}</div>
          <div className="xs dim">{humanize(l.staffRole)}</div>
        </div>
      ),
    },
    {
      header: 'Hours',
      cell: (l) => (
        <span className="small">
          {l.regularHours}
          {l.overtimeHours > 0 && <span className="dim"> + {l.overtimeHours} OT</span>}
        </span>
      ),
    },
    { header: 'Base', numeric: true, cell: (l) => currency(l.basePay) },
    { header: 'Overtime', numeric: true, cell: (l) => currency(l.overtimePay) },
    { header: 'Commission', numeric: true, cell: (l) => currency(l.commissionPay) },
    {
      header: 'Deductions',
      numeric: true,
      cell: (l) => <span className="muted">{currency(l.deductions)}</span>,
    },
    {
      header: 'Net pay',
      numeric: true,
      cell: (l) => <span className="strong">{currency(l.netPay)}</span>,
    },
    {
      header: '',
      cell: (l) =>
        locked ? (
          <span className="xs dim">Locked</span>
        ) : (
          <div className="row">
            <Button variant="outline" size="sm" onClick={() => setEditing(l)}>
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={deleteLine.isPending}
              onClick={() => {
                // A payslip line is something somebody may rely on. Worth asking.
                if (window.confirm(`Remove the entry for ${l.staffName}?`)) {
                  deleteLine.mutate({ id: l.id })
                }
              }}
            >
              Remove
            </Button>
          </div>
        ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Payroll register"
        description="What was paid, to whom, for which period."
        actions={
          <>
            <input
              className="input"
              type="month"
              style={{ width: 'auto' }}
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
            <Button
              variant="outline"
              disabled={lines.length === 0}
              onClick={() =>
                downloadCsv(datedFilename(`payroll-${month}`), lines, [
                  { header: 'Employee', value: (l) => l.staffName },
                  { header: 'Role', value: (l) => l.staffRole },
                  { header: 'Period start', value: () => bounds.start },
                  { header: 'Period end', value: () => bounds.end },
                  { header: 'Regular hours', value: (l) => l.regularHours },
                  { header: 'Overtime hours', value: (l) => l.overtimeHours },
                  { header: 'Base pay', value: (l) => l.basePay },
                  { header: 'Overtime pay', value: (l) => l.overtimePay },
                  { header: 'Commission', value: (l) => l.commissionPay },
                  { header: 'Deductions', value: (l) => l.deductions },
                  { header: 'Gross pay', value: (l) => l.grossPay },
                  { header: 'Net pay', value: (l) => l.netPay },
                  { header: 'Notes', value: (l) => l.notes ?? '' },
                ])
              }
            >
              Export register
            </Button>
            {run && !locked && (
              <Button variant="primary" onClick={() => setComposing(true)}>
                + Add entry
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 'var(--space-6)' }}>
        <StatTile label="People paid" value={String(lines.length)} />
        <StatTile label="Gross" value={currencyCompact(gross)} />
        <StatTile label="Deductions" value={currencyCompact(deductions)} />
        <StatTile label="Net payable" value={currencyCompact(net)} />
      </div>

      <Card style={{ marginBottom: 'var(--space-6)' }}>
        <CardBody>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <span style={{ fontSize: '1.5rem' }}>📒</span>
            <div>
              <h4>This is a register, not a calculator</h4>
              <p className="small muted" style={{ marginTop: 'var(--space-1)' }}>
                SSS, PhilHealth, Pag-IBIG and withholding tax are worked out wherever you do payroll
                today, then recorded here as a single deductions figure. The system totals what you
                enter and never computes a contribution itself — those rules change, and software
                that guesses at them is worse than software that does not try.
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      {!run ? (
        <Card>
          <CardBody className="center">
            <div style={{ fontSize: '2.5rem' }}>📅</div>
            <h3 style={{ marginBlock: 'var(--space-3)' }}>
              Nothing recorded for {date(bounds.start)} – {date(bounds.end)}
            </h3>
            <p className="muted" style={{ maxWidth: '48ch', marginInline: 'auto' }}>
              Open the period once payroll has been run, then record what each person was paid.
            </p>
            <FormError error={openRun.error} />
            <Button
              variant="primary"
              style={{ marginTop: 'var(--space-4)' }}
              disabled={openRun.isPending}
              onClick={() => openRun.mutate({ periodStart: bounds.start, periodEnd: bounds.end })}
            >
              {openRun.isPending ? 'Opening…' : 'Open this period'}
            </Button>
          </CardBody>
        </Card>
      ) : (
        <>
          <Card style={{ marginBottom: 'var(--space-6)' }}>
            <CardHeader
              title={`${date(run.periodStart)} – ${date(run.periodEnd)}`}
              action={<Badge tone={STATUS_TONE[run.status]}>{humanize(run.status)}</Badge>}
            />
            <CardBody>
              <div className="row row--between row--wrap">
                <p className="small muted" style={{ maxWidth: '52ch' }}>
                  {run.status === 'draft' &&
                    'Still being entered. Approve it once the figures have been checked — entries are locked from that point.'}
                  {run.status === 'pending_approval' &&
                    'Waiting for someone to check the figures against what payroll actually produced.'}
                  {run.status === 'approved' &&
                    `Checked and approved${run.approvedAt ? ` on ${date(run.approvedAt)}` : ''}. Mark it paid once the money has gone out.`}
                  {run.status === 'paid' && 'Paid and closed. Kept for the record.'}
                </p>

                <div className="row">
                  {run.status === 'draft' && lines.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={setStatus.isPending}
                      onClick={() =>
                        setStatus.mutate({ runId: run.id, status: 'pending_approval' })
                      }
                    >
                      Send for approval
                    </Button>
                  )}
                  {run.status === 'pending_approval' && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={setStatus.isPending}
                        onClick={() => setStatus.mutate({ runId: run.id, status: 'draft' })}
                      >
                        Send back
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={setStatus.isPending}
                        onClick={() => setStatus.mutate({ runId: run.id, status: 'approved' })}
                      >
                        Approve
                      </Button>
                    </>
                  )}
                  {run.status === 'approved' && (
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={setStatus.isPending}
                      onClick={() => setStatus.mutate({ runId: run.id, status: 'paid' })}
                    >
                      Mark as paid
                    </Button>
                  )}
                </div>
              </div>

              <FormError error={setStatus.error} />
            </CardBody>
          </Card>

          <QueryState
            isLoading={periodQuery.isLoading}
            error={periodQuery.error as Error | null}
            emptyIcon="📒"
            emptyTitle="No entries yet"
            emptyMessage="Add each person who was paid for this period."
          >
            <DataTable columns={columns} rows={lines} rowKey={(l) => l.id} />
          </QueryState>

          <FormError error={deleteLine.error} />
        </>
      )}

      {/* --------------------------------------------------- ADD / EDIT */}
      <Modal
        open={composing || editing !== null}
        onClose={closeForm}
        title={editing ? `Edit · ${editing.staffName}` : 'Add a payroll entry'}
      >
        <form className="stack" onSubmit={handleSave}>
          <div className="field">
            <label className="field__label" htmlFor="pay-user">
              Employee
            </label>
            <select
              id="pay-user"
              name="userId"
              className="select"
              required
              defaultValue={editing?.userId ?? ''}
              onChange={(e) => setFormUser(e.target.value)}
            >
              <option value="">Choose…</option>
              {staff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.fullName} · {humanize(member.role)}
                </option>
              ))}
            </select>
            <span className="field__hint">
              One entry per person per period — a second is refused by the database, which is what
              stops somebody being paid twice for the same fortnight.
            </span>
          </div>

          {/* Hundredths, as the column stores them. Quarter-hour steps refused
              the field log's own figures — "Use these hours" filled in 0.3 and
              the browser would not submit the form. */}
          <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
            <div className="field" style={{ flex: 1 }}>
              <label className="field__label" htmlFor="pay-reg-hours">
                Regular hours
              </label>
              <input
                id="pay-reg-hours"
                name="regularHours"
                className="input"
                type="number"
                step="0.01"
                min="0"
                defaultValue={editing?.regularHours ?? 0}
                ref={regularRef}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label className="field__label" htmlFor="pay-ot-hours">
                Overtime hours
              </label>
              <input
                id="pay-ot-hours"
                name="overtimeHours"
                className="input"
                type="number"
                step="0.01"
                min="0"
                defaultValue={editing?.overtimeHours ?? 0}
                ref={overtimeRef}
              />
            </div>
          </div>

          {logged && (
            <div
              className="row row--between row--wrap small"
              style={{
                padding: 'var(--space-2) var(--space-3)',
                background: 'var(--ink-50)',
                borderRadius: 'var(--radius)',
                gap: 'var(--space-2)',
              }}
            >
              <span>
                Logged in the field this period: <strong>{logged.regular} h</strong>
                {logged.overtime > 0 && (
                  <>
                    {' '}
                    + <strong>{logged.overtime} h overtime</strong>
                  </>
                )}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (regularRef.current) regularRef.current.value = String(logged.regular)
                  if (overtimeRef.current) overtimeRef.current.value = String(logged.overtime)
                }}
              >
                Use these hours
              </Button>
            </div>
          )}

          <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
            <div className="field" style={{ flex: 1 }}>
              <label className="field__label" htmlFor="pay-base">
                Base pay
              </label>
              <input
                id="pay-base"
                name="basePay"
                className="input"
                type="number"
                step="0.01"
                min="0"
                required
                defaultValue={editing?.basePay ?? 0}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label className="field__label" htmlFor="pay-ot">
                Overtime pay
              </label>
              <input
                id="pay-ot"
                name="overtimePay"
                className="input"
                type="number"
                step="0.01"
                min="0"
                defaultValue={editing?.overtimePay ?? 0}
              />
            </div>
          </div>

          <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
            <div className="field" style={{ flex: 1 }}>
              <label className="field__label" htmlFor="pay-commission">
                Commission
              </label>
              <input
                id="pay-commission"
                name="commissionPay"
                className="input"
                type="number"
                step="0.01"
                min="0"
                defaultValue={editing?.commissionPay ?? 0}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label className="field__label" htmlFor="pay-deduct">
                Deductions
              </label>
              <input
                id="pay-deduct"
                name="deductions"
                className="input"
                type="number"
                step="0.01"
                min="0"
                defaultValue={editing?.deductions ?? 0}
              />
              <span className="field__hint">
                SSS, PhilHealth, Pag-IBIG, tax and anything else withheld, as one total.
              </span>
            </div>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="pay-notes">
              Notes <span className="dim">(optional)</span>
            </label>
            <textarea
              id="pay-notes"
              name="notes"
              className="textarea"
              rows={2}
              defaultValue={editing?.notes ?? ''}
            />
          </div>

          <FormError error={saveLine.error} />

          <Button type="submit" variant="primary" block disabled={saveLine.isPending}>
            {saveLine.isPending ? 'Saving…' : editing ? 'Save changes' : 'Add to the register'}
          </Button>

          <p className="xs dim">
            Net pay is base + overtime + commission − deductions, worked out by the database so the
            total can never disagree with its parts.
          </p>
        </form>
      </Modal>
    </>
  )
}
