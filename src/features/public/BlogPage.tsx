import { Link } from 'react-router-dom'

import { Card, CardBody } from '@/components/ui/Card'
import { MediaCover } from '@/components/ui/MediaCover'
import { QueryState } from '@/components/ui/QueryState'
import { useBlogPosts } from '@/lib/queries/content'
import { date } from '@/lib/format'
import { PageBanner } from '@/components/layout/PageBanner'

/* ============================================================================
   BlogPage — the "Blog/resources section for SEO" from the spec.
   ----------------------------------------------------------------------------
   Purpose is organic search traffic: buying guides and maintenance content that
   ranks for the questions prospects type before they know SolarBros exists.

   Backend plan: a `blog_posts` table with slug, MDX/markdown body, cover image,
   published_at and meta description. Marketing edits via the CMS module. If SEO
   becomes a priority, consider pre-rendering these routes at build time — a
   client-rendered SPA is a handicap for search indexing.
   ========================================================================== */

export function BlogPage() {
  const postsQuery = useBlogPosts()
  const BLOG_POSTS = postsQuery.data ?? []

  const [featured, ...rest] = BLOG_POSTS

  /*
   * With the mock fixtures there were always four posts, so the featured-post
   * destructure could never be undefined. Reading from the database it can be:
   * while the query is in flight, and on a fresh install with nothing published
   * yet. Rendering `featured.slug` in either case crashed the page.
   *
   * This is the class of bug that only appears once fake data is removed, which
   * is a good argument for removing it.
   */
  if (postsQuery.isLoading || postsQuery.error || !featured) {
    return (
      <div className="section">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">Resources</span>
            <h1>Guides &amp; maintenance tips</h1>
          </div>
          <QueryState
            isLoading={postsQuery.isLoading}
            error={postsQuery.error as Error | null}
            isEmpty={!featured}
            emptyIcon="&#9997;"
            emptyTitle="No articles yet"
            emptyMessage="Guides and explainers will appear here soon."
          >
            {null}
          </QueryState>
        </div>
      </div>
    )
  }

  return (
    <>
      <PageBanner
        eyebrow="Resources"
        title="Guides & maintenance tips"
        lead="Plain-language explainers on sizing, net-metering, and keeping a system healthy through the rainy season."
      />

      <div className="section section--muted">
        <div className="container">
          {/* Featured post gets the full width — the newest piece leads. */}
          <Link to={`/blog/${featured.slug}`}>
            <Card interactive>
              <MediaCover
                path={featured.coverPath}
                alt={featured.title}
                style={{ aspectRatio: 'auto', height: 220 }}
              />
              <CardBody>
                <div className="row">
                  <span className="badge badge--brand">{featured.category}</span>
                  <span className="xs dim">
                    {date(featured.publishedAt ?? '')} · {featured.readMinutes} min read
                  </span>
                </div>
                <h2 style={{ marginBlock: 'var(--space-3)' }}>{featured.title}</h2>
                <p className="muted">{featured.excerpt}</p>
              </CardBody>
            </Card>
          </Link>

          {/* Each article with its cover, in centred rows of equal width — text-only
              cards under a photographic lead read as an unfinished page. */}
          <div
            className="gallery"
            // Three to a row exactly spanning the featured article above them.
            style={
              { marginTop: 'var(--space-8)', '--gallery-item': '380px' } as React.CSSProperties
            }
          >
            {rest.map((post) => (
              <Link key={post.slug} to={`/blog/${post.slug}`}>
                <Card interactive className="portfolio-item" style={{ height: '100%' }}>
                  <MediaCover path={post.coverPath} alt={post.title} />
                  <CardBody>
                    <div className="row">
                      <span className="badge badge--neutral">{post.category}</span>
                      <span className="xs dim">{post.readMinutes} min</span>
                    </div>
                    <h4 style={{ marginBlock: 'var(--space-3)' }}>{post.title}</h4>
                    <p className="small muted">{post.excerpt}</p>
                    <p className="xs dim" style={{ marginTop: 'var(--space-3)' }}>
                      {date(post.publishedAt ?? '')}
                    </p>
                  </CardBody>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
