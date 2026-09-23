import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { NOT_CONNECTED, supabase } from '@/lib/supabase'
import type { UserRole } from '@/types/domain'

/* ============================================================================
   OPERATIONS HUB DATA
   ----------------------------------------------------------------------------
   Queries and mutations for the internal /admin portal.

   As in the client portal, nothing here filters by role. Each policy in
   migration 0007 already restricts what a given staff member can read, so an
   accountant querying `leads` simply gets nothing back. The UI hides the menu
   item as well, but the database is what actually enforces it.
   ========================================================================== */

export const adminKeys = {
  staff: ['admin', 'staff'] as const,
  audit: (severity?: string) => ['admin', 'audit', severity ?? 'all'] as const,
}

/* ============================================================================
   STAFF DIRECTORY
   ========================================================================== */

export interface StaffMember {
  id: string
  fullName: string
  email: string
  role: UserRole
  phone: string | null
  isActive: boolean
  createdAt: string
  avatarInitials: string
}

export function useStaff() {
  return useQuery({
    queryKey: adminKeys.staff,
    queryFn: async (): Promise<StaffMember[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, role, phone, is_active, created_at, avatar_initials')
        .order('created_at', { ascending: true })

      if (error) throw error

      return (data ?? []).map((row) => ({
        id: row.id,
        fullName: row.full_name,
        email: row.email,
        role: row.role,
        phone: row.phone,
        isActive: row.is_active,
        createdAt: row.created_at,
        avatarInitials: row.avatar_initials ?? '??',
      }))
    },
  })
}

/* ============================================================================
   CREATING A STAFF ACCOUNT
   ----------------------------------------------------------------------------
   Goes through the `manage-staff` Edge Function rather than straight to the
   database, because creating an auth user needs the service_role key — and that
   key bypasses every RLS policy, so it can never be shipped to a browser.

   `functions.invoke` automatically attaches the caller's session token, which
   is what the function uses to confirm the caller really is an administrator.
   ========================================================================== */

/* useSetStaffRole and useCreateStaff were here.

   REMOVED, not deprecated. `useSetStaffRole` can no longer succeed under any
   circumstances: migration 0052 refuses every role change that did not come
   through `approve_staff`, so the hook's only possible outcome is an exception.
   `useCreateStaff` contradicted the decision that accounts are made by hand in
   Supabase and by staff registering themselves.

   A hook that cannot work is worse than no hook — somebody wires it to a button
   and discovers at runtime. Roles are granted by approving a registration, on
   the Roles & Access screen. */

export function useSetStaffActive() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { userId: string; isActive: boolean }) => {
      if (!supabase) throw new Error('Not connected to the backend.')
      const { error } = await supabase
        .from('profiles')
        .update({ is_active: input.isActive })
        .eq('id', input.userId)
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.staff })
    },
  })
}

/* ============================================================================
   AUDIT LOG
   ========================================================================== */

export interface AuditEntryRow {
  id: string
  actorName: string
  actorRole: UserRole | null
  action: string
  entity: string
  entityId: string | null
  severity: 'info' | 'warning' | 'critical'
  at: string
}

export function useAuditLog(severity?: 'info' | 'warning' | 'critical') {
  return useQuery({
    queryKey: adminKeys.audit(severity),
    queryFn: async (): Promise<AuditEntryRow[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      let query = supabase
        .from('audit_log')
        .select('id, actor_name, actor_role, action, entity, entity_id, severity, at')
        .order('at', { ascending: false })
        .limit(200)

      if (severity) query = query.eq('severity', severity)

      const { data, error } = await query
      if (error) throw error

      return (data ?? []).map((row) => ({
        id: row.id,
        actorName: row.actor_name ?? 'system',
        actorRole: row.actor_role,
        action: row.action,
        entity: row.entity,
        entityId: row.entity_id,
        severity: row.severity,
        at: row.at,
      }))
    },
  })
}
