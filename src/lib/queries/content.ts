import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { NOT_CONNECTED, supabase } from '@/lib/supabase'

/* ============================================================================
   MARKETING CONTENT
   ----------------------------------------------------------------------------
   Portfolio entries, blog posts and customer reviews: read by the public site,
   written by sales and admin through /admin/content.

   IMAGE HANDLING
   Files go to the `public-media` storage bucket; the database stores only the
   path. Public URLs are derived at render time rather than saved, because a
   stored absolute URL breaks the moment the project is restored to a different
   Supabase instance — which is exactly what happens when someone clones this
   for a second environment.

   PUBLIC READS ARE UNAUTHENTICATED
   The queries below run for signed-out visitors. The RLS policies only expose
   rows where `published` is true, so a draft blog post is invisible to the
   public site even though the same query serves both.
   ========================================================================== */

export const contentKeys = {
  portfolio: (publishedOnly: boolean) => ['content', 'portfolio', publishedOnly] as const,
  blog: (publishedOnly: boolean) => ['content', 'blog', publishedOnly] as const,
  reviews: (publishedOnly: boolean) => ['content', 'reviews', publishedOnly] as const,
}

/**
 * Public URL for a file in the `public-media` bucket.
 *
 * Derived, never stored. Returns null for an empty path so callers can fall
 * back to a placeholder instead of rendering a broken image.
 */
export function publicMediaUrl(path: string | null | undefined): string | null {
  if (!path) return null
  if (!supabase) throw new Error(NOT_CONNECTED)
  const { data } = supabase.storage.from('public-media').getPublicUrl(path)
  return data.publicUrl
}

/* ============================================================================
   PORTFOLIO
   ========================================================================== */

export interface PortfolioEntry {
  id: string
  title: string
  location: string | null
  systemSize: string | null
  segment: string | null
  year: number | null
  summary: string | null
  coverPath: string | null
  published: boolean
  clientConsented: boolean
  sortOrder: number
}

export function usePortfolio(publishedOnly = true) {
  return useQuery({
    queryKey: contentKeys.portfolio(publishedOnly),
    queryFn: async (): Promise<PortfolioEntry[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      let query = supabase
        .from('portfolio_items')
        .select('*')
        .order('sort_order', { ascending: true })

      // The editor needs to see drafts; the public site must not.
      if (publishedOnly) query = query.eq('published', true)

      const { data, error } = await query
      if (error) throw error

      return (data ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        location: row.location,
        systemSize: row.system_size,
        segment: row.segment,
        year: row.year,
        summary: row.summary,
        coverPath: row.cover_storage_path,
        published: row.published,
        clientConsented: row.client_consented,
        sortOrder: row.sort_order,
      }))
    },
  })
}

export interface SavePortfolioInput {
  id?: string
  title: string
  location?: string
  systemSize?: string
  segment?: string
  year?: number
  summary?: string
  coverPath?: string | null
  published: boolean
  clientConsented: boolean
}

export function useSavePortfolioItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: SavePortfolioInput) => {
      if (!supabase) throw new Error('Not connected to the backend.')

      const row = {
        title: input.title,
        location: input.location ?? null,
        system_size: input.systemSize ?? null,
        segment: input.segment ?? null,
        year: input.year ?? null,
        summary: input.summary ?? null,
        cover_storage_path: input.coverPath ?? null,
        published: input.published,
        client_consented: input.clientConsented,
      }

      const { error } = input.id
        ? await supabase.from('portfolio_items').update(row).eq('id', input.id)
        : await supabase.from('portfolio_items').insert(row)

      // The database refuses to publish without consent. Translate that into
      // something an editor can act on rather than a constraint name.
      if (error) {
        if (error.message.includes('portfolio_published_needs_consent')) {
          throw new Error(
            'You cannot publish a project without confirming the customer agreed to it being shown.',
          )
        }
        throw error
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['content', 'portfolio'] })
    },
  })
}

export function useDeletePortfolioItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      if (!supabase) throw new Error('Not connected to the backend.')
      const { error } = await supabase.from('portfolio_items').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['content', 'portfolio'] })
    },
  })
}

