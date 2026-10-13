import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { readableDbError, throwReadable } from '@/lib/db-error'
import { NOT_CONNECTED, supabase } from '@/lib/supabase'

/* ============================================================================
   PAYMENTS
   ----------------------------------------------------------------------------
   Money is received by bank transfer or over the counter and recorded here by
   whoever handles it. There is no payment gateway: the company settles that way
   in practice, and a checkout the business does not use is a feature that looks
   finished and is not.

   THAT MAKES THE RULES MATTER MORE, NOT LESS.
   A hand-recorded ledger has no signed webhook standing behind it — the only
   evidence a payment arrived is that somebody said so. So the database still
   refuses an overpayment, still takes provenance from the session rather than
   the request, and still forbids editing a recorded payment: a correction is a
   refund plus a fresh entry, because rewriting history is how a ledger stops
   being one.
   ========================================================================== */

export const paymentKeys = {
  pendingVerification: ['payments', 'pending-verification'] as const,
  settled: (invoiceId: string) => ['payments', 'settled', invoiceId] as const,
  refunds: ['payments', 'refunds'] as const,
}

/* ============================================================================
   SETTLED PAYMENTS - what a receipt is made of
   ----------------------------------------------------------------------------
   A receipt has to acknowledge money actually received, not the invoice total.
   An invoice paid in two tranches gets two lines, and an UNVERIFIED payment
   gets none: until a second person has matched it against the bank statement
   it does not count towards the invoice, so putting it on a receipt would be
   acknowledging money the company cannot yet see. Gateway payments arrive
   already verified, because a signed webhook is better evidence than a click.

   `payments_read` already limits a customer to payments against their own
   invoices, so one hook serves the customer's billing page and the
   accountant's ledger without a second endpoint or a second set of rules.
   ========================================================================== */

export interface SettledPayment {
  id: string
  amount: number
  method: string
  reference: string | null
  paidAt: string
}

export function useInvoicePayments(invoiceId: string | undefined) {
  return useQuery({
    queryKey: paymentKeys.settled(invoiceId ?? 'none'),
    enabled: Boolean(invoiceId),
    queryFn: async (): Promise<SettledPayment[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      if (!invoiceId) return []

      const { data, error } = await supabase
        .from('payments')
        .select('id, amount, payment_method, reference, paid_at')
        .eq('invoice_id', invoiceId)
        .eq('verified', true)
        .order('paid_at', { ascending: true })

      if (error) throwReadable(error)

      return (data ?? []).map((row) => ({
        id: row.id,
        amount: Number(row.amount),
        method: row.payment_method,
        reference: row.reference,
        paidAt: row.paid_at,
      }))
    },
  })
}

/* ============================================================================
   VERIFICATION QUEUE
   ----------------------------------------------------------------------------
   Migration 0022 requires a manually recorded payment at or above the
   dual-control threshold to be verified by a second person. Only a verified
   payment counts towards the invoice, so until somebody works this queue the
   money is recorded but not recognised.

   Gateway payments never appear here: a signed webhook from the provider is
   better evidence than a colleague's click.
   ========================================================================== */

export interface PendingPayment {
  id: string
  invoiceId: string
  invoiceNumber: string
  amount: number
  method: string
  reference: string | null
  recordedBy: string | null
  recordedByName: string
  paidAt: string
}

export function usePaymentsAwaitingVerification() {
  return useQuery({
    queryKey: paymentKeys.pendingVerification,
    queryFn: async (): Promise<PendingPayment[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('payments')
        // One string literal, not a concatenation: supabase-js infers the row
        // shape from the literal type of this argument, and `'a' + 'b'` widens
        // to plain `string`, which loses every column type.
        .select(
          'id, invoice_id, amount, payment_method, reference, recorded_by, paid_at, invoice:invoices(invoice_number), recorder:profiles!payments_recorded_by_fkey(full_name)',
        )
        .eq('verified', false)
        .order('paid_at', { ascending: true })

      if (error) throwReadable(error)

      return (data ?? []).map((row) => ({
        id: row.id,
        invoiceId: row.invoice_id,
        invoiceNumber: row.invoice?.invoice_number ?? '—',
        amount: Number(row.amount),
        method: row.payment_method,
        reference: row.reference,
        recordedBy: row.recorded_by,
        recordedByName: row.recorder?.full_name ?? 'Unknown',
        paidAt: row.paid_at,
      }))
    },
  })
}

/**
 * Confirm a payment against the bank statement.
 *
 * `verified_by` is not sent. The database fills it in from the session, and
 * refuses if it matches whoever recorded the payment — so the second-person
 * rule cannot be defeated by sending a colleague's id.
 */
