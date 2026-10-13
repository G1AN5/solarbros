import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { toAsset, toInvoice } from './mappers'
import { readableDbError, throwReadable } from '@/lib/db-error'
import { NOT_CONNECTED, supabase } from '@/lib/supabase'
import type { Invoice, SerializedAsset, StockItem } from '@/types/domain'

/* ============================================================================
   INVENTORY & FINANCE
   ----------------------------------------------------------------------------
   Feeds /admin/inventory, /admin/assets and /admin/finance.

   TWO NUMBERS THAT ARE NEVER WRITTEN DIRECTLY
   `stock_items.on_hand` and `invoices.amount_paid` are both derived. on_hand is
   the sum of the movement ledger; amount_paid is the sum of verified payments.
   Both are maintained by triggers in migration 0008, so the balance can never
   drift from the events that produced it.

   That is why there is no "set stock level" mutation here. Correcting a count
   posts an ADJUSTMENT movement, which leaves an explanation behind. Overwriting
   the number directly would leave a stock figure nobody can account for, and
   turn every future discrepancy into an argument.
   ========================================================================== */

export const invKeys = {
  stock: ['inv', 'stock'] as const,
  assets: ['inv', 'assets'] as const,
  invoices: ['fin', 'invoices'] as const,
}

/* ============================================================================
   STOCK
   ========================================================================== */

export function useStock() {
  return useQuery({
    queryKey: invKeys.stock,
    queryFn: async (): Promise<StockItem[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('stock_items')
        .select('*')
        .order('category')
        .order('name')

      if (error) throwReadable(error)

      return (data ?? []).map((row) => ({
        id: row.id,
        sku: row.sku,
        name: row.name,
        category: row.category,
        brand: row.brand ?? '',
        onHand: Number(row.on_hand),
        reserved: Number(row.reserved),
        reorderPoint: Number(row.reorder_point),
        unitCost: Number(row.unit_cost),
        unit: row.unit ?? 'pc',
        isSerialised: Boolean(row.is_serialised),
      }))
    },
  })
}

/**
 * Adjust stock by posting a movement, never by overwriting the balance.
 *
 * `quantity` is signed: positive receives, negative writes off. The trigger
 * applies it to on_hand, so the ledger and the balance are updated in the same
 * transaction and cannot disagree.
 */
export function usePostStockMovement() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      stockItemId: string
      quantity: number
      movementType: 'receipt' | 'issue' | 'consumption' | 'return' | 'adjustment' | 'write_off'
      note?: string
      projectId?: string
    }) => {
      if (!supabase) throw new Error('Not connected to the backend.')
      if (input.quantity === 0) throw new Error('Enter a quantity to add or remove.')

      const { error } = await supabase.from('stock_movements').insert({
        stock_item_id: input.stockItemId,
        movement_type: input.movementType,
        quantity: input.quantity,
        note: input.note ?? null,
        project_id: input.projectId ?? null,
      })
      if (error) throwReadable(error)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: invKeys.stock })
    },
  })
}

/* ============================================================================
   SERIALISED ASSETS
   ========================================================================== */

export interface AssetWithProject extends SerializedAsset {
  clientName: string
  projectReference: string
  siteAddress: string
}

export function useAllAssets() {
  return useQuery({
    queryKey: invKeys.assets,
    queryFn: async (): Promise<AssetWithProject[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('serialised_assets')
        .select(
          '*, project:projects(reference, address), client:profiles!serialised_assets_client_id_fkey(full_name)',
        )
        .order('installed_at', { ascending: false })

      if (error) throwReadable(error)

      return (data ?? []).map((row) => ({
        ...toAsset(row),
        clientName: row.client?.full_name ?? 'Unassigned',
        projectReference: row.project?.reference ?? '',
        siteAddress: row.project?.address ?? '',
      }))
    },
  })
}

/* ============================================================================
   FINANCE
   ========================================================================== */

export interface InvoiceWithClient extends Invoice {
  projectReference: string
}

export function useAllInvoices() {
  return useQuery({
    queryKey: invKeys.invoices,
    queryFn: async (): Promise<InvoiceWithClient[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('invoices')
        .select(
          '*, client:profiles!invoices_client_id_fkey(full_name), project:projects(reference)',
        )
        .order('issued_at', { ascending: false })

      if (error) throwReadable(error)

      return (data ?? []).map((row) => ({
        ...toInvoice(row, row.client?.full_name ?? 'Unknown'),
        projectReference: row.project?.reference ?? '',
      }))
    },
  })
}

