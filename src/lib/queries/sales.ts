import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { readableDbError, throwReadable } from '@/lib/db-error'
import { NOT_CONNECTED, supabase } from '@/lib/supabase'
import type { SystemType } from '@/types/domain'

/* ============================================================================
   QUOTATIONS AND CONTRACTS
   ----------------------------------------------------------------------------
   The spine of the flow diagram between "a lead is interested" and "there is a
   project":

     quotation (draft)
        │  send
        ▼
     quotation (sent)  ──accept──▶  contract (awaiting_client)
                                        │  customer signs in the portal
                                        ▼
                                    contract (awaiting_company)
                                        │  administrator counter-signs
                                        ▼
                                    contract (executed)
                                        │
                        ┌───────────────┼────────────────┐
                        ▼               ▼                ▼
                     project      stock reserved   down-payment invoice

   THE LAST STEP IS NOT IN THIS FILE, AND THAT IS DELIBERATE
   Everything below the executed contract happens in a database trigger
   (`on_contract_executed`, migration 0008). Doing it here would mean a dropped
   connection between "contract executed" and "project created" leaves a signed
   contract with no project, no reserved stock and no invoice — and nothing to
   tell anyone it happened. In a trigger it is one transaction: all of it, or
   none of it.

   REFERENCE NUMBERS ARE NOT GENERATED HERE EITHER
   `QTN-2026-1000` comes from a Postgres sequence, as a column default
   (migration 0024). Two reps clicking Save at the same instant cannot be handed
   the same number, which is not true of anything the browser could compute.
   ========================================================================== */

export const salesKeys = {
  quotations: ['sales', 'quotations'] as const,
  contracts: ['sales', 'contracts'] as const,
  myContracts: (userId?: string) => ['sales', 'my-contracts', userId ?? 'none'] as const,
}

/* ============================================================================
   QUOTATIONS
   ========================================================================== */

export interface QuotationLineInput {
  stockItemId?: string
  description: string
  quantity: number
  unitPrice: number
}

export interface QuotationRow {
  id: string
  reference: string
  leadId: string
  leadName: string
  systemKw: number
  systemType: SystemType
  materialCost: number
  labourCost: number
  marginPct: number
  discountPct: number
  totalPrice: number
  status: 'draft' | 'pending_approval' | 'sent' | 'accepted' | 'rejected' | 'expired'
  validUntil: string | null
  createdAt: string
  hasContract: boolean
}

export function useQuotations() {
  return useQuery({
    queryKey: salesKeys.quotations,
    queryFn: async (): Promise<QuotationRow[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('quotations')
        .select(
          'id, reference, lead_id, system_kw, system_type, material_cost, labour_cost, margin_pct, discount_pct, total_price, status, valid_until, created_at, lead:leads(name), contracts(id)',
        )
        .order('created_at', { ascending: false })
        .limit(50)

      if (error) throwReadable(error)

      return (data ?? []).map((row) => ({
        id: row.id,
        reference: row.reference,
        leadId: row.lead_id,
        leadName: row.lead?.name ?? 'Unknown',
        systemKw: Number(row.system_kw),
        systemType: row.system_type,
        materialCost: Number(row.material_cost),
        labourCost: Number(row.labour_cost),
        marginPct: Number(row.margin_pct),
        discountPct: Number(row.discount_pct),
        totalPrice: Number(row.total_price),
        status: row.status,
        validUntil: row.valid_until,
        createdAt: row.created_at,
        // A quotation that already produced a contract must not produce a
        // second one, or the customer is billed twice for one system.
        hasContract: (row.contracts?.length ?? 0) > 0,
      }))
    },
  })
}

export interface SaveQuotationInput {
  leadId: string
  packageId?: string
  systemKw: number
  systemType: SystemType
  panelCount?: number
  batteryCount?: number
  materialCost: number
  labourCost: number
  marginPct: number
  discountPct: number
  totalPrice: number
  validDays: number
  lines: QuotationLineInput[]
}

/**
 * Save a draft quotation and its bill of materials.
 *
 * The BOM is written as `quotation_lines` rather than recomputed on demand.
 * The recipe and the stock catalogue both change over time, so a quote
 * regenerated in March would not match the one the customer was sent in
 * January — and the customer has the January one in their inbox.
 */
