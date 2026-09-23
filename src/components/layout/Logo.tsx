import { useState } from 'react'

import { useCompany } from '@/lib/queries/public-site'

/* ============================================================================
   Logo — the brand mark plus the wordmark.
   ----------------------------------------------------------------------------
   The image lives at public/solarbroslogo.jpg, so it is served from the site
   root at a fixed URL rather than bundled with a hashed filename. That is the
   same file the browser tab uses, which means there is one logo to replace and
   not two that can fall out of step.

   IT FALLS BACK TO A DRAWN SUN.
   If the file is missing — a fresh clone, a bad deploy, somebody renaming it —
   `onError` swaps in the SVG that used to be the placeholder. A broken-image
   icon in the corner of every screen is a worse failure than a plain one, and
   this is the component that appears on literally every page.

   WHY THE ROUNDED, LIGHT BACKING
   A JPG has no transparency, so the logo carries its own background colour
   wherever it goes — including the dark sidebar and the dark public footer,
   where a bare white rectangle looks like a rendering fault. Sitting it on a
   deliberate rounded tile makes that square look intentional. Swap the file for
   a transparent PNG and this still works; the tile just stops being visible.
   ========================================================================== */

const LOGO_SRC = '/solarbroslogo.jpg'

export function Logo({
  inverse = false,
  compact = false,
}: {
  inverse?: boolean
  compact?: boolean
}) {
  const COMPANY = useCompany()
  const [imageFailed, setImageFailed] = useState(false)

  return (
    <span className="row" style={{ gap: 'var(--space-2)' }}>
      {imageFailed ? (
        <SunMark />
      ) : (
        <img
          src={LOGO_SRC}
          alt=""
          aria-hidden
          width={28}
          height={28}
          onError={() => setImageFailed(true)}
          style={{
            width: 28,
            height: 28,
            // `cover` rather than `contain`: a logo that is not square would
            // otherwise sit in a letterboxed strip that reads as a bug.
            objectFit: 'cover',
            borderRadius: 'var(--radius-sm, 6px)',
            background: 'var(--white, #fff)',
            flexShrink: 0,
          }}
        />
      )}

      {!compact && (
        <span
          style={{
            fontWeight: 750,
            fontSize: 'var(--text-lg)',
            letterSpacing: '-0.02em',
            color: inverse ? 'var(--white)' : 'var(--text-primary)',
          }}
        >
          {COMPANY.name}
        </span>
      )}
    </span>
  )
}

/**
 * The fallback mark, drawn rather than fetched.
 *
 * Inherits its colour from the brand token, so it is never wrong against a
 * theme — which is exactly why it makes a better fallback than a second image.
 */
function SunMark() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden focusable="false">
      <circle cx="12" cy="12" r="5" fill="var(--brand-500)" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
        <rect
          key={deg}
          x="11.2"
          y="0.5"
          width="1.6"
          height="4"
          rx="0.8"
          fill="var(--brand-500)"
          transform={`rotate(${deg} 12 12)`}
        />
      ))}
    </svg>
  )
}
