import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useAuth } from '@/app/auth/useAuth'
import { NOT_CONNECTED, supabase } from '@/lib/supabase'
import type { UserRole } from '@/types/domain'

/* ============================================================================
   DIRECT MESSAGES
   ----------------------------------------------------------------------------
   Staff write to any colleague. A customer writes only to the people actually
   on their installation, plus an administrator.

   NONE OF THAT RULE IS IN THIS FILE. It lives in `may_message` in the database
   (migration 0062), because a rule enforced in a React hook is a rule anybody
   can skip with curl and the anon key. What is here is the shape of the screen.

   POLLING, NOT REALTIME SUBSCRIPTIONS
   Supabase Realtime would be the obvious choice and is the wrong one for this
   application. A websocket held open costs a connection per signed-in tab, and
   the field portal is used on a roof with one bar — where a socket that keeps
   dropping and reconnecting drains the battery and delivers nothing that a
   refresh would not. A ten-second poll while a thread is open is unnoticeable
   to a person typing and survives a connection that comes and goes.
   ========================================================================== */

export interface Correspondent {
  id: string
  fullName: string
  role: UserRole
  avatarInitials: string
  avatarUrl: string | null
}

export interface ConversationSummary {
  id: string
  lastMessageAt: string
  /** The other person. One-to-one only, so there is exactly one. */
  other: Correspondent | null
  lastMessage: string
  unread: boolean
}

export interface Message {
  id: string
  body: string
  createdAt: string
  authorId: string | null
  mine: boolean
}

export const messageKeys = {
  directory: ['messages', 'directory'] as const,
  conversations: ['messages', 'conversations'] as const,
  thread: (id: string) => ['messages', 'thread', id] as const,
}

/** Everybody the signed-in person is allowed to write to. */
export function useMessageableDirectory() {
  return useQuery({
    queryKey: messageKeys.directory,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Correspondent[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase.rpc('messageable_people')
      if (error) throw error

      return (data ?? []).map((row) => ({
        id: row.id,
        fullName: row.full_name ?? 'Someone',
        role: row.role,
        avatarInitials: row.avatar_initials ?? '??',
        avatarUrl: row.avatar_url,
      }))
    },
  })
}

export function useConversations() {
  const { user } = useAuth()

  return useQuery({
    queryKey: messageKeys.conversations,
    enabled: Boolean(user),
    // The list is a background thing; the open thread polls faster.
    refetchInterval: 30_000,
    queryFn: async (): Promise<ConversationSummary[]> => {
      if (!supabase || !user) throw new Error(NOT_CONNECTED)

      /* One query with two embedded relations rather than N+1. RLS already
         limits this to conversations the caller participates in, so there is
         no `.eq` on user id to forget here. */
      const { data, error } = await supabase
        .from('conversations')
        .select(
          `id, last_message_at,
           conversation_participants ( user_id, last_read_at,
             profiles ( id, full_name, role, avatar_initials, avatar_url ) ),
           messages ( body, created_at )`,
        )
        .order('last_message_at', { ascending: false })
        .limit(50)

      if (error) throw error

      return (data ?? []).map((row) => {
        const participants = row.conversation_participants ?? []
        const mine = participants.find((p) => p.user_id === user.id)
        const them = participants.find((p) => p.user_id !== user.id)
        const profile = them?.profiles

        // Embedded rows come back unordered; the newest is what the list shows.
        const sorted = [...(row.messages ?? [])].sort((a, b) =>
          a.created_at < b.created_at ? 1 : -1,
        )
        const latest = sorted[0]

        return {
          id: row.id,
          lastMessageAt: row.last_message_at,
          other: profile
            ? {
                id: profile.id,
                fullName: profile.full_name ?? 'Someone',
                role: profile.role,
                avatarInitials: profile.avatar_initials ?? '??',
                avatarUrl: profile.avatar_url,
              }
            : null,
          lastMessage: latest?.body ?? '',
          /* Never read at all counts as unread, otherwise a brand new thread
             arrives with no badge. */
          unread: Boolean(
            latest && (!mine?.last_read_at || mine.last_read_at < row.last_message_at),
          ),
        }
      })
    },
  })
}

/** The badge in the sidebar. Derived from the same query, so it cannot drift. */
export function useUnreadCount(): number {
  const { data } = useConversations()
  return (data ?? []).filter((conversation) => conversation.unread).length
}

export function useThread(conversationId: string | undefined) {
  const { user } = useAuth()

  return useQuery({
    queryKey: messageKeys.thread(conversationId ?? 'none'),
    enabled: Boolean(conversationId && user),
    // Fast enough to feel live while a thread is open; see the note at the top
    // about why this is not a websocket.
    refetchInterval: 10_000,
    queryFn: async (): Promise<Message[]> => {
      if (!supabase || !user) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('messages')
        .select('id, body, created_at, author_id')
        .eq('conversation_id', conversationId!)
        .order('created_at')

      if (error) throw error

      return (data ?? []).map((row) => ({
        id: row.id,
        body: row.body,
        createdAt: row.created_at,
        authorId: row.author_id,
        mine: row.author_id === user.id,
      }))
    },
  })
}

/** Starts a thread, or adds to the existing one with that person. */
export function useStartConversation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { otherId: string; body: string }): Promise<string> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase.rpc('open_conversation', {
        p_other: input.otherId,
        p_body: input.body,
      })

      if (error) throw error
      return data as string
    },
    onSuccess: (conversationId) => {
      void queryClient.invalidateQueries({ queryKey: messageKeys.conversations })
      void queryClient.invalidateQueries({ queryKey: messageKeys.thread(conversationId) })
    },
  })
}

export function useSendMessage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { conversationId: string; body: string }) => {
      if (!supabase || !user) throw new Error(NOT_CONNECTED)

      const body = input.body.trim()
      if (!body) throw new Error('A message cannot be empty.')

      const { data, error } = await supabase
        .from('messages')
        .insert({ conversation_id: input.conversationId, author_id: user.id, body })
        .select()

      if (error) throw error

      // A policy-filtered insert returns no rows rather than raising.
      if (!data || data.length === 0) {
        throw new Error(
          'That message was not sent. You may no longer be part of this conversation.',
        )
      }
    },
    onSuccess: (_result, input) => {
      void queryClient.invalidateQueries({ queryKey: messageKeys.thread(input.conversationId) })
      void queryClient.invalidateQueries({ queryKey: messageKeys.conversations })
    },
  })
}

export function useMarkRead() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (conversationId: string) => {
      if (!supabase || !user) return

      await supabase
        .from('conversation_participants')
        .update({ last_read_at: new Date().toISOString() })
        .eq('conversation_id', conversationId)
        .eq('user_id', user.id)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: messageKeys.conversations })
    },
  })
}
