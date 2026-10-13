import { useMutation, useQuery } from '@tanstack/react-query'

import type { ApplianceLoad, EstimatorResult } from '@/lib/solar-estimator'
import { throwReadable } from '@/lib/db-error'
import { NOT_CONNECTED, supabase } from '@/lib/supabase'

/* ============================================================================
   PUBLIC FORM SUBMISSIONS
   ----------------------------------------------------------------------------
   The three doors into the business, all of which land in the CRM:

     /estimator  -> lead (source 'estimator') + the full appliance profile
     /contact    -> lead (source 'quote_request')
     /booking    -> lead + appointment (status 'requested')

   EVERY ONE GOES THROUGH AN RPC, NOT A TABLE WRITE
   Migration 0021 replaced the open anon INSERT policies with three functions.
   Three reasons, in increasing order of how much they mattered:

     1. Validation lives on the server. Browser checks are a courtesy to the
        person filling the form; they stop nobody who opens devtools.

     2. Submissions are throttled per email address.

     3. The estimator could not have worked otherwise. It needs the new lead's
        id in order to attach the estimate to it, and reading an id back is a
        SELECT — which anon is rightly refused. Doing both inserts inside one
        function sidesteps the problem instead of weakening the policy to get
        around it.

   The functions return nothing. A caller therefore learns only whether the
   submission succeeded, which is all a form needs and all a stranger should get.
   ========================================================================== */

/* ============================================================================
   ESTIMATOR
   ----------------------------------------------------------------------------
   The appliance profile is the most valuable thing a visitor ever gives us. It
   says what the household actually runs and when — which no monthly-bill figure
   can — so the site survey starts from real information rather than a blank
   form.

   The computed outputs are sent along and stored as a snapshot. If the panel
   price changes next month, the customer's saved estimate still shows the
   figures they were shown, not silently rewritten ones.
   ========================================================================== */

export interface EstimatorSubmission {
  name: string
  email: string
  phone: string
  address: string
  appliances: ApplianceLoad[]
  usagePattern: string
  regionId: string
  ratePerKwh: number
  roofAreaSqm?: number
  statedMonthlyBill?: number
  result: EstimatorResult
}

export function useSubmitEstimate() {
  return useMutation({
    mutationFn: async (input: EstimatorSubmission) => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { error } = await supabase.rpc('submit_estimate', {
        p_name: input.name,
        p_email: input.email,
        p_phone: input.phone,
        p_address: input.address,
        p_appliances: input.appliances as never,
        p_estimate: {
          usagePattern: input.usagePattern,
          regionId: input.regionId,
          ratePerKwh: input.ratePerKwh,
          roofAreaSqm: input.roofAreaSqm ?? null,
          statedMonthlyBill: input.statedMonthlyBill ?? null,
          currentMonthlyCost: input.result.currentMonthlyCost,
          peakLoadW: input.result.peakLoadW,
          dailyWh: input.result.dailyWh,
          monthlyKwh: input.result.monthlyKwh,
          recommendedKw: input.result.recommendedKw,
          systemType: input.result.systemType,
          panelCount: input.result.panelCount,
          inverterKw: input.result.inverterKw,
          batteryCount: input.result.batteryCount,
          estimatedCost: input.result.estimatedCost,
          monthlySavings: input.result.monthlySavings,
          paybackYears: input.result.paybackYears,
        } as never,
      })

      if (error) throw asReadableError(error)
    },
  })
}

/* ============================================================================
   CONTACT / QUOTE REQUEST
   Higher intent than the estimator: they asked for a person.
   ========================================================================== */

export function useSubmitEnquiry() {
  return useMutation({
    mutationFn: async (input: {
      name: string
      email: string
      phone?: string
      address?: string
      monthlyBill?: number
      message?: string
    }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { error } = await supabase.rpc('submit_enquiry', {
        p_name: input.name,
        p_email: input.email,
        p_phone: input.phone ?? undefined,
        p_address: input.address ?? undefined,
        p_monthly_bill: input.monthlyBill ?? undefined,
        p_message: input.message ?? undefined,
      })

      if (error) throw asReadableError(error)
    },
  })
}

