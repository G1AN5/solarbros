/* ============================================================================
   Avatar — a photograph when there is one, initials when there is not.
   ----------------------------------------------------------------------------
   Initials were the only option before, and they remain the default: most
   accounts will never upload anything, and a screen full of grey silhouettes
   says less than a screen full of initials.

   WHY THE FALLBACK IS NOT AN afterthought
   A profile photo lives in a public storage bucket, so the URL can 404 — the
   file is deleted, the bucket is renamed, the row is stale. A broken-image icon
   in the top bar of every page is a worse failure than no photo at all, so a
   load error swaps back to the initials rather than leaving the browser to draw
   its own placeholder.
   ========================================================================== */
import { useState } from 'react'

interface AvatarProps {
  initials: string
  /** Public URL, or null for initials only. */
  url?: string | null
  /** Whose face it is — read out instead of the initials, which do not speak. */
  name?: string
  size?: 'sm' | 'md' | 'lg'
}

export function Avatar({ initials, url, name, size = 'md' }: AvatarProps) {
  const [failed, setFailed] = useState(false)
  const className = `avatar${size === 'sm' ? ' avatar--sm' : size === 'lg' ? ' avatar--lg' : ''}`

  if (!url || failed) {
    return (
      <span className={className} title={name} aria-label={name}>
        {initials}
      </span>
    )
  }

  return (
    <img
      className={`${className} avatar--photo`}
      src={url}
      alt={name ?? ''}
      /* The image is decorative next to a name that is already on screen in
         most places; where it is not, `name` supplies the label. */
      onError={() => setFailed(true)}
      loading="lazy"
    />
  )
}
