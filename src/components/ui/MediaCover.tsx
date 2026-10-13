import type { CSSProperties } from 'react'

import { publicMediaUrl } from '@/lib/queries/content'

/* ============================================================================
   MediaCover — a content image, or the brand panel when there is none.
   ----------------------------------------------------------------------------
   The blog, the portfolio and the home page all drew a grey box with the words
   "Cover image" or "Installation photo" in it — even after a photo had been
   uploaded in the content editor, because nothing read `cover_storage_path`.
   Without a photo the panel stays, but without words that read as unfinished.
   ========================================================================== */

interface MediaCoverProps {
  path?: string | null
  alt: string
  style?: CSSProperties
}

export function MediaCover({ path, alt, style }: MediaCoverProps) {
  const url = publicMediaUrl(path)
  return (
    <div className="portfolio-item__media" style={style} aria-hidden={url ? undefined : true}>
      {url && <img src={url} alt={alt} loading="lazy" decoding="async" />}
    </div>
  )
}
