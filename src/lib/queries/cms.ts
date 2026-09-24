import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { readableDbError, throwReadable } from '@/lib/db-error'
import { NOT_CONNECTED, supabase } from '@/lib/supabase'
import type { SystemType } from '@/types/domain'

/* ============================================================================
   WEBSITE CONTENT THE OWNER MAINTAINS
   ----------------------------------------------------------------------------
   Packages, frequently asked questions and the legal pages.

   All three were editable by the DATABASE already — `packages_write_staff` and
   `faqs_write_staff` have granted staff full CRUD since the schema was built.
   What was missing was any screen that used those rights, so the only way to
   add a package or correct an answer was to write SQL. This module is that
   missing half.

   WHY THE WRITES CHECK FOR ZERO ROWS
   Row-level security refuses by returning an empty result, not by raising. An
   accountant pressing "save" on a package would otherwise see the button go
   quiet and assume it worked.
   ========================================================================== */

export const cmsKeys = {
  packages: ['cms', 'packages'] as const,
  faqs: ['cms', 'faqs'] as const,
  legal: ['cms', 'legal'] as const,
  brands: ['cms', 'brands'] as const,
}

/* ------------------------------------------------------------------ PACKAGES */

export interface EditablePackage {
  id: string
  name: string
  systemType: SystemType
  sizeKw: number
  priceFrom: number
  segment: 'residential' | 'commercial'
  featured: boolean
  idealFor: string | null
  inclusions: string[]
  isActive: boolean
  sortOrder: number
}

export function useAdminPackages() {
  return useQuery({
    queryKey: cmsKeys.packages,
    queryFn: async (): Promise<EditablePackage[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('packages')
        .select(
          `id, name, system_type, size_kw, price_from, segment, featured, ideal_for, inclusions, is_active, sort_order`,
        )
        .order('sort_order')

      if (error) throwReadable(error)

      return (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        systemType: row.system_type,
        sizeKw: Number(row.size_kw),
        priceFrom: Number(row.price_from),
        segment: row.segment,
        featured: row.featured,
        idealFor: row.ideal_for,
        inclusions: row.inclusions ?? [],
        isActive: row.is_active,
        sortOrder: row.sort_order,
      }))
    },
  })
}

export type PackageDraft = Omit<EditablePackage, 'id'> & { id?: string }

export function useSavePackage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: PackageDraft) => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      if (!input.name.trim()) throw new Error('A package needs a name.')
      if (input.sizeKw <= 0) throw new Error('Array size must be greater than zero.')

      const row = {
        name: input.name.trim(),
        system_type: input.systemType,
        size_kw: input.sizeKw,
        price_from: input.priceFrom,
        segment: input.segment,
        featured: input.featured,
        ideal_for: input.idealFor?.trim() || null,
        // Blank lines are what you get when somebody presses enter twice.
        inclusions: input.inclusions.map((i) => i.trim()).filter(Boolean),
        is_active: input.isActive,
        sort_order: input.sortOrder,
      }

      const query = input.id
        ? supabase.from('packages').update(row).eq('id', input.id).select()
        : supabase.from('packages').insert(row).select()

      const { data, error } = await query
      if (error) throwReadable(error)
      if (!data || data.length === 0) {
        throw new Error('That was not saved — you may not have permission to edit packages.')
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cmsKeys.packages })
      // The public pages read the same table.
      void queryClient.invalidateQueries({ queryKey: ['public'] })
    },
  })
}

export function useDeletePackage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      const { error } = await supabase.from('packages').delete().eq('id', id)

      if (error) {
        /* A package that has been quoted is referenced by a quotation, and the
           foreign key refuses. Deactivating keeps the history intact and takes
           it off the website, which is what the person actually wanted. */
        if (error.code === '23503') {
          throw new Error(
            'This package has been quoted before, so it cannot be deleted without losing that history. Switch it to inactive instead — it disappears from the website and the old quotations stay readable.',
          )
        }
        throw readableDbError(error)
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cmsKeys.packages })
      void queryClient.invalidateQueries({ queryKey: ['public'] })
    },
  })
}

/* ---------------------------------------------------------------------- FAQS */

export interface EditableFaq {
  id: string
  question: string
  answer: string
  category: string
  sortOrder: number
  published: boolean
}

export function useAdminFaqs() {
  return useQuery({
    queryKey: cmsKeys.faqs,
    queryFn: async (): Promise<EditableFaq[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('faqs')
        .select(`id, question, answer, category, sort_order, published`)
        .order('sort_order')

      if (error) throwReadable(error)

      return (data ?? []).map((row) => ({
        id: row.id,
        question: row.question,
        answer: row.answer,
        category: row.category,
        sortOrder: row.sort_order,
        published: row.published,
      }))
    },
  })
}

export type FaqDraft = Omit<EditableFaq, 'id'> & { id?: string }

export function useSaveFaq() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: FaqDraft) => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      if (!input.question.trim() || !input.answer.trim()) {
        throw new Error('A question and an answer are both required.')
      }

      const row = {
        question: input.question.trim(),
        answer: input.answer.trim(),
        category: input.category.trim() || 'General',
        sort_order: input.sortOrder,
        published: input.published,
      }

      const query = input.id
        ? supabase.from('faqs').update(row).eq('id', input.id).select()
        : supabase.from('faqs').insert(row).select()

      const { data, error } = await query
      if (error) throwReadable(error)
      if (!data || data.length === 0) {
        throw new Error('That was not saved — you may not have permission to edit the FAQ.')
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cmsKeys.faqs })
      void queryClient.invalidateQueries({ queryKey: ['public'] })
    },
  })
}

