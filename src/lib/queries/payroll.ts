import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { throwReadable } from '@/lib/db-error'
import { NOT_CONNECTED, supabase } from '@/lib/supabase'
import { splitHours } from '@/lib/work-hours'

/* ============================================================================
   PAYROLL REGISTER
   ----------------------------------------------------------------------------
   A record of what was paid, not a calculator. The screen this feeds used to be
   seven salaries written into the component as a constant — real-looking
   figures for real-looking people, under a heading that said "Payroll".

   Statutory contributions are deliberately NOT computed anywhere in this
   application. SSS, PhilHealth, Pag-IBIG, withholding tax and 13th-month pay
   change, interact, and carry legal consequences when they are wrong. Whoever
   runs payroll works them out and enters the result as one `deductions` figure.

   TWO TABLES, NOT ONE, AND THEY ALREADY EXISTED
   `payroll_runs` is a period; `payroll_lines` is one person within it. Both
   have been in the schema since migration 0005 with correct RLS already on
   them — including the rule that an employee sees their own line and nobody
   else's. They had simply never been read or written. Adding a flat
   `payroll_entries` table would have been faster and would have left two
   payroll tables in the schema with nothing to say which one counts.
   ========================================================================== */

export const payrollKeys = {
  all: ['payroll'] as const,
  run: (period: string) => ['payroll', 'run', period] as const,
}

export type PayrollStatus = 'draft' | 'pending_approval' | 'approved' | 'paid'

export interface PayrollRun {
  id: string
  periodStart: string
  periodEnd: string
  status: PayrollStatus
  totalGross: number
  approvedAt: string | null
}

export interface PayrollLine {
  id: string
  runId: string
  userId: string
  staffName: string
  staffRole: string
  regularHours: number
  overtimeHours: number
  basePay: number
  overtimePay: number
  commissionPay: number
  deductions: number
  grossPay: number
  netPay: number
  notes: string | null
}

interface LineRow {
  id: string
  payroll_run_id: string
  user_id: string
  regular_hours: number | string
  overtime_hours: number | string
  base_pay: number | string
  overtime_pay: number | string
  commission_pay: number | string
  deductions: number | string
  gross_pay: number | string
  net_pay: number | string
  notes: string | null
  staff: { full_name: string | null; role: string | null } | null
}

/**
 * The run covering a month, and its lines.
 *
 * Returns `run: null` rather than creating one. A period with no payroll is a
 * normal state — most months, on most days — and silently inserting an empty
 * run every time somebody browsed to a different month would fill the table
 * with periods nobody paid.
 */
export function usePayrollPeriod(periodStart: string, periodEnd: string) {
  return useQuery({
    queryKey: payrollKeys.run(`${periodStart}..${periodEnd}`),
    queryFn: async (): Promise<{ run: PayrollRun | null; lines: PayrollLine[] }> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data: runRow, error: runError } = await supabase
        .from('payroll_runs')
        .select('id, period_start, period_end, status, total_gross, approved_at')
        .eq('period_start', periodStart)
        .eq('period_end', periodEnd)
        .maybeSingle()

      if (runError) throwReadable(runError)
      if (!runRow) return { run: null, lines: [] }

      const { data: lineRows, error: linesError } = await supabase
        .from('payroll_lines')
        .select(
          'id, payroll_run_id, user_id, regular_hours, overtime_hours, base_pay, overtime_pay, commission_pay, deductions, gross_pay, net_pay, notes, staff:profiles!payroll_lines_user_id_fkey(full_name, role)',
        )
        .eq('payroll_run_id', runRow.id)

      if (linesError) throwReadable(linesError)

      return {
        run: {
          id: runRow.id,
          periodStart: runRow.period_start,
          periodEnd: runRow.period_end,
          status: runRow.status as PayrollStatus,
          totalGross: Number(runRow.total_gross),
          approvedAt: runRow.approved_at,
        },
        lines: ((lineRows ?? []) as unknown as LineRow[])
          .map((row) => ({
            id: row.id,
            runId: row.payroll_run_id,
            userId: row.user_id,
            staffName: row.staff?.full_name ?? 'Unknown',
            staffRole: row.staff?.role ?? '',
            regularHours: Number(row.regular_hours),
            overtimeHours: Number(row.overtime_hours),
            basePay: Number(row.base_pay),
            overtimePay: Number(row.overtime_pay),
            commissionPay: Number(row.commission_pay),
            deductions: Number(row.deductions),
            grossPay: Number(row.gross_pay),
            netPay: Number(row.net_pay),
            notes: row.notes,
          }))
          .sort((a, b) => a.staffName.localeCompare(b.staffName)),
      }
    },
  })
}

