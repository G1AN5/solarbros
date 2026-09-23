import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { NOT_CONNECTED, supabase } from '@/lib/supabase'
import type { Lead, LeadStage, Package } from '@/types/domain'

/* ============================================================================
   CRM — leads, pipeline and packages
   ----------------------------------------------------------------------------
   Feeds /admin/crm and /admin/quotes.

   Lead scoring is NOT computed here. A trigger in migration 0008 recalculates
   it on every write, so the score is identical whether a lead arrives from the
   public estimator, a contact form, or a rep typing it in by hand. Scoring in
   the browser would give three different answers for the same prospect.
   ========================================================================== */

export const crmKeys = {
  leads: ['crm', 'leads'] as const,
  packages: ['crm', 'packages'] as const,
}

/* --- Leads ---------------------------------------------------------------- */

export function useLeads() {
  return useQuery({
    queryKey: crmKeys.leads,
    queryFn: async (): Promise<Lead[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('leads')
        .select('*, assigned:profiles!leads_assigned_to_fkey(full_name)')
        .order('created_at', { ascending: false })

      if (error) throw error

      return (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone ?? '',
        location: row.location ?? '',
        monthlyBill: Number(row.monthly_bill ?? 0),
        estimatedKw: Number(row.estimated_kw ?? 0),
        stage: row.stage,
        score: row.score,
        source: row.source,
        assignedTo: row.assigned?.full_name ?? 'Unassigned',
        createdAt: row.created_at,
      }))
    },
  })
}

/**
 * Move a lead along the pipeline.
 *
 * The database requires a reason when a lead is marked lost — see the
 * `leads_lost_needs_reason` constraint. Without one, "why did we lose it?"
 * becomes unanswerable at exactly the review meeting where it matters.
 */
export function useUpdateLeadStage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { id: string; stage: LeadStage; lostReason?: string }) => {
      if (!supabase) throw new Error('Not connected to the backend.')

      const { error } = await supabase
        .from('leads')
        .update({
          stage: input.stage,
          lost_reason: input.stage === 'lost' ? (input.lostReason ?? 'No reason given') : null,
        })
        .eq('id', input.id)

      if (error) {
        if (error.message.includes('leads_lost_needs_reason')) {
          throw new Error('Please record why this opportunity was lost.')
        }
        throw error
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: crmKeys.leads })
    },
  })
}

export function useCreateLead() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      name: string
      email: string
      phone?: string
      location?: string
      monthlyBill?: number
      estimatedKw?: number
      source?: Lead['source']
    }) => {
      if (!supabase) throw new Error('Not connected to the backend.')
      const { error } = await supabase.from('leads').insert({
        name: input.name,
        email: input.email,
        phone: input.phone ?? null,
        location: input.location ?? null,
        monthly_bill: input.monthlyBill ?? null,
        estimated_kw: input.estimatedKw ?? null,
        source: input.source ?? 'walk_in',
      })
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: crmKeys.leads })
    },
  })
}

/**
 * Correct a lead's details.
 *
 * `useUpdateLeadStage` existed, so a rep could move somebody down the pipeline
 * but could not fix a mistyped phone number on the way — and a lead is captured
 * from a public form by someone typing on a phone, which is where mistyped
 * numbers come from. A pipeline full of leads nobody can ring is not a
 * pipeline.
 *
 * Deliberately does NOT write `stage`, `score`, `assigned_to` or `qualified`.
 * Stage has its own mutation with its own side effects; score is computed by a
 * trigger and would be silently overwritten; and letting an edit form reassign
 * ownership is how a lead quietly changes hands.
 */
export function useUpdateLead() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      id: string
      name: string
      email: string
      phone?: string
      location?: string
      address?: string
      monthlyBill?: number | null
      estimatedKw?: number | null
    }) => {
      if (!supabase) throw new Error('Not connected to the backend.')

      const { data, error } = await supabase
        .from('leads')
        .update({
          name: input.name.trim(),
          email: input.email.trim().toLowerCase(),
          phone: input.phone?.trim() || null,
          location: input.location?.trim() || null,
          address: input.address?.trim() || null,
          monthly_bill: input.monthlyBill ?? null,
          estimated_kw: input.estimatedKw ?? null,
        })
        .eq('id', input.id)
        .select('id')

      if (error) throw error
      /* A policy-filtered update returns 200 with zero rows, not an error.
         Reporting that as saved would show the rep their correction on screen
         while the database still held the old number. */
      if (!data || data.length === 0) {
        throw new Error('That change was refused. Your role may not edit this lead.')
      }
      return data[0]
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: crmKeys.leads })
    },
  })
}

/* --- Packages ------------------------------------------------------------- */

export function usePackages() {
  return useQuery({
    queryKey: crmKeys.packages,
    // Packages change a few times a year, not a few times an hour.
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Package[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('packages')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })

      if (error) throw error

      return (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        systemType: row.system_type,
        sizeKw: Number(row.size_kw),
        priceFrom: Number(row.price_from),
        segment: row.segment,
        featured: row.featured,
        inclusions: row.inclusions ?? [],
        idealFor: row.ideal_for ?? '',
      }))
    },
  })
}
