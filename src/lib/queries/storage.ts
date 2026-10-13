import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { readableDbError, throwReadable } from '@/lib/db-error'
import { NOT_CONNECTED, supabase } from '@/lib/supabase'

/* ============================================================================
   FILE UPLOADS
   ----------------------------------------------------------------------------
   Uploads into the three buckets created by migration 0017.

   THE PATH IS BUILT HERE, NEVER PASSED IN
   The storage policies for `project-files` and `site-photos` read the project
   id out of the first path segment and check ownership against it:

       project-files/<project_id>/<filename>

   A caller who supplied its own flat path would land outside that check. So
   these helpers take a project id and construct the path themselves — the
   convention is load-bearing, not cosmetic, and leaving it to call sites means
   the first careless one silently opens a hole.

   IMAGES ARE COMPRESSED BEFORE UPLOAD
   A modern phone camera produces 4-8 MB per photo. A technician documenting an
   installation takes a dozen, on mobile data, on a roof. Uploading originals
   would be slow, expensive for them, and pointless — nothing in this
   application displays a photo larger than about 1600px.

   Compression happens in the browser via canvas, so the large file never leaves
   the device.
   ========================================================================== */

/** Longest edge, in pixels, after compression. */
const MAX_EDGE = 1600
const JPEG_QUALITY = 0.82

/**
 * Downscale and re-encode an image in the browser.
 *
 * Returns the original untouched if it is already small, if it is an SVG
 * (which has no pixels to resize and would be destroyed by rasterising), or if
 * anything goes wrong — a failed optimisation should never block an upload.
 */
export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return file
  if (file.size < 300_000) return file

  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))

    // Already within bounds and not especially heavy: leave it alone.
    if (scale === 1 && file.size < 1_500_000) return file

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)

    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    )
    if (!blob || blob.size >= file.size) return file

    return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' })
  } catch {
    // Older browsers lack createImageBitmap. Upload the original rather than
    // failing: a big file is a nuisance, a failed upload loses the work.
    return file
  }
}

/** Filenames from a phone camera or a Windows desktop are not URL-safe. */
function safeName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '')
  // Prefixed so two people uploading "photo.jpg" do not overwrite each other.
  return `${Date.now()}-${cleaned || 'file'}`
}

/* ============================================================================
   PUBLIC MEDIA — portfolio covers, blog images
   ========================================================================== */

export function useUploadPublicMedia() {
  return useMutation({
    mutationFn: async (input: { file: File; folder?: string }): Promise<string> => {
      if (!supabase) throw new Error('Not connected to the backend.')

      const compressed = await compressImage(input.file)
      const path = `${input.folder ?? 'general'}/${safeName(compressed.name)}`

      const { error } = await supabase.storage
        .from('public-media')
        .upload(path, compressed, { cacheControl: '31536000', upsert: false })

      if (error) {
        if (error.message.includes('exceeded')) {
          throw new Error('That image is too large. The limit is 5 MB.')
        }
        if (error.message.includes('mime')) {
          throw new Error('That file type is not allowed. Use JPG, PNG, WebP or SVG.')
        }
        throw readableDbError(error)
      }

      // The path, not a URL. See the note in content.ts about why.
      return path
    },
  })
}

/* ============================================================================
   PROJECT FILES — contracts, invoices, permits
   ========================================================================== */

export function useUploadProjectFile() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      file: File
      projectId: string
      /** Recorded on the `documents` row so the vault can categorise it. */
      kind: string
      /** False keeps it internal: attached to the project, hidden from the customer. */
      clientVisible?: boolean
    }): Promise<string> => {
      if (!supabase) throw new Error('Not connected to the backend.')

      const prepared = await compressImage(input.file)
      // First segment MUST be the project id — the storage policy depends on it.
      const path = `${input.projectId}/${safeName(prepared.name)}`

      const { error: uploadError } = await supabase.storage
        .from('project-files')
        .upload(path, prepared, { upsert: false })

      if (uploadError) throwReadable(uploadError)

      // Metadata row. Without it the file exists but nothing lists it, and the
      // client-visibility policy has nothing to check against.
      const { error: rowError } = await supabase.from('documents').insert({
        name: input.file.name,
        kind: input.kind as never,
        project_id: input.projectId,
        storage_path: path,
        mime_type: prepared.type,
        size_kb: Math.round(prepared.size / 1024),
        is_client_visible: input.clientVisible ?? true,
      })

      if (rowError) {
        // Roll back the file. An orphaned object nobody can see is worse than
        // no upload, because it still counts against storage and quietly
        // accumulates.
        await supabase.storage.from('project-files').remove([path])
        throwReadable(rowError)
      }

      return path
    },
    /* This mutation wrote a `documents` row and invalidated nothing, so an
       uploaded permit appeared in neither the staff list nor the customer's
       vault until somebody reloaded - and the person who uploaded it saw no
       evidence it had worked. */
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ops'] })
      void queryClient.invalidateQueries({ queryKey: ['client'] })
    },
  })
}

/**
 * A file uploaded by the CUSTOMER, from their own portal.
 *
 * Two inputs in the customer portal accepted a file and did nothing with it —
 * the ticket photo, and the proof of sale a warranty transfer is approved on.
 * Neither could have worked: until migration 0043 the storage policy granted
 * insert to staff only.
 *
 * Two steps, in this order, on purpose. The file goes up first; only then is
 * the metadata row written, because a row pointing at a file that failed to
 * upload is a broken link in the customer's vault. If the row fails, the file
 * is removed again rather than left orphaned.
 *
 * The path is built here and never accepted from a caller: the storage policy
 * parses the project id out of the first segment, so a hand-made path is how
 * ownership checking gets bypassed.
 */