export function useSaveQuotation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: SaveQuotationInput): Promise<{ id: string; reference: string }> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const validUntil = new Date(Date.now() + input.validDays * 86_400_000)
        .toISOString()
        .slice(0, 10)

      /* Quotations are VERSIONED PER LEAD — `unique (lead_id, version)`. That is
         deliberate: a customer who negotiates gets v2, v3, and the earlier ones
         stay readable, so "what did we actually offer them in January?" has an
         answer. Defaulting to version 1 means the second quote for any lead is
         rejected, which is what happened the first time this was tried against
         a lead that already had one. */
      async function nextVersion(): Promise<number> {
        const { data: latest } = await supabase!
          .from('quotations')
          .select('version')
          .eq('lead_id', input.leadId)
          .order('version', { ascending: false })
          .limit(1)
          .maybeSingle()
        return (latest?.version ?? 0) + 1
      }

      /* A QUOTATION WORTH NOTHING IS NOT A QUOTATION.

         The bill of materials prices itself from the stock catalogue. With an
         empty catalogue every line is zero, so material cost, labour and the
         total all come out at ₱0 — and it saved happily, looked accepted, and
         then failed at the contract, where the database requires a value above
         zero. The reader saw a raw constraint name for a mistake made three
         screens earlier.

         Refused here, where the cause can still be named. */
      if (!(input.totalPrice > 0)) {
        throw new Error(
          'This quotation comes to ₱0, so there is nothing to quote. The bill of materials prices itself from your stock catalogue — if that is empty, add your panels, inverters and batteries under Inventory first.',
        )
      }

      async function insertAt(version: number) {
        return supabase!
          .from('quotations')
          .insert({
            lead_id: input.leadId,
            package_id: input.packageId ?? null,
            version,
            system_kw: input.systemKw,
            system_type: input.systemType,
            panel_count: input.panelCount ?? null,
            battery_count: input.batteryCount ?? 0,
            material_cost: input.materialCost,
            labour_cost: input.labourCost,
            margin_pct: input.marginPct,
            discount_pct: input.discountPct,
            total_price: input.totalPrice,
            valid_until: validUntil,
            status: 'draft',
          })
          .select('id, reference')
          .single()
      }

      let { data: quotation, error } = await insertAt(await nextVersion())

      /* Read-then-write cannot be atomic from a browser, so two reps quoting the
         same lead at the same instant can both compute the same version and one
         loses on the constraint. Recomputing and retrying once costs nothing and
         turns a confusing error into a saved quotation. */
      if (error?.code === '23505') {
        ;({ data: quotation, error } = await insertAt(await nextVersion()))
      }

      if (error) {
        // The discount authority trigger (migration 0008) raises a sentence
        // written for a person. Pass it through rather than replacing it.
        if (error.message.includes('authority')) throw new Error(error.message)
        throw readableDbError(error)
      }
      if (!quotation) throw new Error('The quotation could not be saved.')

      if (input.lines.length > 0) {
        const { error: linesError } = await supabase.from('quotation_lines').insert(
          input.lines.map((line, index) => ({
            quotation_id: quotation.id,
            stock_item_id: line.stockItemId ?? null,
            description: line.description,
            quantity: line.quantity,
            unit_price: line.unitPrice,
            sort_order: index,
          })),
        )
        // The quotation is the thing that matters; a missing line can be added
        // by hand. Losing the quotation because one line failed cannot.
        if (linesError && import.meta.env.DEV) {
          console.warn('[SolarBros] Quotation lines not saved:', linesError.message)
        }
      }

      return quotation
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: salesKeys.quotations })
    },
  })
}

export function useSendQuotation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { id: string }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('quotations')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', input.id)
        .select('id')

      if (error) {
        if (error.message.includes('authority')) throw new Error(error.message)
        throw readableDbError(error)
      }
      if ((data?.length ?? 0) === 0) {
        throw new Error('That quotation could not be sent. You may not have permission.')
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: salesKeys.quotations })
    },
  })
}

export function useSetQuotationStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { id: string; status: 'accepted' | 'rejected'; reason?: string }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { error } = await supabase
        .from('quotations')
        .update({
          status: input.status,
          responded_at: new Date().toISOString(),
          rejection_reason:
            input.status === 'rejected' ? (input.reason ?? 'No reason given') : null,
        })
        .eq('id', input.id)

      if (error) throwReadable(error)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: salesKeys.quotations })
    },
  })
}

