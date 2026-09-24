import { useQuery } from '@tanstack/react-query'

import { throwReadable } from '@/lib/db-error'
import { NOT_CONNECTED, supabase } from '@/lib/supabase'

/* ============================================================================
   CONSOLE SEARCH
   ----------------------------------------------------------------------------
   The box in the top bar of every staff screen said "Search projects, clients,
   tickets…" and did nothing with what was typed. It is the most prominent
   control in the console and it was decoration.

   THREE QUERIES, NOT ONE RPC
   Each of the three tables already has a read policy that says exactly who may
   see which rows: a technician sees the projects they are crewed on, an
   accountant sees all of them. Running the searches as the signed-in user
   means those policies decide the results, and there is no second copy of the
   rules to get out of step. A SECURITY DEFINER function would have had to
   restate every one of them.

   Deliberately capped at five hits per group. This is a jump-to box, not a
   report — anyone needing the full list has a page for it.
   ========================================================================== */

export interface SearchHit {
  kind: 'project' | 'client' | 'ticket'
  id: string
  title: string
  subtitle: string
  to: string
}

/* One call to a database function, and the term travels as a BOUND PARAMETER.

   This used to build a PostgREST filter by interpolating the search term into
   a filter-grammar string. `%` and `_` were escaped because those are LIKE
   wildcards; the grammar's own characters were not — and a comma in that
   string is an OR separator, so searching for `x,status.eq.completed` sent an
   extra condition the user had written.

   RLS meant it could not read anything the caller was not entitled to, so it
   was not a breach. It was still an injection into a query grammar, it threw
   400s on any search containing a comma, and it would have become a leak the
   day somebody widened a policy. Escaping the grammar would have worked until
   the next character somebody forgot; a parameter cannot be read as syntax at
   all. */

export function useConsoleSearch(query: string) {
  const term = query.trim()

  return useQuery({
    queryKey: ['search', term],
    // Two characters is where the results stop being everything.
    enabled: term.length >= 2,
    staleTime: 15_000,
    queryFn: async (): Promise<SearchHit[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase.rpc('console_search', { p_term: term })
      if (error) throwReadable(error)

      const DESTINATION: Record<string, (id: string) => string> = {
        project: (id) => `/admin/projects/${id}`,
        // No customer detail page exists; the CRM board is where a rep works.
        client: () => '/admin/crm',
        ticket: () => '/admin/tickets',
      }

      return ((data ?? []) as { kind: string; id: string; title: string; subtitle: string }[]).map(
        (row) => ({
          kind: row.kind as SearchHit['kind'],
          id: row.id,
          title: row.title,
          subtitle: row.subtitle ?? '',
          to: (DESTINATION[row.kind] ?? (() => '/admin'))(row.id),
        }),
      )
    },
  })
}
