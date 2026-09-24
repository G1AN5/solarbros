import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { throwReadable } from '@/lib/db-error'
import { NOT_CONNECTED, supabase } from '@/lib/supabase'
import type { UserRole } from '@/types/domain'

/* ============================================================================
   STAFF REGISTRATION APPROVALS
   ----------------------------------------------------------------------------
   A member of staff registers themselves at an unlisted URL and says which role
   the company gave them. That claim grants nothing: migration 0052 creates the
   account parked on 'client' and INACTIVE, which — through migration 0016 —
   makes `current_user_role()` return NULL and every staff policy across all 39
   tables deny. They can read their own profile row and nothing else.

   An administrator then approves the claim or refuses it. `approve_staff` is
   the ONLY route by which `profiles.role` can change, anywhere, for anyone.

   WHY THIS IS SAFER THAN AN ADMINISTRATOR CREATING ACCOUNTS
   It is not obviously so, and the reasoning is worth stating. Creating accounts
   by hand means somebody types an email address and picks a role from a
   dropdown — two chances to be wrong, and the person affected never sees either
   choice. Here the employee supplies their own address and names their own
   role, and the administrator confirms a statement rather than composing one.
   A wrong role is now a disagreement between two people instead of one
   person's slip.
   ========================================================================== */

export const approvalKeys = {
  pending: ['admin', 'staff-approvals'] as const,
}

export interface PendingStaff {
  id: string
  fullName: string
  email: string
  phone: string | null
  requestedRole: UserRole
  registeredAt: string
}

export function usePendingStaff() {
  return useQuery({
    queryKey: approvalKeys.pending,
    // Somebody is usually waiting on this, sitting locked out.
    staleTime: 10_000,
    queryFn: async (): Promise<PendingStaff[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, phone, requested_role, created_at')
        .eq('approval_status', 'pending')
        .order('created_at', { ascending: true })

      if (error) throwReadable(error)

      return (data ?? [])
        .filter((row) => row.requested_role)
        .map((row) => ({
          id: row.id,
          fullName: row.full_name,
          email: row.email,
          phone: row.phone,
          requestedRole: row.requested_role as UserRole,
          registeredAt: row.created_at,
        }))
    },
  })
}

/**
 * Approve or refuse a registration.
 *
 * Both outcomes are audited at `warning` severity, because granting somebody
 * access to a module is exactly the kind of event a later reader should be able
 * to find without knowing to look for it.
 *
 * `role` corrects a wrong claim. Picking the wrong role from the dropdown is
 * the most likely mistake a new employee makes on their first day, and the
 * alternative — refuse, ask them to register again — leaves one person holding
 * two accounts. The audit entry records whether the granted role differed from
 * the claimed one, so a correction is findable later as its own fact.
 */
export function useReviewStaffRegistration() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      userId: string
      approve: boolean
      reason?: string
      /** A corrected role. Omitted means "grant what they asked for". */
      role?: UserRole
    }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { error } = await supabase.rpc('approve_staff', {
        p_user_id: input.userId,
        p_approve: input.approve,
        p_reason: input.reason ?? undefined,
        p_role: input.role ?? undefined,
      })

      if (error) throwReadable(error)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: approvalKeys.pending })
      // The staff list on the same screen gains or loses a working account.
      void queryClient.invalidateQueries({ queryKey: ['admin'] })
    },
  })
}