/**
 * Record a payment against an invoice.
 *
 * RECORDED AND VERIFIED ARE NOT THE SAME EVENT. A payment is recorded when
 * somebody says the money arrived, and verified when it has been matched
 * against the bank statement. Only a VERIFIED payment counts towards
 * `amount_paid` — treating the first as settlement would let an unconfirmed
 * transfer mark a contract paid and release the next milestone of work.
 *
 * SMALL PAYMENTS ARE RECORDED AND VERIFIED IN ONE STEP; LARGE ONES ARE NOT.
 * Above `finance.dual_control_threshold` the database requires a second person
 * to verify (migration 0022). That is the standard control against the obvious
 * fraud: recording a fictitious payment to cover a cash shortfall, or marking a
 * friend's invoice settled. Asking the accountant to fetch a colleague for
 * every PHP 500 is theatre, which is why it is a threshold and not a blanket
 * rule — and why the threshold is a setting the company owns.
 *
 * The threshold is read here, rather than assumed, so the button can say what
 * is about to happen instead of surprising the accountant with a refusal. The
 * database enforces it regardless of what this function decides.
 */
export function useRecordPayment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      invoiceId: string
      amount: number
      method:
        | 'bank_transfer'
        | 'cash'
        | 'cheque'
        | 'gcash'
        | 'maya'
        | 'credit_card'
        | 'financing'
        | 'grabpay'
        | 'qrph'
        | 'online_banking'
      reference?: string
      note?: string
    }): Promise<{ awaitingVerification: boolean }> => {
      if (!supabase) throw new Error('Not connected to the backend.')
      if (input.amount <= 0) throw new Error('Enter an amount greater than zero.')

      const { data: thresholdRow } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'finance.dual_control_threshold')
        .maybeSingle()

      /* 0 means OFF, and getting this wrong is worse than it looks. Read
         literally, `amount >= 0` is true for every payment ever recorded — so
         the accountant would record money, see it marked "awaiting
         verification", and watch the invoice balance not move. The database
         trigger applies the same rule; both have to agree or the screen and
         the ledger tell different stories. */
      const threshold = Number(thresholdRow?.value ?? 0)
      const needsSecondPerson = threshold > 0 && input.amount >= threshold

      // `recorded_by` is not sent. The trigger fills it from the session, so
      // the audit trail cannot be attributed to a colleague.
      const { error } = await supabase.from('payments').insert({
        invoice_id: input.invoiceId,
        amount: input.amount,
        payment_method: input.method,
        reference: input.reference ?? null,
        note: input.note ?? null,
        verified: !needsSecondPerson,
      })

      if (error) {
        // The overpayment guard raises a sentence written for a person; pass it
        // through rather than replacing it with something vaguer.
        if (error.message.includes('outstanding')) throw new Error(error.message)
        throw readableDbError(error)
      }

      return { awaitingVerification: needsSecondPerson }
    },
    onSuccess: () => {
      // The payment trigger recalculates the invoice AND the project total, so
      // both the finance screens and the customer's billing page are stale.
      void queryClient.invalidateQueries({ queryKey: ['fin'] })
      void queryClient.invalidateQueries({ queryKey: ['ops'] })
      void queryClient.invalidateQueries({ queryKey: ['client'] })
      void queryClient.invalidateQueries({ queryKey: ['payments'] })
    },
  })
}

/* ============================================================================
   RMA CLAIMS
   ----------------------------------------------------------------------------
   "File RMA" sat on every row of the asset registry and did nothing, which
   made the whole registry decorative: the reason for recording a serial and an
   install date is that a manufacturer will not honour a claim without them.

   The claim opens as 'draft'. The manufacturer does not use this system, so
   everything after this - filed, assessed, approved - is recorded on their
   behalf through the proxy fields described in 0003, and the audit trail says
   who recorded each step rather than pretending the manufacturer typed it.
   ========================================================================== */

export function useFileRma() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      assetId: string
      manufacturer: string
      faultDescription: string
      ticketId?: string | null
    }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('rma_claims')
        .insert({
          serialised_asset_id: input.assetId,
          manufacturer: input.manufacturer.trim(),
          fault_description: input.faultDescription.trim(),
          ticket_id: input.ticketId ?? null,
          status: 'draft',
        })
        // claim_reference comes from a sequence default (0040), never from here.
        .select('id, claim_reference')
        .single()

      if (error) throwReadable(error)
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inv'] })
      void queryClient.invalidateQueries({ queryKey: ['ops'] })
    },
  })
}

/* ============================================================================
   AD-HOC INVOICING AND COLLECTIONS
   ----------------------------------------------------------------------------
   Invoices are normally raised BY MILESTONES, and that coupling is what keeps
   billing honest. But not everything is a milestone: a chargeable service call,
   a replacement part outside warranty, an agreed variation. Without a manual
   route those were invoiced outside the system entirely, which is worse than
   allowing one - the ledger stops being the record.
   ========================================================================== */

