import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useAuth } from '@/app/auth/useAuth'
import { findAppliance, REGIONS, USAGE_PATTERNS } from '@/lib/appliances'
import { assertWritten, readableDbError, throwReadable } from '@/lib/db-error'
import type { ApplianceLoad } from '@/lib/solar-estimator'
import { NOT_CONNECTED, supabase } from '@/lib/supabase'
import type { AppointmentStatus, AppointmentType, LeadStage, SystemType } from '@/types/domain'

/* ============================================================================
   THE PROSPECT INBOX
   ----------------------------------------------------------------------------
   Everything a person sends from the public site lands in the database: the
   contact form and the booking page write a full lead, a booking adds the
   visit, and the estimator stores the whole appliance profile behind its lead.

   WHAT THIS FILE USED TO MISS
   The inbox read the lead row and nothing behind it. So for an estimator
   submission — the richest thing anybody ever sends us — a rep saw a name and
   an email address, and none of the appliances, the usage pattern, the roof
   area or the system the visitor had been recommended. A booking showed in the
   enquiries list with no hint that a visit was attached to it. And whether the
   person already had an account, a quotation or a signed contract with us was
   invisible, so the same household was treated as a stranger every time they
   wrote in.

   Every enquiry now carries all of it, in one query, so the page can show the
   full submission and what has happened since.

   HOW A PROSPECT IS TRACKED
   By their email address until they have an account, and by their account
   from then on. Linking is done by the database the moment a record is written
   (migration 0071), so an existing customer's new enquiry arrives already
   attached to them.
   ========================================================================== */

/* --- Shapes ---------------------------------------------------------------- */

export interface EstimateAppliance {
  name: string
  watts: number
  quantity: number
  hoursPerDay: number
  isInverterType: boolean
  custom: boolean
}

export interface EstimateDetail {
  id: string
  createdAt: string
  appliances: EstimateAppliance[]
  usagePattern: string
  region: string
  ratePerKwh: number | null
  roofAreaSqm: number | null
  statedMonthlyBill: number | null
  peakLoadW: number
  dailyWh: number
  monthlyKwh: number
  recommendedKw: number | null
  systemType: SystemType | null
  panelCount: number | null
  inverterKw: number | null
  batteryCount: number
  estimatedCost: number | null
  monthlySavings: number | null
  paybackYears: number | null
}

export interface EnquiryVisit {
  id: string
  type: AppointmentType
  date: string
  timeSlot: string
  status: AppointmentStatus
  address: string | null
  notes: string | null
  contactPhone: string | null
  createdAt: string
}

export type EnquiryOrigin =
  'estimator' | 'booking' | 'contact' | 'upgrade' | 'walk_in' | 'referral' | 'facebook'

export const ORIGIN_LABEL: Record<EnquiryOrigin, string> = {
  estimator: 'Estimator',
  booking: 'Book a visit',
  contact: 'Contact form',
  upgrade: 'Upgrade request',
  walk_in: 'Walk-in / phone',
  referral: 'Referral',
  facebook: 'Facebook',
}

export interface Enquiry {
  id: string
  name: string
  email: string
  phone: string | null
  address: string | null
  location: string | null
  monthlyBill: number | null
  estimatedKw: number | null
  message: string | null
  source: string
  origin: EnquiryOrigin
  stage: LeadStage
  score: number
  createdAt: string
  firstContactedAt: string | null
  quotationSentAt: string | null
  convertedClientId: string | null
  /** The customer account this enquiry belongs to, when there is one. */
  account: { name: string; email: string; phone: string | null } | null
  ownerName: string | null
  estimates: EstimateDetail[]
  visits: EnquiryVisit[]
  quotations: { id: string; reference: string; status: string; totalPrice: number }[]
  contract: { id: string; reference: string; status: string } | null
  /** Derived, and what the list sorts and filters on. */
  status: 'new' | 'contacted' | 'quoted' | 'won' | 'lost'
}

export interface VisitRequest {
  id: string
  appointmentType: AppointmentType
  scheduledDate: string
  timeSlot: string
  status: AppointmentStatus
  contactName: string | null
  contactPhone: string | null
  address: string | null
  notes: string | null
  createdAt: string
  /** From the lead, or from the customer's account. */
  email: string | null
  leadId: string | null
  /** Set when the visit belongs to a customer account. */
  accountName: string | null
  projectReference: string | null
  ticketId: string | null
  /** Where the request came from. */
  origin: 'public_booking' | 'customer_portal' | 'office'
}

