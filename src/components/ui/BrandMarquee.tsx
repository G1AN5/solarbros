import { useBrands } from '@/lib/queries/cms'

/* ============================================================================
   BrandMarquee — the equipment brands, moving.
   ----------------------------------------------------------------------------
   Was a centred row of nine grey words that wrapped onto two lines and read as
   a list of nouns rather than a statement about the business.

   HOW THE LOOP IS SEAMLESS
   The list is rendered TWICE and the track slides exactly -50%. At the moment
   it reaches the end of the first copy, the second copy is sitting in precisely
   the position the first one started in, so resetting to 0 is invisible. This
   is why the duplicate is not a mistake — remove it and the strip visibly
   snaps back.

   The duplicate is `aria-hidden`, so a screen reader hears each brand once.

   IT PAUSES ON HOVER, and stops entirely for anyone who has asked for reduced
   motion — an endlessly moving band is exactly the sort of thing that makes a
   page unusable for people who are sensitive to it.
   ========================================================================== */

export function BrandMarquee() {
  const { data: brands } = useBrands()
  const list = brands ?? []

  if (list.length === 0) return null

  const item = (brand: (typeof list)[number], copy: number) => {
    const inner = brand.logoUrl ? (
      <img src={brand.logoUrl} alt={brand.name} className="marquee__logo" loading="lazy" />
    ) : (
      /* No logo uploaded yet. The name set in the brand's own colours still
         reads as a mark rather than as body text. */
      <span className="marquee__name">{brand.name}</span>
    )

    return brand.websiteUrl ? (
      <a
        key={`${copy}-${brand.id}`}
        className="marquee__item"
        href={brand.websiteUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={`${brand.name} — opens in a new tab`}
      >
        {inner}
      </a>
    ) : (
      <span key={`${copy}-${brand.id}`} className="marquee__item">
        {inner}
      </span>
    )
  }

  return (
    <section className="marquee-band">
      <div className="container">
        <p className="marquee__eyebrow">Equipment we install</p>
      </div>

      <div className="marquee" role="region" aria-label="Brands we install">
        <div className="marquee__track">
          {list.map((brand) => item(brand, 0))}
          {/* The second pass is what makes the loop seamless. */}
          <span aria-hidden="true" style={{ display: 'contents' }}>
            {list.map((brand) => item(brand, 1))}
          </span>
        </div>
      </div>
    </section>
  )
}
