import { useMutation, useQueryClient } from '@tanstack/react-query'

import { NOT_CONNECTED, supabase } from '@/lib/supabase'

/* ============================================================================
   YOUR OWN PROFILE
   ----------------------------------------------------------------------------
   Name, phone, address and photograph. Nothing else — and that is enforced by
   a database trigger (migration 0061), not by the shape of this file.

   WHY THAT MATTERS HERE
   `profiles_update_self` grants UPDATE on your own ROW, and row-level security
   does not distinguish columns. Sending `{ role: 'admin' }` from this module
   would have been refused by the role trigger, but `{ email: someone_else }`
   would have gone straight through before 0061 — and `grant_admin` looks its
   target up by email. The rule lives in the database because that is the only
   place it cannot be bypassed by a different client.
   ========================================================================== */

/** Derived rather than stored, so initials can never disagree with the name. */
function initialsFor(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '??'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export interface ProfileEdit {
  fullName: string
  phone: string | null
  address: string | null
}

export function useUpdateMyProfile() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: ProfileEdit & { userId: string }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const fullName = input.fullName.trim()
      if (!fullName) throw new Error('Your name cannot be empty.')

      const { data, error } = await supabase
        .from('profiles')
        .update({
          full_name: fullName,
          avatar_initials: initialsFor(fullName),
          phone: input.phone?.trim() || null,
          address: input.address?.trim() || null,
        })
        .eq('id', input.userId)
        .select()

      if (error) throw error

      /* A policy-filtered write comes back as 200 with zero rows rather than as
         an error, so an empty result means refused, not saved. */
      if (!data || data.length === 0) {
        throw new Error('That change was not saved. Please sign in again and retry.')
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profile'] })
    },
  })
}

/* ----------------------------------------------------------------------------
   THE PHOTOGRAPH
   Stored under `<user id>/…` because the storage policy checks that the first
   path segment is the caller's own id. Any other prefix is refused, so one
   person cannot overwrite another's face.
   -------------------------------------------------------------------------- */

export function useUploadAvatar() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { file: File; userId: string }): Promise<string> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      if (!input.file.type.startsWith('image/')) {
        throw new Error('Choose an image file.')
      }
      // The bucket refuses anything larger, but failing here gives a sentence
      // rather than a storage error code.
      if (input.file.size > 2 * 1024 * 1024) {
        throw new Error('That image is over 2 MB. Please choose a smaller one.')
      }

      const extension = input.file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
      /* A fixed name per person, overwritten on each change, so old photos do
         not accumulate in the bucket forever. `upsert` because the second
         upload would otherwise collide with the first. */
      const path = `${input.userId}/avatar.${extension}`

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, input.file, { upsert: true, contentType: input.file.type })

      if (uploadError) throw uploadError

      const {
        data: { publicUrl },
      } = supabase.storage.from('avatars').getPublicUrl(path)

      /* A cache-busting suffix. The path never changes, so browsers and the CDN
         would happily serve the previous photo for as long as they had it. */
      const url = `${publicUrl}?v=${Date.now()}`

      const { error: rowError } = await supabase
        .from('profiles')
        .update({ avatar_url: url })
        .eq('id', input.userId)

      if (rowError) throw rowError
      return url
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profile'] })
    },
  })
}

export function useRemoveAvatar() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { userId: string }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data: files } = await supabase.storage.from('avatars').list(input.userId)
      if (files?.length) {
        await supabase.storage
          .from('avatars')
          .remove(files.map((file) => `${input.userId}/${file.name}`))
      }

      const { error } = await supabase
        .from('profiles')
        .update({ avatar_url: null })
        .eq('id', input.userId)

      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profile'] })
    },
  })
}