export const enquiryKeys = {
  list: ['enquiries'] as const,
  one: (leadId: string) => ['enquiries', 'one', leadId] as const,
  visits: ['enquiries', 'visits'] as const,
  blackouts: ['enquiries', 'blackouts'] as const,
}

/* --- Reading --------------------------------------------------------------- */

/* One unbroken literal. supabase-js infers the row type from the TEXT of this
   string, so splitting it with `+` turns the result into GenericStringError
   and every field access fails to compile. */
const ENQUIRY_SELECT = `id, name, email, phone, address, location, monthly_bill, estimated_kw, qualification_notes, source, stage, score, created_at, first_contacted_at, quotation_sent_at, converted_client_id, owner:profiles!leads_assigned_to_fkey(full_name), account:profiles!leads_converted_client_id_fkey(full_name, email, phone), estimates(id, created_at, appliances, usage_pattern, region_id, rate_per_kwh, roof_area_sqm, stated_monthly_bill, peak_load_w, daily_wh, monthly_kwh, recommended_kw, system_type, panel_count, inverter_kw, battery_count, estimated_cost, monthly_savings, payback_years), appointments!appointments_lead_id_fkey(id, appointment_type, scheduled_date, time_slot, status, address, notes, contact_phone, created_at), quotations!quotations_lead_id_fkey(id, reference, status, total_price, created_at), contracts!contracts_lead_id_fkey(id, reference, status, created_at)`

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function appliancesFrom(raw: unknown): EstimateAppliance[] {
  if (!Array.isArray(raw)) return []
  return (raw as ApplianceLoad[]).map((load) => {
    const spec = findAppliance(load.applianceId)
    return {
      name: load.custom?.name ?? spec?.name ?? load.applianceId,
      watts: load.custom?.watts ?? spec?.watts ?? 0,
      quantity: Number(load.quantity ?? 0),
      hoursPerDay: Number(load.hoursPerDay ?? 0),
      isInverterType: Boolean(load.isInverterType),
      custom: Boolean(load.custom),
    }
  })
}

function originOf(row: {
  source: string
  qualification_notes: string | null
  estimates: unknown[] | null
  appointments: unknown[] | null
}): EnquiryOrigin {
  if (row.source === 'estimator' || (row.estimates?.length ?? 0) > 0) return 'estimator'
  if ((row.appointments?.length ?? 0) > 0 && row.source === 'quote_request') return 'booking'
  if (row.source === 'referral' && row.qualification_notes?.startsWith('UPGRADE REQUEST')) {
    return 'upgrade'
  }
  if (row.source === 'quote_request') return 'contact'
  return row.source as EnquiryOrigin
}

type EnquiryRow = {
  id: string
  name: string
  email: string
  phone: string | null
  address: string | null
  location: string | null
  monthly_bill: number | string | null
  estimated_kw: number | string | null
  qualification_notes: string | null
  source: string
  stage: LeadStage
  score: number
  created_at: string
  first_contacted_at: string | null
  quotation_sent_at: string | null
  converted_client_id: string | null
  owner: { full_name: string } | null
  account: { full_name: string; email: string; phone: string | null } | null
  estimates: Record<string, unknown>[] | null
  appointments: Record<string, unknown>[] | null
  quotations: Record<string, unknown>[] | null
  contracts: Record<string, unknown>[] | null
}

