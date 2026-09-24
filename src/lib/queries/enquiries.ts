import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useAuth } from '@/app/auth/useAuth'
import { NOT_CONNECTED, supabase } from '@/lib/supabase'

/* ============================================================================
   THE PROSPECT INBOX
   ----------------------------------------------------------------------------
   Everything a stranger sends from the public site already lands in the
   database: /contact and /booking both write a full lead — name, email, phone,
   address, and the message they typed — and a booking additionally writes an
   appointment. None of it was lost.

   What was missing is a screen. The CRM board shows a name, a stage and a
   score, and none of the contact details, so a rep looking at a quotation
   request could not see the email address they were meant to reply to.

   HOW A PROSPECT IS TRACKED BEFORE THEY HAVE AN ACCOUNT
   By their email address, which is the only identifier they have given. The
   rep replies from their own mail client — the quotation is a PDF attached to
   an email, which this system does not send — and records here that they did.

   If that person later registers on the site with the same address,
   `handle_new_user` claims their leads, contracts, projects, invoices and
   appointments and attaches the lot to the new account. So the history written
   here is not stranded: it becomes their customer record the moment they sign
   up, with no extra step for anybody.
   ========================================================================== */

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
  stage: string
  createdAt: string
  firstContactedAt: string | null
  quotationSentAt: string | null
  convertedClientId: string | null
  /** Derived, and the only thing the list actually sorts on. */
  status: 'new' | 'contacted' | 'quoted' | 'converted'
}

export interface VisitRequest {
  id: string
  appointmentType: string
  scheduledDate: string
  timeSlot: string
  status: string
  contactName: string | null
  contactPhone: string | null
  address: string | null
  notes: string | null
  createdAt: string
  /** Pulled through the lead, because that is where the email lives. */
  email: string | null
  leadId: string | null
}

export const enquiryKeys = {
  list: ['enquiries'] as const,
  visits: ['enquiries', 'visits'] as const,
  blackouts: ['enquiries', 'blackouts'] as const,
}

function statusOf(row: {
  converted_client_id: string | null
  quotation_sent_at: string | null
  first_contacted_at: string | null
}): Enquiry['status'] {
  if (row.converted_client_id) return 'converted'
  if (row.quotation_sent_at) return 'quoted'
  if (row.first_contacted_at) return 'contacted'
  return 'new'
}

export function useEnquiries() {
  return useQuery({
    queryKey: enquiryKeys.list,
    queryFn: async (): Promise<Enquiry[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('leads')
        /* One unbroken literal. supabase-js infers the row type from the TEXT
           of this string, so splitting it with `+` turns the result into
           GenericStringError and every field access fails to compile. */
        .select(
          `id, name, email, phone, address, location, monthly_bill, estimated_kw, qualification_notes, source, stage, created_at, first_contacted_at, quotation_sent_at, converted_client_id`,
        )
        // Somebody who has reached contract or installation is a customer now,
        // and belongs on the CRM board rather than in an inbox of new enquiries.
        .not('stage', 'in', '("installed","lost")')
        .order('created_at', { ascending: false })
        .limit(200)

      if (error) throw error

      return (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        address: row.address,
        location: row.location,
        monthlyBill: row.monthly_bill !== null ? Number(row.monthly_bill) : null,
        estimatedKw: row.estimated_kw !== null ? Number(row.estimated_kw) : null,
        message: row.qualification_notes,
        source: row.source,
        stage: row.stage,
        createdAt: row.created_at,
        firstContactedAt: row.first_contacted_at,
        quotationSentAt: row.quotation_sent_at,
        convertedClientId: row.converted_client_id,
        status: statusOf(row),
      }))
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
          `id, appointment_type, scheduled_date, time_slot, status, contact_name, contact_phone, address, notes, created_at, lead_id, leads ( email )`,
        )
        // The ones nobody has answered yet come first; a confirmed visit is the
        // dispatch board's problem, not this page's.
        .in('status', ['requested', 'confirmed'])
        .order('scheduled_date', { ascending: true })
        .limit(200)

      if (error) throw error

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
        email: row.leads?.email ?? null,
        leadId: row.lead_id,
      }))
    },
  })
}

/* ----------------------------------------------------------------------------
   RECORDING WHAT WAS DONE OUTSIDE THIS SYSTEM
   The reply and the quotation are sent from somebody's own mail client. All
   this records is that it happened, and who did it — which is the difference
   between a prospect being handled and one being ignored.
   -------------------------------------------------------------------------- */

export function useMarkEnquiry() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { leadId: string; what: 'contacted' | 'quoted' }) => {
      if (!supabase || !user) throw new Error(NOT_CONNECTED)

      const now = new Date().toISOString()

      /* Built inline rather than as a Record<string, unknown>, so the generated
         column types still check it. A loosely typed patch object compiles
         happily and would let a typo reach the database as a silently ignored
         column. */
      const patch =
        input.what === 'contacted'
          ? { first_contacted_at: now, contacted_by: user.id }
          : {
              quotation_sent_at: now,
              contacted_by: user.id,
              // Sending a quotation IS the pipeline moving; recording it here
              // and leaving the board saying "new" would be two truths.
              stage: 'quoted' as const,
              // Somebody who was quoted was obviously contacted, even if the
              // rep never pressed the first button.
              first_contacted_at: now,
            }

      const { data, error } = await supabase
        .from('leads')
        .update(patch)
        .eq('id', input.leadId)
        .select()

      if (error) throw error
      if (!data || data.length === 0) {
        throw new Error('That was not saved — you may not have permission to update this lead.')
      }
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
        .select()

      if (error) throw error
      if (!data || data.length === 0) {
        throw new Error('That visit was not updated — you may not have permission.')
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: enquiryKeys.visits })
      void queryClient.invalidateQueries({ queryKey: ['ops'] })
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

      if (error) throw error
      return (data ?? []).map((row) => ({ date: row.blackout_date, reason: row.reason }))
    },
  })
}

export function useAddBlackout() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { date: string; reason: string }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { error } = await supabase.from('booking_blackouts').insert({
        blackout_date: input.date,
        reason: input.reason.trim() || null,
        created_by: user?.id ?? null,
      })

      if (error) {
        if (error.code === '23505') throw new Error('That date is already closed.')
        throw error
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: enquiryKeys.blackouts })
    },
  })
}

export function useRemoveBlackout() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (date: string) => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      const { error } = await supabase.from('booking_blackouts').delete().eq('blackout_date', date)
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: enquiryKeys.blackouts })
    },
  })
}
