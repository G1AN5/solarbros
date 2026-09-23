/* ============================================================================
   SolarMark — the sun over a panel array.
   ----------------------------------------------------------------------------
   The one piece of illustration on the site, and it is drawn entirely in CSS:
   gradients for the silicon and the corona, a repeating conic gradient for the
   rays, transforms for the perspective. No image is fetched.

   That is not frugality for its own sake. A hero image heavy enough to look
   good is typically 200-400 KB, it is the largest contentful paint on the page,
   and it is loaded by exactly the person this site exists to persuade — a
   homeowner on mobile data deciding whether to spend PHP 400,000. This renders
   with the stylesheet that was already required.

   `aria-hidden` throughout: it is decoration. The headline next to it carries
   the meaning, and a screen reader announcing "sun, solar panel" would be
   noise between the eyebrow and the heading somebody actually wants.
   ========================================================================== */

export function SolarMark({ size = 280 }: { size?: number }) {
  return (
    <div className="solar-mark" aria-hidden>
      <div className="panel-array" />
      {/* `min()` rather than a media query: this is an INLINE style, so a
          later `--sun-size` rule in the stylesheet would lose to it and the sun
          would stay at its desktop size on a phone. Expressing the cap here is
          the only place it can win. */}
      <div className="sun" style={{ ['--sun-size' as string]: `min(${size}px, 42vw)` }}>
        <div className="sun__disc" />
      </div>
    </div>
  )
}