/* ============================================================================
   BOOKING
   ----------------------------------------------------------------------------
   Creates an appointment with status 'requested' and NO crew assigned. It lands
   at the top of the dispatch board, where a coordinator assigns somebody — which
   is what moves it to 'dispatched' and notifies the customer.

   Deliberately not auto-assigned: the coordinator is balancing the whole crew's
   day and their travel between sites, and a booking form can see neither.
   ========================================================================== */

export function useRequestBooking() {
  return useMutation({
    mutationFn: async (input: {
      type: 'virtual_consultation' | 'site_survey'
      date: string
      timeSlot: string
      name: string
      email: string
      phone: string
      address?: string
      notes?: string
    }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { error } = await supabase.rpc('request_booking', {
        p_appointment_type: input.type,
        p_scheduled_date: input.date,
        p_time_slot: input.timeSlot,
        p_name: input.name,
        p_email: input.email,
        p_phone: input.phone,
        p_address: input.address ?? undefined,
        p_notes: input.notes ?? undefined,
      })

      if (error) throw asReadableError(error)
    },
  })
}

/* ============================================================================
   ERROR TRANSLATION
   ----------------------------------------------------------------------------
   The functions raise messages written for the customer — "Please choose a date
   that has not already passed" — under SQLSTATEs chosen to mark them as such:

     22023  invalid parameter value   -> a validation message, safe to show
     53400  configuration limit       -> the rate limit, safe to show

   Anything else is an internal fault. Showing its text would leak table and
   constraint names to whoever asked, so it is replaced with a plain sentence
   and the original is kept only for development builds.
   ========================================================================== */

const SAFE_TO_SHOW = new Set(['22023', '53400'])

function asReadableError(error: { code?: string; message: string }): Error {
  if (error.code && SAFE_TO_SHOW.has(error.code)) {
    return new Error(error.message)
  }
  return new Error(
    import.meta.env.DEV
      ? `${error.message} (code ${error.code ?? 'none'})`
      : 'Something went wrong at our end. Please try again, or call us.',
  )
}

/* ============================================================================
   BOOKING AVAILABILITY
   ----------------------------------------------------------------------------
   The calendar used to compute this in the browser with
   `(day + hour) % 3 !== 0` — arithmetic that greyed out a third of the slots at
   random and happily let a visitor book one that was already full.

   The real count cannot be read directly: counting appointments requires
   SELECT on the table, which would hand every anonymous visitor the company's
   diary — names, addresses, visit times. `available_slots` is a SECURITY
   DEFINER function that returns only a slot and a yes/no.

   ADVISORY, NOT AUTHORITATIVE. Anyone can call the endpoint and ignore what it
   says, so `request_booking` counts again inside the write. Two people looking
   at the same free slot is normal, and the second one has to be refused.
   ========================================================================== */

export interface SlotAvailability {
  slot: string
  available: boolean
  remaining: number
}

export function useAvailableSlots(date?: string) {
  return useQuery({
    queryKey: ['public', 'slots', date ?? 'none'],
    enabled: Boolean(date),
    // Somebody else may take the slot while this visitor is filling the form.
    staleTime: 30_000,
    queryFn: async (): Promise<SlotAvailability[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase.rpc('available_slots', { p_date: date! })
      if (error) throwReadable(error)

      return (data as SlotAvailability[] | null) ?? []
    },
  })
}

/**
 * Dates the company has closed — holidays, stock-takes — so the public
 * calendar can grey them out before anybody picks one. Only the date and the
 * reason are readable, by design (0065).
 */
export function useClosedDates() {
  return useQuery({
    queryKey: ['public', 'closed-dates'],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<string[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      const now = new Date()
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      const { data, error } = await supabase
        .from('booking_blackouts')
        .select('blackout_date')
        .gte('blackout_date', today)
      if (error) throwReadable(error)
      return (data ?? []).map((row) => row.blackout_date)
    },
  })
}