function toEnquiry(row: EnquiryRow): Enquiry {
  const estimates: EstimateDetail[] = (row.estimates ?? [])
    .map((e) => ({
      id: String(e.id),
      createdAt: String(e.created_at),
      appliances: appliancesFrom(e.appliances),
      usagePattern:
        USAGE_PATTERNS.find((p) => p.id === e.usage_pattern)?.label ??
        String(e.usage_pattern ?? ''),
      region: REGIONS.find((r) => r.id === e.region_id)?.label ?? String(e.region_id ?? ''),
      ratePerKwh: num(e.rate_per_kwh),
      roofAreaSqm: num(e.roof_area_sqm),
      statedMonthlyBill: num(e.stated_monthly_bill),
      peakLoadW: num(e.peak_load_w) ?? 0,
      dailyWh: num(e.daily_wh) ?? 0,
      monthlyKwh: num(e.monthly_kwh) ?? 0,
      recommendedKw: num(e.recommended_kw),
      systemType: (e.system_type as SystemType | null) ?? null,
      panelCount: num(e.panel_count),
      inverterKw: num(e.inverter_kw),
      batteryCount: num(e.battery_count) ?? 0,
      estimatedCost: num(e.estimated_cost),
      monthlySavings: num(e.monthly_savings),
      paybackYears: num(e.payback_years),
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))

  const visits: EnquiryVisit[] = (row.appointments ?? [])
    .map((a) => ({
      id: String(a.id),
      type: a.appointment_type as AppointmentType,
      date: String(a.scheduled_date),
      timeSlot: String(a.time_slot),
      status: a.status as AppointmentStatus,
      address: (a.address as string | null) ?? null,
      notes: (a.notes as string | null) ?? null,
      contactPhone: (a.contact_phone as string | null) ?? null,
      createdAt: String(a.created_at),
    }))
    .sort((a, b) => (a.date < b.date ? 1 : -1))

  const quotations = (row.quotations ?? [])
    .map((q) => ({
      id: String(q.id),
      reference: String(q.reference),
      status: String(q.status),
      totalPrice: num(q.total_price) ?? 0,
      createdAt: String(q.created_at),
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))

  const liveContract = (row.contracts ?? [])
    .filter((c) => c.status !== 'cancelled')
    .sort((a, b) => (String(a.created_at) < String(b.created_at) ? 1 : -1))[0]

  const status: Enquiry['status'] =
    row.stage === 'lost'
      ? 'lost'
      : liveContract && liveContract.status === 'executed'
        ? 'won'
        : row.quotation_sent_at || quotations.some((q) => q.status !== 'draft')
          ? 'quoted'
          : row.first_contacted_at
            ? 'contacted'
            : 'new'

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    location: row.location,
    monthlyBill: num(row.monthly_bill),
    estimatedKw: num(row.estimated_kw),
    message: row.qualification_notes,
    source: row.source,
    origin: originOf(row),
    stage: row.stage,
    score: row.score,
    createdAt: row.created_at,
    firstContactedAt: row.first_contacted_at,
    quotationSentAt: row.quotation_sent_at,
    convertedClientId: row.converted_client_id,
    account: row.account
      ? { name: row.account.full_name, email: row.account.email, phone: row.account.phone }
      : null,
    ownerName: row.owner?.full_name ?? null,
    estimates,
    visits,
    quotations: quotations.map(({ id, reference, status: s, totalPrice }) => ({
      id,
      reference,
      status: s,
      totalPrice,
    })),
    contract: liveContract
      ? {
          id: String(liveContract.id),
          reference: String(liveContract.reference),
          status: String(liveContract.status),
        }
      : null,
    status,
  }
}

export function useEnquiries() {
  return useQuery({
    queryKey: enquiryKeys.list,
    queryFn: async (): Promise<Enquiry[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('leads')
        .select(ENQUIRY_SELECT)
        .order('created_at', { ascending: false })
        .limit(300)

      if (error) throwReadable(error)
      return ((data ?? []) as unknown as EnquiryRow[]).map(toEnquiry)
    },
  })
}

/** One lead with everything behind it — for the CRM's detail view. */
export function useEnquiry(leadId: string | null | undefined) {
  return useQuery({
    queryKey: enquiryKeys.one(leadId ?? 'none'),
    enabled: Boolean(leadId),
    queryFn: async (): Promise<Enquiry | null> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('leads')
        .select(ENQUIRY_SELECT)
        .eq('id', leadId!)
        .maybeSingle()

      if (error) throwReadable(error)
      return data ? toEnquiry(data as unknown as EnquiryRow) : null
    },
  })
}

export function useVisitRequests() {
  return useQuery({
    queryKey: enquiryKeys.visits,
    queryFn: async (): Promise<VisitRequest[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('appointments')
        .select(
          `id, appointment_type, scheduled_date, time_slot, status, contact_name, contact_phone, address, notes, created_at, lead_id, client_id, ticket_id, created_by, lead:leads!appointments_lead_id_fkey(email), account:profiles!appointments_client_id_fkey(full_name, email), project:projects!appointments_project_id_fkey(reference)`,
        )
        // The ones nobody has answered yet come first; once a crew is on a
        // visit it is the dispatch board's business, not this page's.
        .in('status', ['requested', 'confirmed'])
        .order('scheduled_date', { ascending: true })
        .limit(200)

      if (error) throwReadable(error)

      return (data ?? []).map((row) => ({
        id: row.id,
        appointmentType: row.appointment_type,
        scheduledDate: row.scheduled_date,
        timeSlot: row.time_slot,
        status: row.status,
        contactName: row.contact_name,
        contactPhone: row.contact_phone,
        address: row.address,
        notes: row.notes,
        createdAt: row.created_at,
        email: row.lead?.email ?? row.account?.email ?? null,
        leadId: row.lead_id,
        accountName: row.account?.full_name ?? null,
        projectReference: row.project?.reference ?? null,
        ticketId: row.ticket_id,
        /* Who asked: a stranger on the booking page (it has a lead), the
           customer from their portal (they created it themselves — or, for
           visits from before 0071 recorded the creator, nobody did), or the
           office on somebody's behalf. */
        origin: row.lead_id
          ? ('public_booking' as const)
          : row.client_id && (row.created_by === row.client_id || row.created_by === null)
            ? ('customer_portal' as const)
            : ('office' as const),
      }))
    },
  })
}