export function useVerifyPayment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { paymentId: string }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('payments')
        .update({ verified: true })
        .eq('id', input.paymentId)
        .select('id')

      if (error) {
        if (error.code === '42501' || error.message.includes('someone other than')) {
          throw new Error(
            'You recorded this payment, so somebody else has to verify it. Ask a colleague or an administrator.',
          )
        }
        throw readableDbError(error)
      }

      // PostgREST reports success and updates zero rows when a policy filters
      // the target. Silence would look like it worked.
      if ((data?.length ?? 0) === 0) {
        throw new Error('That payment could not be verified. You may not have permission.')
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: paymentKeys.pendingVerification })
      void queryClient.invalidateQueries({ queryKey: ['fin'] })
      void queryClient.invalidateQueries({ queryKey: ['ops'] })
      void queryClient.invalidateQueries({ queryKey: ['client'] })
    },
  })
}

/* ============================================================================
   REFUNDS
   ----------------------------------------------------------------------------
   `payments.amount` carries `check (amount > 0)`, so a refund is not a negative
   payment — it is a separate event that names the payment it reverses. All the
   rules live in migration 0047: capped at what was taken, only against a
   verified payment, and confirmed by a second person before it reduces the
   invoice. Nothing here re-implements any of that; it would only be a second
   opinion for the two to disagree over.
   ========================================================================== */

export interface RefundRow {
  id: string
  paymentId: string
  invoiceNumber: string
  clientName: string
  amount: number
  reason: string
  status: 'recorded' | 'confirmed' | 'cancelled'
  recordedBy: string | null
  recordedAt: string
  externalReference: string | null
}

/** Exactly what the select below returns, so the mapper needs no casts. */
interface RefundQueryRow {
  id: string
  payment_id: string
  amount: number | string
  reason: string
  status: RefundRow['status']
  recorded_by: string | null
  recorded_at: string
  external_reference: string | null
  payment: {
    invoice: {
      invoice_number: string
      client: { full_name: string | null } | null
    } | null
  } | null
}

export function useRefunds() {
  return useQuery({
    queryKey: paymentKeys.refunds,
    queryFn: async (): Promise<RefundRow[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('payment_refunds')
        .select(
          'id, payment_id, amount, reason, status, recorded_by, recorded_at, external_reference, payment:payments(invoice:invoices(invoice_number, client:profiles!invoices_client_id_fkey(full_name)))',
        )
        .order('recorded_at', { ascending: false })
        .limit(50)

      if (error) throwReadable(error)

      /* One cast, at the boundary, with the shape written out.
         PostgREST types a nested embed as an array-or-object union that does
         not survive inference here, and scattering `as unknown as` down every
         field makes the mapper unreadable — which is how a field silently ends
         up mapped to the wrong column. */
      const rows = (data ?? []) as unknown as RefundQueryRow[]

      /* Names through staff_display_names for the same reason as everywhere
         else: `profiles` cannot be joined without handing out the email address
         and mobile number sitting in the same row. */
      const recorderIds = [
        ...new Set(rows.map((row) => row.recorded_by).filter(Boolean)),
      ] as string[]

      let names: Record<string, string> = {}
      if (recorderIds.length > 0) {
        const { data: resolved } = await supabase.rpc('staff_display_names', {
          p_ids: recorderIds,
        })
        names = (resolved as Record<string, string> | null) ?? {}
      }

      return rows.map((row) => ({
        id: row.id,
        paymentId: row.payment_id,
        invoiceNumber: row.payment?.invoice?.invoice_number ?? '—',
        clientName: row.payment?.invoice?.client?.full_name ?? 'Unknown',
        amount: Number(row.amount),
        reason: row.reason,
        status: row.status,
        recordedBy: row.recorded_by ? (names[row.recorded_by] ?? 'A colleague') : null,
        recordedAt: row.recorded_at,
        externalReference: row.external_reference ?? null,
      }))
    },
  })
}

export function useRecordRefund() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      paymentId: string
      amount: number
      reason: string
      externalReference?: string
    }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('payment_refunds')
        .insert({
          payment_id: input.paymentId,
          amount: input.amount,
          reason: input.reason.trim(),
          external_reference: input.externalReference?.trim() || null,
        })
        // recorded_by and status are set by the trigger, never sent from here.
        .select('id')
        .single()

      if (error) throwReadable(error)
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['payments'] })
      void queryClient.invalidateQueries({ queryKey: ['fin'] })
      void queryClient.invalidateQueries({ queryKey: ['inv'] })
      void queryClient.invalidateQueries({ queryKey: ['client'] })
    },
  })
}

/** Confirm a refund. The database refuses if you are the one who recorded it. */
export function useConfirmRefund() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { refundId: string }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('payment_refunds')
        .update({ status: 'confirmed' })
        .eq('id', input.refundId)
        .select('id, status')

      if (error) throwReadable(error)
      /* A policy-filtered UPDATE returns 200 with zero rows. Reporting that as
         success would tell an accountant money had gone back when it had not. */
      if (!data || data.length === 0) {
        throw new Error('That confirmation was refused. Your role may not confirm refunds.')
      }
      return data[0]
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['payments'] })
      void queryClient.invalidateQueries({ queryKey: ['fin'] })
      void queryClient.invalidateQueries({ queryKey: ['inv'] })
      void queryClient.invalidateQueries({ queryKey: ['client'] })
    },
  })
}