/* ============================================================================
   CONTRACTS
   ========================================================================== */

export interface ContractRow {
  id: string
  reference: string
  quotationId: string
  clientId: string | null
  clientName: string
  contractValue: number
  downPaymentPct: number
  deliveryPct: number
  commissioningPct: number
  status: 'draft' | 'awaiting_client' | 'awaiting_company' | 'executed' | 'cancelled'
  clientSignedAt: string | null
  clientSignatureName: string | null
  companySignedAt: string | null
  createdAt: string
}

function mapContract(row: {
  id: string
  reference: string
  quotation_id: string
  client_id: string | null
  contract_value: string | number
  down_payment_pct: string | number
  delivery_pct: string | number
  commissioning_pct: string | number
  status: ContractRow['status']
  client_signed_at: string | null
  client_signature_name: string | null
  company_signed_at: string | null
  created_at: string
  client?: { full_name: string } | null
}): ContractRow {
  return {
    id: row.id,
    reference: row.reference,
    quotationId: row.quotation_id,
    clientId: row.client_id,
    clientName: row.client?.full_name ?? 'Unassigned',
    contractValue: Number(row.contract_value),
    downPaymentPct: Number(row.down_payment_pct),
    deliveryPct: Number(row.delivery_pct),
    commissioningPct: Number(row.commissioning_pct),
    status: row.status,
    clientSignedAt: row.client_signed_at,
    clientSignatureName: row.client_signature_name,
    companySignedAt: row.company_signed_at,
    createdAt: row.created_at,
  }
}

const CONTRACT_COLUMNS =
  'id, reference, quotation_id, client_id, contract_value, down_payment_pct, delivery_pct, commissioning_pct, status, client_signed_at, client_signature_name, company_signed_at, created_at, client:profiles!contracts_client_id_fkey(full_name)'

export function useContracts() {
  return useQuery({
    queryKey: salesKeys.contracts,
    queryFn: async (): Promise<ContractRow[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      const { data, error } = await supabase
        .from('contracts')
        .select(CONTRACT_COLUMNS)
        .order('created_at', { ascending: false })
      if (error) throwReadable(error)
      return (data ?? []).map(mapContract)
    },
  })
}

/** The customer's own contracts, for the signing screen in the portal. */
export function useMyContracts(userId?: string) {
  return useQuery({
    queryKey: salesKeys.myContracts(userId),
    enabled: !!userId,
    queryFn: async (): Promise<ContractRow[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      const { data, error } = await supabase
        .from('contracts')
        .select(CONTRACT_COLUMNS)
        .eq('client_id', userId!)
        .order('created_at', { ascending: false })
      if (error) throwReadable(error)
      return (data ?? []).map(mapContract)
    },
  })
}

/**
 * Turn an accepted quotation into a contract awaiting the customer's signature.
 *
 * The payment split comes from settings rather than the three hardcoded
 * defaults on the column, so changing company policy changes new contracts
 * without a deploy — and does not retroactively alter contracts already signed.
 */
