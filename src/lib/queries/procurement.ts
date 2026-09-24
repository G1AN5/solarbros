import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { readableDbError, throwReadable } from '@/lib/db-error'
import { NOT_CONNECTED, supabase } from '@/lib/supabase'

/* ============================================================================
   PERMITS AND PURCHASE ORDERS
   ----------------------------------------------------------------------------
   The two tracks that run in parallel after a contract is executed, and that
   the installation cannot start without:

     contract executed
        ├── PERMITTING  ── LGU, electrical, utility, net metering ──┐
        └── PROCUREMENT ── purchase order → delivery → stock ───────┤
                                                                    ▼
                                                            installation begins

   BOTH DEPEND ON PEOPLE OUTSIDE THIS SYSTEM, AND THAT IS THE DESIGN PROBLEM
   Paranaque City Hall does not have a login. Neither does Meralco, nor the
   supplier's despatch clerk. If the workflow could only advance when the
   external party clicked something, every project would stall permanently.

   So a staff member records the outcome ON THEIR BEHALF, and the record says
   plainly that this is what happened: `recorded_by`, `recorded_at` and
   `external_reference` are captured, and the permit trigger writes an audit
   entry at `warning` severity rather than `info`.

   That severity is the whole point. It distinguishes "the utility approved
   this" from "an employee asserted that the utility approved this". Both are
   legitimate entries; only one of them is evidence. Anyone auditing the project
   later can tell which they are looking at, and the external reference number is
   there to check against the issuing body's own records.
   ========================================================================== */

export const procurementKeys = {
  permits: (projectId?: string) => ['ops', 'permits', projectId ?? 'all'] as const,
  purchaseOrders: ['inv', 'purchase-orders'] as const,
  suppliers: ['inv', 'suppliers'] as const,
}

/* ============================================================================
   PERMITS
   ========================================================================== */

export type PermitType =
  | 'lgu_building'
  | 'electrical'
  | 'utility_interconnection'
  | 'net_metering'
  | 'permission_to_operate'

export type PermitStatus = 'preparing' | 'submitted' | 'under_review' | 'approved' | 'rejected'

export interface Permit {
  id: string
  projectId: string
  projectReference: string
  permitType: PermitType
  authority: string
  status: PermitStatus
  submittedAt: string | null
  decidedAt: string | null
  externalReference: string | null
  recordedByName: string | null
  recordedAt: string | null
  feeAmount: number | null
  findings: string | null
}

export function usePermits(projectId?: string) {
  return useQuery({
    queryKey: procurementKeys.permits(projectId),
    queryFn: async (): Promise<Permit[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      let query = supabase
        .from('permits')
        .select(
          'id, project_id, permit_type, authority, status, submitted_at, decided_at, external_reference, recorded_at, fee_amount, findings, project:projects(reference), recorder:profiles(full_name)',
        )
        .order('created_at', { ascending: true })

      if (projectId) query = query.eq('project_id', projectId)

      const { data, error } = await query
      if (error) throwReadable(error)

      return (data ?? []).map((row) => ({
        id: row.id,
        projectId: row.project_id,
        projectReference: row.project?.reference ?? '—',
        permitType: row.permit_type,
        authority: row.authority,
        status: row.status,
        submittedAt: row.submitted_at,
        decidedAt: row.decided_at,
        externalReference: row.external_reference,
        recordedByName: row.recorder?.full_name ?? null,
        recordedAt: row.recorded_at,
        feeAmount: row.fee_amount === null ? null : Number(row.fee_amount),
        findings: row.findings,
      }))
    },
  })
}

export function useCreatePermit() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      projectId: string
      permitType: PermitType
      authority: string
      feeAmount?: number
    }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      const { error } = await supabase.from('permits').insert({
        project_id: input.projectId,
        permit_type: input.permitType,
        authority: input.authority.trim(),
        fee_amount: input.feeAmount ?? null,
        status: 'preparing',
      })
      if (error) throwReadable(error)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ops', 'permits'] })
    },
  })
}