export function useDeleteFaq() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      const { error } = await supabase.from('faqs').delete().eq('id', id)
      if (error) throwReadable(error)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cmsKeys.faqs })
      void queryClient.invalidateQueries({ queryKey: ['public'] })
    },
  })
}

/* ------------------------------------------------------------ LEGAL DOCUMENTS */

export interface LegalSection {
  heading: string
  body: string
}

export interface LegalDocument {
  slug: string
  title: string
  sections: LegalSection[]
  published: boolean
  updatedAt: string
}

export function useLegalDocuments() {
  return useQuery({
    queryKey: cmsKeys.legal,
    queryFn: async (): Promise<LegalDocument[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('legal_documents')
        .select(`slug, title, sections, published, updated_at`)
        .order('slug')

      if (error) throwReadable(error)

      return (data ?? []).map((row) => ({
        slug: row.slug,
        title: row.title,
        /* `sections` is jsonb, so the generated type is the whole Json union
           and the shape has to be re-established here. Narrowed by checking
           each entry rather than asserting the array wholesale: the column can
           contain anything somebody put in it, and a malformed row should drop
           the bad section rather than crash the page. */
        sections: Array.isArray(row.sections)
          ? (row.sections as unknown[]).filter(
              (s): s is LegalSection =>
                typeof s === 'object' &&
                s !== null &&
                typeof (s as LegalSection).heading === 'string' &&
                typeof (s as LegalSection).body === 'string',
            )
          : [],
        published: row.published,
        updatedAt: row.updated_at,
      }))
    },
  })
}

export function useSaveLegalDocument() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { slug: string; title: string; sections: LegalSection[] }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const sections = input.sections
        .map((s) => ({ heading: s.heading.trim(), body: s.body.trim() }))
        .filter((s) => s.heading || s.body)

      const { data, error } = await supabase
        .from('legal_documents')
        .update({ title: input.title.trim(), sections })
        .eq('slug', input.slug)
        .select()

      if (error) throwReadable(error)
      if (!data || data.length === 0) {
        throw new Error(
          'That was not saved. Legal pages are administrator-only — publishing one is a legal act by the company.',
        )
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cmsKeys.legal })
      void queryClient.invalidateQueries({ queryKey: ['public'] })
    },
  })
}

/* ---------------------------------------------------------------------- BRANDS */

export interface Brand {
  id: string
  name: string
  logoUrl: string | null
  websiteUrl: string | null
  sortOrder: number
  isActive: boolean
}

export function useBrands(activeOnly = true) {
  return useQuery({
    queryKey: [...cmsKeys.brands, activeOnly],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Brand[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      let query = supabase
        .from('brands')
        .select(`id, name, logo_url, website_url, sort_order, is_active`)
        .order('sort_order')

      if (activeOnly) query = query.eq('is_active', true)

      const { data, error } = await query
      if (error) throwReadable(error)

      return (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        logoUrl: row.logo_url,
        websiteUrl: row.website_url,
        sortOrder: row.sort_order,
        isActive: row.is_active,
      }))
    },
  })
}

export type BrandDraft = Omit<Brand, 'id'> & { id?: string }

export function useSaveBrand() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: BrandDraft) => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      if (!input.name.trim()) throw new Error('A brand needs a name.')

      const row = {
        name: input.name.trim(),
        logo_url: input.logoUrl?.trim() || null,
        website_url: input.websiteUrl?.trim() || null,
        sort_order: input.sortOrder,
        is_active: input.isActive,
      }

      const query = input.id
        ? supabase.from('brands').update(row).eq('id', input.id).select()
        : supabase.from('brands').insert(row).select()

      const { data, error } = await query
      if (error) throwReadable(error)
      if (!data || data.length === 0) {
        throw new Error('That was not saved — you may not have permission to edit brands.')
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cmsKeys.brands })
      void queryClient.invalidateQueries({ queryKey: ['public'] })
    },
  })
}

export function useDeleteBrand() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      const { error } = await supabase.from('brands').delete().eq('id', id)
      if (error) throwReadable(error)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cmsKeys.brands })
      void queryClient.invalidateQueries({ queryKey: ['public'] })
    },
  })
}

/**
 * Upload a brand logo into the existing `public-media` bucket.
 *
 * That bucket is already public-read and already restricted to sales and admin
 * for writes, so no new storage policy is needed — and a logo on a marketing
 * page is about as public as a file gets.
 */
export function useUploadBrandLogo() {
  return useMutation({
    mutationFn: async (file: File): Promise<string> => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      if (!file.type.startsWith('image/')) throw new Error('Choose an image file.')
      if (file.size > 5 * 1024 * 1024) throw new Error('That image is over 5 MB.')

      /* A timestamp in the name so replacing a logo does not serve the old one
         from a cache, and so two brands cannot collide on the same filename. */
      const safe = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-')
      const path = `brands/${Date.now()}-${safe}`

      const { error } = await supabase.storage
        .from('public-media')
        .upload(path, file, { contentType: file.type })

      if (error) throwReadable(error)

      const {
        data: { publicUrl },
      } = supabase.storage.from('public-media').getPublicUrl(path)
      return publicUrl
    },
  })
}