/* ============================================================================
   PROOF OF PAYMENT FROM THE CUSTOMER
   ----------------------------------------------------------------------------
   With no gateway, a customer pays by transfer and then has to tell somebody.
   They can now upload the deposit slip or screenshot from their billing page
   (0072), and it lands here — the accountant matches it to the bank statement
   and records the payment, rather than waiting for a phone call.
   ========================================================================== */

export interface PaymentProof {
  id: string
  name: string
  storagePath: string | null
  uploadedAt: string
  projectId: string | null
  projectReference: string
  clientName: string
}

export function usePaymentProofs() {
  return useQuery({
    queryKey: ['payments', 'proofs'],
    queryFn: async (): Promise<PaymentProof[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      const { data, error } = await supabase
        .from('documents')
        .select(
          'id, name, storage_path, uploaded_at, project_id, project:projects(reference, client:profiles!projects_client_id_fkey(full_name))',
        )
        .eq('kind', 'receipt')
        .order('uploaded_at', { ascending: false })
        .limit(20)
      if (error) throwReadable(error)
      return (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        storagePath: row.storage_path,
        uploadedAt: row.uploaded_at,
        projectId: row.project_id,
        projectReference: row.project?.reference ?? '',
        clientName: row.project?.client?.full_name ?? 'Customer',
      }))
    },
  })
}

/* ============================================================================
   SALES COMMISSIONS
   ----------------------------------------------------------------------------
   Raised automatically when a contract is executed, at the commission rate in
   Settings, for the rep who owned the lead (0073). Released by finance once
   the project is complete; rejected automatically if it is cancelled. There
   was a `commissions` table and nothing that wrote to it or read from it.
   ========================================================================== */

export interface CommissionRow {
  id: string
  repName: string
  projectId: string
  projectReference: string
  projectStatus: string
  clientName: string
  amount: number
  ratePct: number | null
  status: 'pending' | 'approved' | 'rejected'
  createdAt: string
  releasedAt: string | null
}

export function useCommissions() {
  return useQuery({
    queryKey: ['payments', 'commissions'],
    queryFn: async (): Promise<CommissionRow[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      const { data, error } = await supabase
        .from('commissions')
        .select(
          'id, project_id, amount, rate_pct, status, created_at, released_at, rep:profiles!commissions_user_id_fkey(full_name), project:projects!commissions_project_id_fkey(reference, status, client:profiles!projects_client_id_fkey(full_name))',
        )
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throwReadable(error)
      return (data ?? []).map((row) => ({
        id: row.id,
        repName: row.rep?.full_name ?? 'Sales',
        projectId: row.project_id,
        projectReference: row.project?.reference ?? '',
        projectStatus: row.project?.status ?? '',
        clientName: row.project?.client?.full_name ?? 'Customer',
        amount: Number(row.amount),
        ratePct: row.rate_pct === null ? null : Number(row.rate_pct),
        status: row.status,
        createdAt: row.created_at,
        releasedAt: row.released_at,
      }))
    },
  })
}

export function useSetCommissionStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { id: string; status: 'approved' | 'rejected' }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      const { data, error } = await supabase
        .from('commissions')
        .update({ status: input.status })
        .eq('id', input.id)
        .eq('status', 'pending')
        .select('id')
      if (error) throwReadable(error)
      if ((data?.length ?? 0) === 0) {
        throw new Error('That commission was already decided, or your role may not decide it.')
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['payments', 'commissions'] })
    },
  })
}

/**
 * Bring time-based statuses up to date: invoices past due become overdue,
 * quotations past their validity expire, maintenance coming due is notified.
 *
 * A scheduled job runs this every night (0073). Opening the finance page runs
 * it too, at most once a session, so the office never works from yesterday's
 * statuses because a job was missed. The database holds a lock, so two people
 * opening the page at once is harmless.
 */
let refreshedThisSession = false

export async function refreshTimeBasedStatuses(): Promise<boolean> {
  if (!supabase || refreshedThisSession) return false
  refreshedThisSession = true
  const { error } = await supabase.rpc('refresh_time_based_statuses')
  return !error
}

/**
 * Money collected per month — verified payments by the month they arrived,
 * less refunds — as totals the whole office may see (0075). Null when the
 * figure cannot be read, so a page can fall back to what it can see itself.
 */
export function useMonthlyCollections(months = 8) {
  return useQuery({
    queryKey: ['payments', 'monthly', months],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<{ month: string; collected: number }[] | null> => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      const { data, error } = await supabase.rpc('monthly_collections', { p_months: months })
      if (error) return null
      return (data ?? []).map((row) => ({ month: row.month, collected: Number(row.collected) }))
    },
  })
}