/**
 * Record what an outside body decided.
 *
 * `recorded_by` is sent explicitly here rather than left to a trigger, because
 * the database CONSTRAINT requires it — `permits_decision_needs_recorder`
 * refuses an approval or rejection that does not say who entered it and when.
 * Without that, a status change months later is indistinguishable from a
 * decision that was actually made.
 *
 * The audit entry the trigger writes is severity `warning`, not `info`: this is
 * an employee asserting an external outcome, and that is worth being able to
 * find later.
 */
export function useRecordPermitDecision() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      permitId: string
      status: PermitStatus
      externalReference?: string
      findings?: string
      userId: string
    }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const isDecision = input.status === 'approved' || input.status === 'rejected'

      if (isDecision && !input.externalReference?.trim()) {
        // Not a database rule, a practical one: an approval nobody can look up
        // at the issuing body is not much better than no approval.
        throw new Error(
          'Please enter the reference number the authority gave you. It is what makes this checkable later.',
        )
      }

      const { data, error } = await supabase
        .from('permits')
        .update({
          status: input.status,
          external_reference: input.externalReference?.trim() || null,
          findings: input.findings?.trim() || null,
          decided_at: isDecision ? new Date().toISOString() : null,
          recorded_by: isDecision ? input.userId : null,
          recorded_at: isDecision ? new Date().toISOString() : null,
          submitted_at:
            input.status === 'submitted' || input.status === 'under_review'
              ? new Date().toISOString()
              : undefined,
        })
        .eq('id', input.permitId)
        .select('id')

      if (error) {
        if (error.message.includes('permits_decision_needs_recorder')) {
          throw new Error('A decision must record who entered it. Please sign in again.')
        }
        throw readableDbError(error)
      }
      if ((data?.length ?? 0) === 0) {
        throw new Error('That permit could not be updated. You may not have permission.')
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ops'] })
    },
  })
}

/* ============================================================================
   SUPPLIERS
   ========================================================================== */

export interface Supplier {
  id: string
  name: string
  contactPerson: string | null
  leadTimeDays: number
}

export function useSuppliers() {
  return useQuery({
    queryKey: procurementKeys.suppliers,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Supplier[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      const { data, error } = await supabase
        .from('suppliers')
        .select('id, name, contact_person, lead_time_days')
        .eq('is_active', true)
        .order('name')
      if (error) throwReadable(error)
      return (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        contactPerson: row.contact_person,
        leadTimeDays: row.lead_time_days,
      }))
    },
  })
}

/* ============================================================================
   PURCHASE ORDERS
   ========================================================================== */

export type PoStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'ordered'
  | 'partially_received'
  | 'received'
  | 'cancelled'

export interface PurchaseOrderLine {
  id: string
  stockItemId: string
  itemName: string
  sku: string
  quantity: number
  unitCost: number
  quantityReceived: number
  lineTotal: number
}

export interface PurchaseOrder {
  id: string
  poNumber: string
  supplierName: string
  status: PoStatus
  totalAmount: number
  expectedAt: string | null
  receivedAt: string | null
  supplierReference: string | null
  supplierInvoiceRef: string | null
  matchedAt: string | null
  approvedAt: string | null
  createdAt: string
  lines: PurchaseOrderLine[]
}

export function usePurchaseOrders() {
  return useQuery({
    queryKey: procurementKeys.purchaseOrders,
    queryFn: async (): Promise<PurchaseOrder[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('purchase_orders')
        .select(
          'id, po_number, status, total_amount, expected_at, received_at, supplier_reference, supplier_invoice_ref, matched_at, approved_at, created_at, supplier:suppliers(name), lines:purchase_order_lines(id, stock_item_id, quantity, unit_cost, quantity_received, line_total, item:stock_items(name, sku))',
        )
        .order('created_at', { ascending: false })
        .limit(50)

      if (error) throwReadable(error)

      return (data ?? []).map((row) => ({
        id: row.id,
        poNumber: row.po_number,
        supplierName: row.supplier?.name ?? 'Unknown supplier',
        status: row.status,
        totalAmount: Number(row.total_amount),
        expectedAt: row.expected_at,
        receivedAt: row.received_at,
        supplierReference: row.supplier_reference,
        supplierInvoiceRef: row.supplier_invoice_ref,
        matchedAt: row.matched_at,
        approvedAt: row.approved_at,
        createdAt: row.created_at,
        lines: (row.lines ?? []).map((line) => ({
          id: line.id,
          stockItemId: line.stock_item_id,
          itemName: line.item?.name ?? 'Unknown item',
          sku: line.item?.sku ?? '',
          quantity: Number(line.quantity),
          unitCost: Number(line.unit_cost),
          quantityReceived: Number(line.quantity_received),
          lineTotal: Number(line.line_total),
        })),
      }))
    },
  })
}