export function useCreateInvoice() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      projectId: string
      clientId?: string | null
      stage: 'down_payment' | 'delivery' | 'commissioning' | 'retention'
      amount: number
      dueAt: string
      notes?: string
    }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      if (!(input.amount > 0)) throw new Error('An invoice needs an amount above zero.')

      const { data, error } = await supabase
        .from('invoices')
        .insert({
          project_id: input.projectId,
          client_id: input.clientId ?? null,
          stage: input.stage,
          amount: input.amount,
          // 'sent', not 'draft': it was raised deliberately by a person and the
          // customer needs to see it. A draft nobody remembers to send is how
          // receivables age.
          status: 'sent',
          issued_at: new Date().toISOString().slice(0, 10),
          due_at: input.dueAt,
          notes: input.notes?.trim() || null,
          /* Marks it as raised by a person. Migration 0049 applies the
             one-per-stage rule only to the invoices the milestone triggers
             raise, so a second service call on the same roof can be invoiced
             without the first one blocking it — while a retried trigger still
             cannot bill the same milestone twice. */
          is_manual: true,
        })
        // invoice_number comes from the sequence default added in 0041.
        .select('id, invoice_number')
        .single()

      if (error) throwReadable(error)
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['fin'] })
      void queryClient.invalidateQueries({ queryKey: ['inv'] })
      void queryClient.invalidateQueries({ queryKey: ['client'] })
    },
  })
}

/**
 * Chase every overdue invoice at once.
 *
 * One notification per invoice rather than one per customer: a customer with
 * two overdue invoices needs to know which, and the row carries the entity id
 * so their portal can link straight to it.
 *
 * Written into `notifications`, not sent from the browser. The dispatch worker
 * (0028) owns delivery, applies the customer's channel preferences and records
 * failures - none of which a fetch from this screen could do.
 */
export function useSendCollectionReminders() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      invoices: { id: string; number: string; clientId: string | null; balance: number }[]
    }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const rows = input.invoices
        // No account, nobody to notify. Those are chased by phone.
        .filter((i) => i.clientId)
        .map((i) => ({
          user_id: i.clientId,
          title: `Payment reminder · ${i.number}`,
          body:
            `Invoice ${i.number} is past its due date with ` +
            `PHP ${i.balance.toLocaleString('en-PH')} outstanding. ` +
            'You can settle it from the Billing page in your portal.',
          channel: 'in_app' as const,
          category: 'billing',
          entity: 'invoices',
          entity_id: i.id,
        }))

      if (rows.length === 0) {
        throw new Error('None of the overdue invoices belong to a customer with a portal account.')
      }

      const { error } = await supabase.from('notifications').insert(rows)
      if (error) throwReadable(error)
      return rows.length
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['client'] })
      void queryClient.invalidateQueries({ queryKey: ['admin'] })
    },
  })
}

/** How many claims are still with the manufacturer. */
export function useOpenRmaCount() {
  return useQuery({
    queryKey: ['inv', 'rma', 'open'],
    staleTime: 60_000,
    queryFn: async (): Promise<number> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { count, error } = await supabase
        .from('rma_claims')
        .select('id', { count: 'exact', head: true })
        // Closed and replacement_received are finished; the rest are open.
        .in('status', ['draft', 'filed', 'under_assessment', 'approved'])

      if (error) throwReadable(error)
      return count ?? 0
    },
  })
}

/* ============================================================================
   THE CATALOGUE
   ----------------------------------------------------------------------------
   There was no way to add a stock item. Every product in the system came from
   the seed migration, which meant the warehouse could not stock a panel the
   company had started selling without a developer writing SQL — and it meant
   the system could not be populated with a real catalogue at all.

   WHAT THIS DELIBERATELY WILL NOT WRITE
   `on_hand` and `reserved`. Both are maintained elsewhere and only elsewhere:
   the balance moves when a movement is posted, and the reservation when a
   contract is signed. Letting a form set them directly would let somebody type
   a warehouse balance that no movement explains, which is the difference
   between a stock system and a spreadsheet.

   Opening stock therefore goes in as a MOVEMENT, not as a starting number, so
   the ledger explains the balance from the very first unit.
   ========================================================================== */

export interface StockItemInput {
  id?: string
  sku: string
  name: string
  category: 'panel' | 'inverter' | 'battery' | 'racking' | 'charge_controller' | 'accessory'
  brand?: string
  unit: string
  unitCost: number
  reorderPoint: number
  isSerialised: boolean
}