export function useClientUpload() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      file: File
      projectId: string
      /** 'receipt' is a proof of payment — it notifies the finance team (0072). */
      kind: 'proof_of_sale' | 'receipt' | 'other'
      ticketId?: string
    }) => {
      if (!supabase) throw new Error('Not connected to the backend.')

      const prepared = await compressImage(input.file)
      // A timestamp prefix, so uploading "photo.jpg" twice does not collide
      // with itself — customers do exactly that.
      const path = `${input.projectId}/uploads/${Date.now()}-${safeName(prepared.name)}`

      const { error: uploadError } = await supabase.storage
        .from('project-files')
        .upload(path, prepared, { upsert: false })

      if (uploadError) throwReadable(uploadError)

      const { error: rowError } = await supabase.rpc('record_client_upload', {
        p_project_id: input.projectId,
        p_storage_path: path,
        p_name: input.file.name,
        p_kind: input.kind,
        p_mime_type: prepared.type,
        p_size_kb: Math.round(prepared.size / 1024),
        p_ticket_id: input.ticketId,
      })

      if (rowError) {
        await supabase.storage.from('project-files').remove([path])
        throwReadable(rowError)
      }

      return path
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['client'] })
      // The office needs to see it too — a proof of sale nobody can find is
      // the same as no proof of sale.
      void queryClient.invalidateQueries({ queryKey: ['ops'] })
    },
  })
}

/**
 * Signed URL for a private file, valid for one minute.
 *
 * Short-lived deliberately: a link to a signed contract that works for a week
 * is a link that ends up forwarded, pasted into a chat, and still working long
 * after it should have stopped.
 */
export async function getPrivateFileUrl(
  bucket: 'project-files' | 'site-photos',
  path: string,
): Promise<string | null> {
  if (!supabase) throw new Error(NOT_CONNECTED)
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60)
  return error ? null : data.signedUrl
}

/* ============================================================================
   SITE PHOTOS — from the field portal
   ========================================================================== */

/* ============================================================================
   WHICH REQUIRED PHOTOS HAVE ACTUALLY BEEN TAKEN
   ----------------------------------------------------------------------------
   The field portal listed eight required photographs and marked the first three
   "Captured" — from `index < 3`, a literal. It said the same three on an empty
   database, on every job, forever.

   That is worse than showing nothing. The list exists so a technician can see
   what is still outstanding before leaving site, and a checklist that lies
   about what is done is how somebody drives away from a job missing the one
   photograph an engineer needed.
   ========================================================================== */

export const sitePhotoKeys = {
  forProject: (projectId: string) => ['site-photos', projectId] as const,
}

export function useProjectPhotoCategories(projectId: string | undefined) {
  return useQuery({
    queryKey: sitePhotoKeys.forProject(projectId ?? 'none'),
    enabled: Boolean(projectId),
    queryFn: async (): Promise<string[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('site_photos')
        .select('photo_category')
        .eq('project_id', projectId!)
        .not('photo_category', 'is', null)

      if (error) throwReadable(error)
      return Array.from(
        new Set((data ?? []).map((row) => String(row.photo_category)).filter(Boolean)),
      )
    },
  })
}

export function useUploadSitePhoto() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      file: File
      projectId: string
      appointmentId?: string
      caption?: string
      category?: string
      /** Geotag, so the photo proves it was taken at the site. */
      latitude?: number
      longitude?: number
    }): Promise<string> => {
      if (!supabase) throw new Error('Not connected to the backend.')

      const compressed = await compressImage(input.file)
      const path = `${input.projectId}/${safeName(compressed.name)}`

      const { error: uploadError } = await supabase.storage
        .from('site-photos')
        .upload(path, compressed, { upsert: false })

      if (uploadError) throwReadable(uploadError)

      const { error: rowError } = await supabase.from('site_photos').insert({
        project_id: input.projectId,
        appointment_id: input.appointmentId ?? null,
        storage_path: path,
        caption: input.caption ?? null,
        photo_category: input.category ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
      })

      if (rowError) {
        await supabase.storage.from('site-photos').remove([path])
        throwReadable(rowError)
      }

      return path
    },
    /* Without this the checklist keeps saying "Pending" for a photograph the
       technician has just taken, which reads as the upload having failed. */
    onSuccess: (_path, input) => {
      void queryClient.invalidateQueries({ queryKey: sitePhotoKeys.forProject(input.projectId) })
    },
  })
}

/**
 * Signed URLs for a batch of private files — the thumbnails in a photo grid.
 *
 * One request for the whole grid rather than one per photo, valid for ten
 * minutes and cached for five, so moving between tabs does not sign
 * everything again. Nothing is fetched until a grid is actually on screen.
 */
export function useSignedUrls(bucket: 'project-files' | 'site-photos', paths: string[]) {
  const sorted = [...paths].sort()
  return useQuery({
    queryKey: ['signed-urls', bucket, sorted.join('|')],
    enabled: sorted.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Record<string, string>> => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      const { data, error } = await supabase.storage.from(bucket).createSignedUrls(sorted, 600)
      if (error) throwReadable(error)
      const byPath: Record<string, string> = {}
      for (const row of data ?? []) {
        if (row.path && row.signedUrl) byPath[row.path] = row.signedUrl
      }
      return byPath
    },
  })
}
