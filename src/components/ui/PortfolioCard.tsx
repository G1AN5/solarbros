import { publicMediaUrl, type PortfolioEntry } from '@/lib/queries/content'

/* ============================================================================
   PortfolioCard — one completed installation, as the public site shows it.
   ----------------------------------------------------------------------------
   Shared by the home page and /portfolio, which each drew their own version
   and both broke the same three ways:

     • inside the dark home section, the white card inherited the section's
       white heading colour — the project's name was invisible;
     • the photo kept its own proportions, so one tall picture made a card
       taller than the screen;
     • the story typed into "Short description" was never shown at all.

   The card now carries its own colours (light, or glass on a dark section),
   crops every photo to the same shape, and shows the story.
   ========================================================================== */

export function PortfolioCard({ item }: { item: PortfolioEntry }) {
  const url = publicMediaUrl(item.coverPath)
  const meta = [item.location, item.year ? `Completed ${item.year}` : null].filter(Boolean)

  return (
    <article className="pf-card">
      <div className="pf-card__media">
        {url && <img src={url} alt={item.title} loading="lazy" decoding="async" />}
        {item.segment && <span className="pf-card__segment">{item.segment}</span>}
        {item.systemSize && <span className="pf-card__size">{item.systemSize}</span>}
      </div>
      <div className="pf-card__body">
        <h3 className="pf-card__title">{item.title}</h3>
        {meta.length > 0 && <p className="pf-card__meta">{meta.join(' · ')}</p>}
        {item.summary && <p className="pf-card__summary">{item.summary}</p>}
      </div>
    </article>
  )
}
