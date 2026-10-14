import { FormError } from '@/components/ui/FormError'
import { date, humanize } from '@/lib/format'
import { useSetPhotoVisibility, useSitePhotos } from '@/lib/queries/operations'
import { useSignedUrls } from '@/lib/queries/storage'

/* ============================================================================
   PhotoGrid — what the crew photographed on site.
   ----------------------------------------------------------------------------
   The field portal uploads geotagged photos at every stage, and nothing showed
   them: the customer's tracker drew four grey boxes labelled "Photo", and the
   office had no photo view at all. This is both — the customer sees the photos
   marked visible (RLS decides which), the office sees every one and decides.

   Thumbnails are signed in one request and loaded lazily, so a page with a
   grid below the fold costs nothing until it is scrolled to.
   ========================================================================== */

interface PhotoGridProps {
  projectId?: string
  /** Visits with no project yet — a site survey's photos, shown on its enquiry. */
  appointmentIds?: string[]
  /** Office view: every photo, with a switch for whether the customer sees it. */
  manage?: boolean
}

export function PhotoGrid({ projectId, appointmentIds, manage = false }: PhotoGridProps) {
  const photosQuery = useSitePhotos({ projectId, appointmentIds })
  const photos = photosQuery.data ?? []
  const urls = useSignedUrls(
    'site-photos',
    photos.map((p) => p.storagePath),
  ).data
  const setVisibility = useSetPhotoVisibility()

  if (photosQuery.isLoading) return <p className="small muted">Loading photos…</p>

  if (photos.length === 0) {
    return (
      <p className="small muted">
        {!projectId
          ? 'No photos from these visits yet. The technician takes them from the field app.'
          : manage
            ? 'No photos yet. The crew takes them from the field app at each stage of the job.'
            : 'Photos appear here as our crew documents each stage of your installation.'}
      </p>
    )
  }

  return (
    <>
      <div className="photo-grid">
        {photos.map((photo) => {
          const url = urls?.[photo.storagePath]
          const title = photo.category ? humanize(photo.category) : 'Site photo'
          return (
            <figure key={photo.id} className="photo-grid__item">
              {url ? (
                <a href={url} target="_blank" rel="noreferrer">
                  <img
                    className="photo-grid__img"
                    src={url}
                    alt={photo.caption ?? title}
                    loading="lazy"
                  />
                </a>
              ) : (
                <div className="photo-grid__img" aria-hidden="true" />
              )}
              <figcaption className="photo-grid__caption">
                <div className="strong">{title}</div>
                {photo.caption && <div>{photo.caption}</div>}
                <div>
                  {date(photo.takenAt)}
                  {photo.latitude !== null && photo.longitude !== null && (
                    <>
                      {' · '}
                      <a
                        href={`https://www.google.com/maps?q=${photo.latitude},${photo.longitude}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        where
                      </a>
                    </>
                  )}
                </div>
                {manage && (
                  <label className="row" style={{ gap: 4, marginTop: 4 }}>
                    <input
                      type="checkbox"
                      checked={photo.clientVisible}
                      disabled={setVisibility.isPending}
                      onChange={(e) =>
                        setVisibility.mutate({ id: photo.id, visible: e.target.checked })
                      }
                    />
                    Customer sees it
                  </label>
                )}
              </figcaption>
            </figure>
          )
        })}
      </div>
      <FormError error={setVisibility.error} />
    </>
  )
}
