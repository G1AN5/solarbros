import { useState } from 'react'

import { Button } from '@/components/ui/Button'
import { getPrivateFileUrl } from '@/lib/queries/storage'

/* ============================================================================
   DownloadButton — one file out of the private bucket.
   ----------------------------------------------------------------------------
   The same three lines were needed on the customer's document vault, the
   staff project detail page and the warranty approvals queue, and only the
   first of the three had them: the other two were buttons with no handler.

   The file lives in a PRIVATE bucket, so there is no URL to link to. One is
   minted per press and lives for a minute — long enough to open, short enough
   that a forwarded link is dead by the time it arrives. That is why this is a
   button and not an anchor, and why the URL is never rendered into the page.
   ========================================================================== */

interface DownloadButtonProps {
  /** Path inside the bucket. Absent means the row has no file behind it. */
  storagePath?: string | null
  label?: string
  bucket?: 'project-files' | 'site-photos'
  variant?: 'ghost' | 'outline' | 'primary'
  size?: 'sm' | 'md'
  /** Shown instead of the generic message when there is no file. */
  missingHint?: string
}

export function DownloadButton({
  storagePath,
  label = 'Download',
  bucket = 'project-files',
  variant = 'ghost',
  size = 'sm',
  missingHint = 'No file has been uploaded for this record yet',
}: DownloadButtonProps) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  async function open() {
    if (!storagePath) return
    setBusy(true)
    setFailed(false)
    try {
      const url = await getPrivateFileUrl(bucket, storagePath)
      if (!url) {
        setFailed(true)
        return
      }
      window.open(url, '_blank', 'noopener')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      variant={variant}
      size={size}
      disabled={!storagePath || busy}
      // Say why it is greyed out. "Why is this disabled?" is a support call.
      title={storagePath ? undefined : missingHint}
      onClick={() => void open()}
    >
      {busy ? 'Preparing…' : failed ? 'Unavailable' : label}
    </Button>
  )
}
