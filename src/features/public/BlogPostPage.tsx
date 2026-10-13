import { Fragment, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'

import { ButtonLink } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { MediaCover } from '@/components/ui/MediaCover'
import { QueryState } from '@/components/ui/QueryState'
import { useBlogPosts } from '@/lib/queries/content'
import { date } from '@/lib/format'

/* ============================================================================
   BlogPostPage — a single article, addressed by its slug (/blog/:slug).
   ----------------------------------------------------------------------------
   Slug-based URLs (not IDs) because they are readable and rank better in
   search. The body is what the content editor wrote: blank lines separate
   paragraphs, and a handful of Markdown marks are understood — "## " for a
   heading, "- " or "1. " for a list, **bold**, and [links](https://…). It is
   turned into React elements, never into injected HTML, so an article cannot
   carry a script onto the public site.

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

        {post.coverPath && (
          <MediaCover
            path={post.coverPath}
            alt={post.title}
            style={{ aspectRatio: 'auto', height: 260, borderRadius: 'var(--radius-lg)' }}
          />
        )}

        <div
          className="stack article-body"
          style={{ marginTop: 'var(--space-8)', fontSize: 'var(--text-md)', lineHeight: 1.7 }}
        >
          {post.body?.trim() ? (
            <ArticleBody source={post.body} />
          ) : (
            <p className="muted">{post.excerpt}</p>
          )}
          {post.authorName && <p className="small dim">— {post.authorName}</p>}
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

/* --- The article body ------------------------------------------------------ */

function ArticleBody({ source }: { source: string }) {
  const blocks = source.replace(/\r\n/g, '\n').split(/\n{2,}/)
  return (
    <>
      {blocks.map((block, index) => {
        const text = block.trim()
        if (!text) return null
        if (text.startsWith('### ')) return <h4 key={index}>{inline(text.slice(4))}</h4>
        if (text.startsWith('## ')) return <h3 key={index}>{inline(text.slice(3))}</h3>
        if (text.startsWith('# ')) return <h2 key={index}>{inline(text.slice(2))}</h2>

        const lines = text.split('\n')
        if (lines.every((line) => /^[-*] /.test(line.trim()))) {
          return (
            <ul key={index}>
              {lines.map((line, i) => (
                <li key={i}>{inline(line.trim().slice(2))}</li>
              ))}
            </ul>
          )
        }
        if (lines.every((line) => /^\d+[.)] /.test(line.trim()))) {
          return (
            <ol key={index}>
              {lines.map((line, i) => (
                <li key={i}>{inline(line.trim().replace(/^\d+[.)] /, ''))}</li>
              ))}
            </ol>
          )
        }
        return (
          <p key={index}>
            {lines.map((line, i) => (
              <Fragment key={i}>
                {i > 0 && <br />}
                {inline(line)}
              </Fragment>
            ))}
          </p>
        )
      })}
    </>
  )
}

/** **bold** and [text](https://…) — nothing else, and only web links. */
function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  const pattern = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    if (match[1] !== undefined) {
      parts.push(<strong key={match.index}>{match[1]}</strong>)
    } else {
      parts.push(
        <a key={match.index} href={match[3]} target="_blank" rel="noreferrer noopener">
          {match[2]}
        </a>,
      )
    }
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}