/* ----------------------------------------------------------------------------
   RECORDING WHAT WAS DONE OUTSIDE THIS SYSTEM
   The reply is sent from somebody's own mail client. All this records is that
   it happened, and who did it — which is the difference between a prospect
   being handled and one being ignored.
   -------------------------------------------------------------------------- */

export function useMarkEnquiry() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      leadId: string
      what: 'contacted' | 'quoted'
      stage: LeadStage
    }) => {
      if (!supabase || !user) throw new Error(NOT_CONNECTED)

      const now = new Date().toISOString()

      /* Built inline rather than as a Record<string, unknown>, so the generated
         column types still check it. */
      const patch =
        input.what === 'contacted'
          ? { first_contacted_at: now, contacted_by: user.id }
          : {
              quotation_sent_at: now,
              contacted_by: user.id,
              first_contacted_at: now,
              /* Sending a quotation moves the pipeline — but only FORWARD. It
                 used to set 'quoted' unconditionally, so pressing this on a
                 customer whose contract was already signed moved them back to
                 "Quoted" on the CRM board. */
              ...(input.stage === 'new' ? { stage: 'quoted' as const } : {}),
            }

      const { data, error } = await supabase
        .from('leads')
        .update(patch)
        .eq('id', input.leadId)
        .select('id')

      if (error) throwReadable(error)
      assertWritten(data, 'That was not saved — you may not have permission to update this lead.')
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: enquiryKeys.list })
      void queryClient.invalidateQueries({ queryKey: ['crm'] })
    },
  })
}

export function useSetVisitStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      id: string
      status: 'confirmed' | 'cancelled'
      reason?: string
    }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('appointments')
        .update({
          status: input.status,
          ...(input.reason ? { cancelled_reason: input.reason } : {}),
        })
        .eq('id', input.id)
        .select('id')

      if (error) throwReadable(error)
      assertWritten(data, 'That visit was not updated — you may not have permission.')
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['enquiries'] })
      void queryClient.invalidateQueries({ queryKey: ['ops'] })
      void queryClient.invalidateQueries({ queryKey: ['client'] })
    },
  })
}

/* ----------------------------------------------------------------------------
   DATES THE COMPANY IS CLOSED
   -------------------------------------------------------------------------- */

export interface Blackout {
  date: string
  reason: string | null
}

export function useBlackouts() {
  return useQuery({
    queryKey: enquiryKeys.blackouts,
    queryFn: async (): Promise<Blackout[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('booking_blackouts')
        .select('blackout_date, reason')
        .gte('blackout_date', new Date().toISOString().slice(0, 10))
        .order('blackout_date')

      if (error) throwReadable(error)
      return (data ?? []).map((row) => ({ date: row.blackout_date, reason: row.reason }))
    },
  })
}

export function useAddBlackout() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { date: string; reason: string }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      // `created_by` defaults to the session (0072).
      const { error } = await supabase.from('booking_blackouts').insert({
        blackout_date: input.date,
        reason: input.reason.trim() || null,
      })

      if (error) {
        if (error.code === '23505') throw new Error('That date is already closed.')
        throw readableDbError(error)
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: enquiryKeys.blackouts })
      void queryClient.invalidateQueries({ queryKey: ['public', 'blackouts'] })
    },
  })
}

export function useRemoveBlackout() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (date: string) => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      const { error } = await supabase.from('booking_blackouts').delete().eq('blackout_date', date)
      if (error) throwReadable(error)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: enquiryKeys.blackouts })
      void queryClient.invalidateQueries({ queryKey: ['public', 'blackouts'] })
    },
  })
}