/* ============================================================================
   BLOG
   ========================================================================== */

export interface BlogEntry {
  id: string
  slug: string
  title: string
  excerpt: string | null
  body: string | null
  category: string | null
  readMinutes: number | null
  coverPath: string | null
  published: boolean
  publishedAt: string | null
  authorName: string | null
}

export function useBlogPosts(publishedOnly = true) {
  return useQuery({
    queryKey: contentKeys.blog(publishedOnly),
    queryFn: async (): Promise<BlogEntry[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      let query = supabase
        .from('blog_posts')
        .select('*')
        .order('published_at', { ascending: false, nullsFirst: false })

      if (publishedOnly) query = query.eq('published', true)

      const { data, error } = await query
      if (error) throw error

      return (data ?? []).map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        excerpt: row.excerpt,
        body: row.body,
        category: row.category,
        readMinutes: row.read_minutes,
        coverPath: row.cover_storage_path,
        published: row.published,
        publishedAt: row.published_at,
        authorName: row.author_name,
      }))
    },
  })
}

export interface SaveBlogInput {
  id?: string
  slug: string
  title: string
  excerpt?: string
  body?: string
  category?: string
  readMinutes?: number
  coverPath?: string | null
  published: boolean
  authorName?: string
}

export function useSaveBlogPost() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: SaveBlogInput) => {
      if (!supabase) throw new Error('Not connected to the backend.')

      const row = {
        slug: input.slug,
        title: input.title,
        excerpt: input.excerpt ?? null,
        body: input.body ?? null,
        category: input.category ?? null,
        read_minutes: input.readMinutes ?? null,
        cover_storage_path: input.coverPath ?? null,
        published: input.published,
        author_name: input.authorName ?? null,
        // Stamped on first publish so the date does not move every time
        // somebody fixes a typo.
        published_at: input.published ? new Date().toISOString() : null,
      }

      const { error } = input.id
        ? await supabase.from('blog_posts').update(row).eq('id', input.id)
        : await supabase.from('blog_posts').insert(row)

      if (error) {
        if (error.code === '23505') {
          throw new Error(`The web address "${input.slug}" is already used by another post.`)
        }
        throw error
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['content', 'blog'] })
    },
  })
}

export function useDeleteBlogPost() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      if (!supabase) throw new Error('Not connected to the backend.')
      const { error } = await supabase.from('blog_posts').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['content', 'blog'] })
    },
  })
}

/* ============================================================================
   REVIEWS
   ========================================================================== */

export interface ReviewEntry {
  id: string
  rating: number
  quote: string
  displayName: string
  displayLocation: string | null
  systemSummary: string | null
  status: 'pending' | 'approved' | 'rejected'
  published: boolean
  createdAt: string
}

export function useReviews(publishedOnly = true) {
  return useQuery({
    queryKey: contentKeys.reviews(publishedOnly),
    queryFn: async (): Promise<ReviewEntry[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      let query = supabase.from('reviews').select('*').order('created_at', { ascending: false })
      if (publishedOnly) query = query.eq('published', true)

      const { data, error } = await query
      if (error) throw error

      return (data ?? []).map((row) => ({
        id: row.id,
        rating: row.rating,
        quote: row.quote,
        displayName: row.display_name,
        displayLocation: row.display_location,
        systemSummary: row.system_summary,
        status: row.status,
        published: row.published,
        createdAt: row.created_at,
      }))
    },
  })
}

/**
 * Approve or reject a submitted review.
 *
 * Publishing puts a customer's words on the public marketing site, so approval
 * and publication happen together and are recorded against the moderator by the
 * `reviews_published_needs_approval` constraint in migration 0006.
 */
export function useModerateReview() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { id: string; approve: boolean; moderatorId: string }) => {
      if (!supabase) throw new Error('Not connected to the backend.')

      const { error } = await supabase
        .from('reviews')
        .update({
          status: input.approve ? 'approved' : 'rejected',
          published: input.approve,
          moderated_by: input.moderatorId,
          moderated_at: new Date().toISOString(),
        })
        .eq('id', input.id)

      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['content', 'reviews'] })
    },
  })
}