/** Opens the period. Called when the first line is added, not on browsing. */
export function useOpenPayrollRun() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { periodStart: string; periodEnd: string }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('payroll_runs')
        .insert({
          period_start: input.periodStart,
          period_end: input.periodEnd,
          status: 'draft',
        })
        .select('id')
        .single()

      if (error) throwReadable(error)
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: payrollKeys.all })
    },
  })
}

/** The columns this module writes. Mirrors payroll_lines after 0051. */
interface PayrollLineWrite {
  payroll_run_id: string
  user_id: string
  regular_hours: number
  overtime_hours: number
  base_pay: number
  overtime_pay: number
  commission_pay: number
  deductions: number
  notes: string | null
}

export interface PayrollLineInput {
  id?: string
  runId: string
  userId: string
  regularHours: number
  overtimeHours: number
  basePay: number
  overtimePay: number
  commissionPay: number
  deductions: number
  notes?: string | null
}

export function useSavePayrollLine() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: PayrollLineInput) => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      /* Typed against the columns as this file understands them, so a
         misspelled key is still a compile error here. */
      const row: PayrollLineWrite = {
        payroll_run_id: input.runId,
        user_id: input.userId,
        regular_hours: input.regularHours,
        overtime_hours: input.overtimeHours,
        base_pay: input.basePay,
        overtime_pay: input.overtimePay,
        commission_pay: input.commissionPay,
        deductions: input.deductions,
        notes: input.notes?.trim() || null,
        // gross_pay and net_pay are generated columns and must not be sent.
      }

      const query = input.id
        ? supabase.from('payroll_lines').update(row).eq('id', input.id).select('id')
        : supabase.from('payroll_lines').insert(row).select('id')

      const { data, error } = await query

      if (error) throwReadable(error)
      /* A write the policy filtered out comes back as 200 with zero rows, not
         as an error. Reporting that as saved would tell an accountant a payslip
         was recorded when nothing was written. */
      if (!data || data.length === 0) {
        throw new Error('That was refused. Only an accountant or administrator may edit payroll.')
      }
      return data[0]
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: payrollKeys.all })
    },
  })
}

export function useDeletePayrollLine() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { id: string }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('payroll_lines')
        .delete()
        .eq('id', input.id)
        .select('id')

      if (error) throwReadable(error)
      if (!data || data.length === 0) {
        throw new Error('That was refused, or the entry had already gone.')
      }
      return data[0]
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: payrollKeys.all })
    },
  })
}

/**
 * Move the period along: draft → approved → paid.
 *
 * `approved_by` is stamped by the database from the session rather than sent
 * from here, for the same reason payments are: approval is the step that says
 * the figures were checked, and a click that can name somebody else as the
 * checker is not a check.
 */
export function useSetPayrollStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { runId: string; status: PayrollStatus }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('payroll_runs')
        .update({ status: input.status })
        .eq('id', input.runId)
        .select('id, status')

      if (error) throwReadable(error)
      if (!data || data.length === 0) {
        throw new Error(
          'That was refused. Only an accountant or administrator may approve payroll.',
        )
      }
      return data[0]
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: payrollKeys.all })
    },
  })
}

/**
 * Hours each person logged from the field app in a period, split into regular
 * and overtime by the same rule the field app shows them (work-hours.ts).
 *
 * The register's hours were typed in by hand while the field app was already
 * recording every shift, so the two could disagree with nothing to say which
 * was right. The form now shows these beside the inputs and can copy them in;
 * the accountant still decides what is paid.
 */
export function useFieldHours(periodStart: string, periodEnd: string) {
  return useQuery({
    queryKey: ['payroll', 'field-hours', periodStart, periodEnd],
    queryFn: async (): Promise<Record<string, { regular: number; overtime: number }>> => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      // The period's bounds in Philippine time, which is when the days begin.
      const { data, error } = await supabase
        .from('time_logs')
        .select('user_id, clock_in, hours')
        .gte('clock_in', `${periodStart}T00:00:00+08:00`)
        .lte('clock_in', `${periodEnd}T23:59:59+08:00`)
      if (error) throwReadable(error)

      const byUser = new Map<string, { clockIn: string; hours: number }[]>()
      for (const row of data ?? []) {
        const shifts = byUser.get(row.user_id) ?? []
        shifts.push({ clockIn: row.clock_in, hours: Number(row.hours ?? 0) })
        byUser.set(row.user_id, shifts)
      }
      return Object.fromEntries(
        [...byUser.entries()].map(([userId, shifts]) => [userId, splitHours(shifts)]),
      )
    },
  })
}