export function useSaveStockItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: StockItemInput) => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const row = {
        sku: input.sku.trim().toUpperCase(),
        name: input.name.trim(),
        category: input.category,
        brand: input.brand?.trim() || null,
        unit: input.unit.trim() || 'pc',
        unit_cost: input.unitCost,
        reorder_point: input.reorderPoint,
        is_serialised: input.isSerialised,
      }

      const query = input.id
        ? supabase.from('stock_items').update(row).eq('id', input.id).select('id')
        : supabase.from('stock_items').insert(row).select('id')

      const { data, error } = await query

      if (error) {
        // 23505 on a unique SKU is the most likely mistake here, and the raw
        // message is not something a warehouse manager should have to read.
        if (error.code === '23505') {
          throw new Error(`The SKU ${row.sku} is already in use by another item.`)
        }
        throw readableDbError(error)
      }

      /* A policy-filtered write returns 200 with zero rows rather than an
         error, so treating "no error" as success would report a save that
         never happened. */
      if (!data || data.length === 0) {
        throw new Error(
          'That was refused. Only the inventory manager or an administrator may edit the catalogue.',
        )
      }
      return data[0]
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inv'] })
    },
  })
}

/**
 * Remove an item from the catalogue.
 *
 * Refused by the database if anything references it — a movement, a
 * reservation or a purchase order line all hold it with ON DELETE RESTRICT.
 * That is the right outcome: an item with history is part of the record, and
 * the honest way to retire it is to let its stock run to zero and stop
 * ordering it.
 */
export function useDeleteStockItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { id: string }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('stock_items')
        .delete()
        .eq('id', input.id)
        .select('id')

      if (error) {
        if (error.code === '23503') {
          throw new Error(
            'This item has movements or reservations against it, so it cannot be deleted. Let its stock run down instead.',
          )
        }
        throw readableDbError(error)
      }
      if (!data || data.length === 0) {
        throw new Error('That was refused, or the item had already gone.')
      }
      return data[0]
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inv'] })
    },
  })
}

/* ============================================================================
   WARRANTY CLAIMS WITH THE MANUFACTURER (RMA)
   ----------------------------------------------------------------------------
   A claim could be opened and then nothing: there was no list of claims and no
   way to record that it had been filed, what the manufacturer decided, or
   that the replacement arrived. The manufacturer has no login here, so each
   step is recorded on their behalf; the database stamps who recorded it and
   when (0072), and marks the old unit replaced when its replacement arrives.
   ========================================================================== */

export type RmaStatus =
  | 'draft'
  | 'filed'
  | 'under_assessment'
  | 'approved'
  | 'rejected'
  | 'replacement_received'
  | 'closed'

export interface RmaClaim {
  id: string
  reference: string
  status: RmaStatus
  manufacturer: string
  faultDescription: string
  externalReference: string | null
  decisionNotes: string | null
  filedAt: string | null
  decisionAt: string | null
  createdAt: string
  serialNumber: string
  productName: string
  projectReference: string
  clientName: string
}

export function useRmaClaims() {
  return useQuery({
    queryKey: ['inv', 'rma', 'claims'],
    queryFn: async (): Promise<RmaClaim[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      const { data, error } = await supabase
        .from('rma_claims')
        .select(
          'id, claim_reference, status, manufacturer, fault_description, external_reference, decision_notes, filed_at, decision_at, created_at, asset:serialised_assets!rma_claims_serialised_asset_id_fkey(serial_number, product_name, project:projects(reference), client:profiles!serialised_assets_client_id_fkey(full_name))',
        )
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throwReadable(error)
      return (data ?? []).map((row) => ({
        id: row.id,
        reference: row.claim_reference,
        status: row.status,
        manufacturer: row.manufacturer,
        faultDescription: row.fault_description,
        externalReference: row.external_reference,
        decisionNotes: row.decision_notes,
        filedAt: row.filed_at,
        decisionAt: row.decision_at,
        createdAt: row.created_at,
        serialNumber: row.asset?.serial_number ?? '',
        productName: row.asset?.product_name ?? '',
        projectReference: row.asset?.project?.reference ?? '',
        clientName: row.asset?.client?.full_name ?? '',
      }))
    },
  })
}

export function useUpdateRma() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      id: string
      status: RmaStatus
      externalReference?: string
      decisionNotes?: string
    }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      const { data, error } = await supabase
        .from('rma_claims')
        .update({
          status: input.status,
          external_reference: input.externalReference?.trim() || null,
          decision_notes: input.decisionNotes?.trim() || null,
        })
        .eq('id', input.id)
        .select('id')
      if (error) throwReadable(error)
      if ((data?.length ?? 0) === 0) {
        throw new Error('That claim could not be updated — your role may not change it.')
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inv'] })
      void queryClient.invalidateQueries({ queryKey: ['ops'] })
    },
  })
}