export function useCreateContract() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      quotationId: string
      leadId: string
      clientId?: string
      contractValue: number
    }): Promise<{ id: string; reference: string }> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      /* Attach the contract to the customer's portal account if they have one.
         Without this the contract exists but nobody can sign it: the signing
         card matches on client_id, so an unlinked contract is invisible to the
         very person who has to act on it, and visibly stuck to everyone else.

         A lead with no account yet is legitimate — sales raises the contract,
         and it is linked when the portal account is created. */
      let clientId = input.clientId
      if (!clientId) {
        const { data: lead } = await supabase
          .from('leads')
          .select('converted_client_id')
          .eq('id', input.leadId)
          .maybeSingle()
        clientId = lead?.converted_client_id ?? undefined
      }

      const { data: settings } = await supabase
        .from('settings')
        .select('key, value')
        .in('key', [
          'finance.down_payment_pct',
          'finance.delivery_pct',
          'finance.commissioning_pct',
        ])

      const pct = (key: string, fallback: number) => {
        const found = settings?.find((s) => s.key === key)
        const n = Number(found?.value)
        return Number.isFinite(n) ? n : fallback
      }

      const down = pct('finance.down_payment_pct', 50)
      const delivery = pct('finance.delivery_pct', 35)
      const commissioning = pct('finance.commissioning_pct', 15)

      // The database refuses a split that does not total 100, which would issue
      // invoices that never fully bill the customer. Catching it here means the
      // message names the setting rather than a constraint.
      if (down + delivery + commissioning !== 100) {
        throw new Error(
          `The payment stages in Settings add up to ${down + delivery + commissioning}%, not 100%. Fix them before raising a contract.`,
        )
      }

      /* Guarded for the same reason as the stage split just above: a quotation
         saved before that check existed can still be sitting at ₱0, and the
         database would refuse it with a constraint name rather than a reason. */
      if (!(input.contractValue > 0)) {
        throw new Error(
          'That quotation is worth ₱0, so there is nothing to put in a contract. Rebuild it once your stock catalogue has the equipment in it, then accept the new version.',
        )
      }

      const { data, error } = await supabase
        .from('contracts')
        .insert({
          quotation_id: input.quotationId,
          lead_id: input.leadId,
          client_id: clientId ?? null,
          contract_value: input.contractValue,
          down_payment_pct: down,
          delivery_pct: delivery,
          commissioning_pct: commissioning,
          status: 'awaiting_client',
        })
        .select('id, reference')
        .single()

      if (error) throwReadable(error)
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: salesKeys.contracts })
      void queryClient.invalidateQueries({ queryKey: salesKeys.quotations })
      /* The customer is the other party. Without this their portal shows
         nothing to sign until they happen to reload - and a contract they do
         not know exists is a contract that does not get signed. */
      void queryClient.invalidateQueries({ queryKey: ['client'] })
    },
  })
}

/**
 * The customer signs, from their own portal.
 *
 * Only three fields are sent, and the database would refuse the rest anyway:
 * migration 0023 limits a customer to exactly this. That migration exists
 * because the signing policy previously let a customer rewrite their contract
 * value to one peso and forge our counter-signature.
 */
export function useSignContract() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { contractId: string; signatureName: string }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      if (input.signatureName.trim().length < 2) {
        throw new Error('Please type your full name to sign.')
      }

      const { data, error } = await supabase
        .from('contracts')
        .update({
          client_signed_at: new Date().toISOString(),
          client_signature_name: input.signatureName.trim(),
          status: 'awaiting_company',
        })
        .eq('id', input.contractId)
        .select('id')

      if (error) {
        if (error.code === '42501') throw new Error(error.message)
        throw readableDbError(error)
      }
      if ((data?.length ?? 0) === 0) {
        throw new Error('That contract could not be signed. Please refresh and try again.')
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sales'] })
      void queryClient.invalidateQueries({ queryKey: ['client'] })
    },
  })
}

/**
 * Counter-sign, which executes the contract.
 *
 * This is the single most consequential click in the application. Reaching
 * 'executed' fires `on_contract_executed`: the project is created, warehouse
 * stock is reserved against it, the down-payment invoice is raised and the lead
 * moves to 'contract' — all in one transaction with this update.
 */
export function useCounterSignContract() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { contractId: string; userId: string }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('contracts')
        .update({
          company_signed_at: new Date().toISOString(),
          company_signed_by: input.userId,
          status: 'executed',
        })
        .eq('id', input.contractId)
        .select('id')

      if (error) {
        if (error.message.includes('signatures')) {
          throw new Error('The customer has not signed this contract yet.')
        }
        // Reserving stock fails when the warehouse cannot cover the bill of
        // materials. That is the reservation doing its job, so say so.
        if (error.message.toLowerCase().includes('stock')) {
          throw new Error(
            `Not enough stock to reserve for this contract. Raise a purchase order first. (${error.message})`,
          )
        }
        throw readableDbError(error)
      }
      if ((data?.length ?? 0) === 0) {
        throw new Error('That contract could not be counter-signed.')
      }
    },
    onSuccess: () => {
      // Executing touches projects, stock, invoices and the lead pipeline.
      void queryClient.invalidateQueries({ queryKey: ['sales'] })
      void queryClient.invalidateQueries({ queryKey: ['ops'] })
      void queryClient.invalidateQueries({ queryKey: ['fin'] })
      void queryClient.invalidateQueries({ queryKey: ['crm'] })
      void queryClient.invalidateQueries({ queryKey: ['inv'] })
      /* And the customer most of all: counter-signing is the moment their
         project, their milestones and their first invoice come into
         existence. Their portal was the one place not being refreshed. */
      void queryClient.invalidateQueries({ queryKey: ['client'] })
    },
  })
}