/**
 * Raise a purchase order with its lines.
 *
 * The total is summed from the lines rather than accepted from the caller. It
 * is what the requisition-approval trigger compares against the limit, so
 * letting the browser name it would make that limit advisory.
 */
export function useCreatePurchaseOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      supplierId: string
      expectedAt?: string
      notes?: string
      lines: { stockItemId: string; quantity: number; unitCost: number }[]
    }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      if (input.lines.length === 0) throw new Error('Add at least one item to order.')

      const total = input.lines.reduce((sum, l) => sum + l.quantity * l.unitCost, 0)

      const { data: po, error } = await supabase
        .from('purchase_orders')
        .insert({
          supplier_id: input.supplierId,
          status: 'draft',
          total_amount: total,
          expected_at: input.expectedAt ?? null,
          notes: input.notes?.trim() || null,
        })
        .select('id, po_number')
        .single()

      if (error) throwReadable(error)

      const { error: linesError } = await supabase.from('purchase_order_lines').insert(
        input.lines.map((line) => ({
          purchase_order_id: po.id,
          stock_item_id: line.stockItemId,
          quantity: line.quantity,
          unit_cost: line.unitCost,
        })),
      )

      if (linesError) {
        // An order with no lines is worse than no order: it looks like work in
        // progress and orders nothing.
        await supabase.from('purchase_orders').delete().eq('id', po.id)
        throw linesError
      }

      return po
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inv'] })
    },
  })
}

/** Approve, subject to the requisition limit the database enforces. */
export function useApprovePurchaseOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { id: string; status: 'approved' | 'ordered' | 'cancelled' }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('purchase_orders')
        .update({ status: input.status })
        .eq('id', input.id)
        .select('id')

      if (error) {
        // The limit message names the amount and the limit, so it is worth
        // showing verbatim rather than replacing with something vaguer.
        if (error.code === '42501') throw new Error(error.message)
        throw readableDbError(error)
      }
      if ((data?.length ?? 0) === 0) {
        throw new Error('That purchase order could not be updated. You may not have permission.')
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inv'] })
    },
  })
}

/**
 * Record a delivery.
 *
 * Setting the status is all this does; the database turns it into stock. The
 * trigger writes a `receipt` movement per line, and the ledger trigger from
 * 0008 raises `on_hand` from that — so the warehouse balance stays exactly the
 * sum of its movements and the delivery is traceable to the order that brought
 * it in.
 */
export function useReceivePurchaseOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { id: string; supplierReference?: string }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('purchase_orders')
        .update({
          status: 'received',
          supplier_reference: input.supplierReference?.trim() || null,
        })
        .eq('id', input.id)
        .select('id')

      if (error) throwReadable(error)
      if ((data?.length ?? 0) === 0) {
        throw new Error('That delivery could not be recorded.')
      }
    },
    onSuccess: () => {
      // Receiving moves stock, so the inventory screens are stale too.
      void queryClient.invalidateQueries({ queryKey: ['inv'] })
      void queryClient.invalidateQueries({ queryKey: ['ops'] })
    },
  })
}

/**
 * The three-way match: purchase order, delivery, supplier invoice.
 *
 * Recorded rather than enforced, deliberately. The point of a three-way match
 * is that a human compares three documents and says they agree; a system that
 * ticked it automatically would be recording that the comparison happened when
 * it had not.
 */
export function useMatchPurchaseOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { id: string; supplierInvoiceRef: string; userId: string }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      if (!input.supplierInvoiceRef.trim()) {
        throw new Error("Enter the supplier's invoice number.")
      }

      const { error } = await supabase
        .from('purchase_orders')
        .update({
          supplier_invoice_ref: input.supplierInvoiceRef.trim(),
          matched_at: new Date().toISOString(),
          matched_by: input.userId,
        })
        .eq('id', input.id)

      if (error) throwReadable(error)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inv'] })
    },
  })
}
