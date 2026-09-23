import { Link, useParams } from 'react-router-dom'

import { ButtonLink } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { QueryState } from '@/components/ui/QueryState'
import { useBlogPosts } from '@/lib/queries/content'
import { date } from '@/lib/format'

/* ============================================================================
   BlogPostPage — a single article, addressed by its slug (/blog/:slug).
   ----------------------------------------------------------------------------
   Slug-based URLs (not IDs) because they are readable and rank better in
   search. The body is a placeholder: when the CMS lands, render markdown/MDX
   from the `blog_posts` table here.

   Every article ends with a call to action back into the funnel — the whole
   point of the SEO content is to move readers to the estimator.
   ========================================================================== */

export function BlogPostPage() {
  const postsQuery = useBlogPosts()
  const BLOG_POSTS = postsQuery.data ?? []

  const { slug } = useParams<{ slug: string }>()
  const post = BLOG_POSTS.find((p) => p.slug === slug)

  // Distinguish "still loading" from "does not exist". Showing "Article not
  // found" for the second the query takes tells the reader something false.
  if (postsQuery.isLoading) {
    return (
      <div className="section">
        <div className="container container--narrow">
          <QueryState isLoading error={null}>
            {null}
          </QueryState>
        </div>
      </div>
    )
  }

  if (!post) {
    return (
      <div className="section">
        <div className="container container--narrow">
          <EmptyState
            icon="🔍"
            title="Article not found"
            message="That post may have been moved or renamed."
            action={
              <ButtonLink to="/blog" variant="outline">
                Back to all resources
              </ButtonLink>
            }
          />
        </div>
      </div>
    )
  }

  return (
    <article className="section">
      <div className="container container--narrow">
        <Link to="/blog" className="small muted">
          ← All resources
        </Link>

        <header style={{ marginBlock: 'var(--space-6)' }}>
          <div className="row">
            <span className="badge badge--brand">{post.category}</span>
            <span className="xs dim">
              {date(post.publishedAt ?? '')} · {post.readMinutes} min read
            </span>
          </div>
          <h1 style={{ marginTop: 'var(--space-4)' }}>{post.title}</h1>
          <p className="muted" style={{ fontSize: 'var(--text-md)', marginTop: 'var(--space-3)' }}>
            {post.excerpt}
          </p>
        </header>

        <div
          className="portfolio-item__media"
          style={{ height: 260, borderRadius: 'var(--radius-lg)' }}
        >
          Cover image
        </div>

        {/* Placeholder body — replace with rendered markdown from the CMS. */}
        <div
          className="stack"
          style={{ marginTop: 'var(--space-8)', fontSize: 'var(--text-md)', lineHeight: 1.7 }}
        >
          <p className="muted">
            Article body renders here once the content management module is connected. The layout is
            deliberately narrow (about 75 characters per line) because that is the comfortable
            reading measure for long-form text.
          </p>
          <p className="muted">
            Headings, lists, images, tables and callouts will all be styled from the same design
            tokens the rest of the site uses, so editorial content never looks bolted on.
          </p>
        </div>

        <Card accent style={{ marginTop: 'var(--space-12)' }}>
          <CardBody className="center">
            <h3>See what this means for your bill</h3>
            <p className="muted" style={{ marginBlock: 'var(--space-3)' }}>
              Run your actual numbers through the estimator — it takes about 20 seconds.
            </p>
            <ButtonLink to="/estimator" variant="primary">
              Calculate my savings
            </ButtonLink>
          </CardBody>
        </Card>
      </div>
    </article>
  )
}
