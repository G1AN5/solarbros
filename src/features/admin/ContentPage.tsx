import { useState } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { QueryState } from '@/components/ui/QueryState'
import { Tabs } from '@/components/ui/Tabs'
import { FaqEditor, LegalEditor, PackagesEditor } from './ContentEditors'
import { useAuth } from '@/app/auth/useAuth'
import { date } from '@/lib/format'
import {
  publicMediaUrl,
  useBlogPosts,
  useDeleteBlogPost,
  useDeletePortfolioItem,
  useModerateReview,
  usePortfolio,
  useReviews,
  useSaveBlogPost,
  useSavePortfolioItem,
} from '@/lib/queries/content'
import { useUploadPublicMedia } from '@/lib/queries/storage'

/* ============================================================================
   ContentPage — the marketing content manager. (/admin/content)
   ----------------------------------------------------------------------------
   Everything the public website shows that is not operational data: the project
   portfolio, the blog, and customer reviews awaiting moderation.

   WHY THIS EXISTS RATHER THAN EDITING CODE
   Without it, adding a completed installation to the portfolio means a
   developer, a commit and a deploy. Sales will simply not do that, the
   portfolio will go stale, and the marketing site stops reflecting the company.
   Content that changes weekly does not belong in a repository.

   CONSENT IS ENFORCED, NOT REQUESTED
   A portfolio entry publishes a real customer's property, address and
   photographs. The publish toggle is disabled until consent is confirmed, and
   the database refuses the row regardless — so the check cannot be lost to a
   future UI change. See `portfolio_published_needs_consent` in migration 0017.

   IMAGES ARE COMPRESSED IN THE BROWSER before upload, so a 6 MB phone photo
   becomes roughly 300 KB without the original ever crossing the network.
   ========================================================================== */

type Tab = 'portfolio' | 'blog' | 'reviews' | 'packages' | 'faq' | 'legal'

const EMPTY_PORTFOLIO = {
  id: undefined as string | undefined,
  title: '',
  location: '',
  systemSize: '',
  segment: 'Residential',
  year: new Date().getFullYear(),
  summary: '',
  coverPath: null as string | null,
  published: false,
  clientConsented: false,
}

const EMPTY_POST = {
  id: undefined as string | undefined,
  slug: '',
  title: '',
  excerpt: '',
  body: '',
  category: 'Guides',
  readMinutes: 5,
  coverPath: null as string | null,
  published: false,
}

/** Turn a title into a URL-safe slug so an editor never has to think about it. */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export function ContentPage() {
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>('portfolio')

  // Drafts are unpublished rows, so the editor asks for everything.
  const portfolioQuery = usePortfolio(false)
  const blogQuery = useBlogPosts(false)
  const reviewsQuery = useReviews(false)

  const savePortfolio = useSavePortfolioItem()
  const deletePortfolio = useDeletePortfolioItem()
  const saveBlog = useSaveBlogPost()
  const deleteBlog = useDeleteBlogPost()
  const moderate = useModerateReview()
  const upload = useUploadPublicMedia()

  const [pf, setPf] = useState(EMPTY_PORTFOLIO)
  const [post, setPost] = useState(EMPTY_POST)
  const [editingPf, setEditingPf] = useState(false)
  const [editingPost, setEditingPost] = useState(false)

  async function handleUpload(file: File, folder: string, onDone: (path: string) => void) {
    try {
      const path = await upload.mutateAsync({ file, folder })
      onDone(path)
    } catch {
      // The mutation carries the error; the form renders it below.
    }
  }

  const pending = reviewsQuery.data?.filter((r) => r.status === 'pending') ?? []

  return (
    <>
      <PageHeader
        title="Website content"
        description="The portfolio, blog and customer reviews shown on the public site."
        actions={
          <a href="/" target="_blank" rel="noreferrer" className="btn btn--outline">
            View public site ↗
          </a>
        }
      />

      <Tabs
        tabs={[
          { value: 'portfolio' as Tab, label: 'Portfolio', count: portfolioQuery.data?.length },
          { value: 'blog' as Tab, label: 'Blog', count: blogQuery.data?.length },
          {
            value: 'reviews' as Tab,
            label: 'Reviews',
            count: pending.length || undefined,
          },
          { value: 'packages' as Tab, label: 'Packages' },
          { value: 'faq' as Tab, label: 'FAQ' },
          { value: 'legal' as Tab, label: 'Legal pages' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {/* The package range, the FAQ and the legal pages. All three were
          writable by the database from the start and had no screen, so the only
          way to add a package or correct an answer was to open the SQL editor. */}
      {tab === 'packages' && <PackagesEditor />}
      {tab === 'faq' && <FaqEditor />}
      {tab === 'legal' && <LegalEditor />}

      {/* ==================================================== PORTFOLIO */}
      {tab === 'portfolio' && (
        <div className="grid grid--2" style={{ alignItems: 'start' }}>
          <Card>
            <CardHeader
              title={pf.id ? 'Edit project' : 'Add a completed project'}
              action={
                editingPf && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setPf(EMPTY_PORTFOLIO)
                      setEditingPf(false)
                    }}
                  >
                    Cancel
                  </Button>
                )
              }
            />
            <CardBody>
              <form
                className="stack"
                onSubmit={(e) => {
                  e.preventDefault()
                  savePortfolio.mutate(
                    { ...pf, year: Number(pf.year) || undefined },
                    {
                      onSuccess: () => {
                        setPf(EMPTY_PORTFOLIO)
                        setEditingPf(false)
                      },
                    },
                  )
                }}
              >
                <div className="field">
                  <label className="field__label" htmlFor="pfTitle">
                    Project title
                  </label>
                  <input
                    id="pfTitle"
                    className="input"
                    required
                    placeholder="e.g. Hillside Residence"
                    value={pf.title}
                    onChange={(e) => setPf({ ...pf, title: e.target.value })}
                  />
                </div>

                <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
                  <div className="field" style={{ flex: 1 }}>
                    <label className="field__label" htmlFor="pfLocation">
                      Location
                    </label>
                    <input
                      id="pfLocation"
                      className="input"
                      placeholder="Antipolo, Rizal"
                      value={pf.location}
                      onChange={(e) => setPf({ ...pf, location: e.target.value })}
                    />
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    <label className="field__label" htmlFor="pfSize">
                      System
                    </label>
                    <input
                      id="pfSize"
                      className="input"
                      placeholder="10kW Hybrid"
                      value={pf.systemSize}
                      onChange={(e) => setPf({ ...pf, systemSize: e.target.value })}
                    />
                  </div>
                </div>

                <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
                  <div className="field" style={{ flex: 1 }}>
                    <label className="field__label" htmlFor="pfSegment">
                      Segment
                    </label>
                    <select
                      id="pfSegment"
                      className="select"
                      value={pf.segment}
                      onChange={(e) => setPf({ ...pf, segment: e.target.value })}
                    >
                      {[
                        'Residential',
                        'Commercial',
                        'Industrial',
                        'Hospitality',
                        'Agricultural',
                      ].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    <label className="field__label" htmlFor="pfYear">
                      Year
                    </label>
                    <input
                      id="pfYear"
                      className="input"
                      type="number"
                      value={pf.year}
                      onChange={(e) => setPf({ ...pf, year: Number(e.target.value) })}
                    />
                  </div>
                </div>

                <div className="field">
                  <label className="field__label" htmlFor="pfSummary">
                    Short description
                  </label>
                  <textarea
                    id="pfSummary"
                    className="textarea"
                    placeholder="What made this installation interesting?"
                    value={pf.summary}
                    onChange={(e) => setPf({ ...pf, summary: e.target.value })}
                  />
                </div>

                {/* ------------------------------------- COVER IMAGE */}
                <div className="field">
                  <span className="field__label">Cover photo</span>
                  {pf.coverPath ? (
                    <div className="stack stack--sm">
                      <img
                        src={publicMediaUrl(pf.coverPath) ?? ''}
                        alt="Cover preview"
                        style={{
                          width: '100%',
                          maxHeight: 180,
                          objectFit: 'cover',
                          borderRadius: 'var(--radius)',
                        }}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setPf({ ...pf, coverPath: null })}
                      >
                        Remove photo
                      </Button>
                    </div>
                  ) : (
                    <input
                      className="input"
                      type="file"
                      accept="image/*"
                      disabled={upload.isPending}
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) {
                          void handleUpload(file, 'portfolio', (path) =>
                            setPf((prev) => ({ ...prev, coverPath: path })),
                          )
                        }
                      }}
                    />
                  )}
                  <span className="field__hint">
                    {upload.isPending
                      ? 'Uploading…'
                      : 'JPG, PNG or WebP. Large photos are shrunk automatically before upload.'}
                  </span>
                </div>

                {/* ------------------------------------ CONSENT GATE */}
                <label
                  className="row"
                  style={{
                    padding: 'var(--space-3)',
                    border: `1px solid ${pf.clientConsented ? 'var(--success-solid)' : 'var(--warning-solid)'}`,
                    background: pf.clientConsented ? 'var(--success-bg)' : 'var(--warning-bg)',
                    borderRadius: 'var(--radius)',
                    cursor: 'pointer',
                    alignItems: 'flex-start',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={pf.clientConsented}
                    onChange={(e) =>
                      setPf({
                        ...pf,
                        clientConsented: e.target.checked,
                        // Unticking consent must also unpublish, or the form
                        // would submit a state the database refuses anyway.
                        published: e.target.checked ? pf.published : false,
                      })
                    }
                  />
                  <span className="small">
                    <strong>The customer agreed to this being published.</strong> Their property,
                    location and photos will be visible to anyone on the internet.
                  </span>
                </label>

                <label className="row" style={{ cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={pf.published}
                    disabled={!pf.clientConsented}
                    onChange={(e) => setPf({ ...pf, published: e.target.checked })}
                  />
                  <span className="small">
                    Show on the public site
                    {!pf.clientConsented && <span className="dim"> — confirm consent first</span>}
                  </span>
                </label>

                {savePortfolio.error && (
                  <p
                    className="small"
                    style={{
                      padding: 'var(--space-3)',
                      background: 'var(--danger-bg)',
                      color: 'var(--danger-fg)',
                      borderRadius: 'var(--radius)',
                    }}
                    role="alert"
                  >
                    {(savePortfolio.error as Error).message}
                  </p>
                )}
                {upload.error && (
                  <p className="small" style={{ color: 'var(--danger-fg)' }}>
                    {(upload.error as Error).message}
                  </p>
                )}

                <Button type="submit" variant="primary" disabled={savePortfolio.isPending}>
                  {savePortfolio.isPending ? 'Saving…' : pf.id ? 'Save changes' : 'Add project'}
                </Button>
              </form>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Projects" />
            <CardBody>
              <QueryState
                isLoading={portfolioQuery.isLoading}
                error={portfolioQuery.error as Error | null}
                isEmpty={(portfolioQuery.data?.length ?? 0) === 0}
                emptyIcon="📸"
                emptyTitle="No projects yet"
                emptyMessage="Add your first completed installation using the form."
              >
                <div className="stack stack--sm">
                  {(portfolioQuery.data ?? []).map((item) => (
                    <div
                      key={item.id}
                      className="row row--between"
                      style={{
                        padding: 'var(--space-3)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius)',
                      }}
                    >
                      <div className="row">
                        {item.coverPath ? (
                          <img
                            src={publicMediaUrl(item.coverPath) ?? ''}
                            alt=""
                            style={{
                              width: 48,
                              height: 48,
                              objectFit: 'cover',
                              borderRadius: 'var(--radius-sm)',
                            }}
                          />
                        ) : (
                          <span
                            style={{
                              width: 48,
                              height: 48,
                              display: 'grid',
                              placeItems: 'center',
                              background: 'var(--bg-raised)',
                              borderRadius: 'var(--radius-sm)',
                            }}
                            aria-hidden
                          >
                            🏠
                          </span>
                        )}
                        <div>
                          <div className="small strong">{item.title}</div>
                          <div className="xs dim">
                            {item.location} · {item.systemSize}
                          </div>
                        </div>
                      </div>
                      <div className="row">
                        <Badge tone={item.published ? 'success' : 'neutral'}>
                          {item.published ? 'Live' : 'Draft'}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setPf({
                              id: item.id,
                              title: item.title,
                              location: item.location ?? '',
                              systemSize: item.systemSize ?? '',
                              segment: item.segment ?? 'Residential',
                              year: item.year ?? new Date().getFullYear(),
                              summary: item.summary ?? '',
                              coverPath: item.coverPath,
                              published: item.published,
                              clientConsented: item.clientConsented,
                            })
                            setEditingPf(true)
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (window.confirm(`Remove "${item.title}" from the portfolio?`)) {
                              deletePortfolio.mutate(item.id)
                            }
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </QueryState>
            </CardBody>
          </Card>
        </div>
      )}

      {/* ========================================================= BLOG */}
      {tab === 'blog' && (
        <div className="grid grid--2" style={{ alignItems: 'start' }}>
          <Card>
            <CardHeader
              title={post.id ? 'Edit post' : 'Write a post'}
              action={
                editingPost && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setPost(EMPTY_POST)
                      setEditingPost(false)
                    }}
                  >
                    Cancel
                  </Button>
                )
              }
            />
            <CardBody>
              <form
                className="stack"
                onSubmit={(e) => {
                  e.preventDefault()
                  saveBlog.mutate(
                    {
                      ...post,
                      slug: post.slug || slugify(post.title),
                      readMinutes: Number(post.readMinutes) || undefined,
                      authorName: user?.fullName,
                    },
                    {
                      onSuccess: () => {
                        setPost(EMPTY_POST)
                        setEditingPost(false)
                      },
                    },
                  )
                }}
              >
                <div className="field">
                  <label className="field__label" htmlFor="postTitle">
                    Title
                  </label>
                  <input
                    id="postTitle"
                    className="input"
                    required
                    value={post.title}
                    onChange={(e) =>
                      setPost({
                        ...post,
                        title: e.target.value,
                        // Only auto-fill the slug while creating. Changing it on
                        // a published post would break every existing link.
                        slug: post.id ? post.slug : slugify(e.target.value),
                      })
                    }
                  />
                </div>

                <div className="field">
                  <label className="field__label" htmlFor="postSlug">
                    Web address
                  </label>
                  <input
                    id="postSlug"
                    className="input"
                    required
                    value={post.slug}
                    onChange={(e) => setPost({ ...post, slug: slugify(e.target.value) })}
                  />
                  <span className="field__hint">
                    solarbros.ph/blog/<strong>{post.slug || 'your-post'}</strong>
                    {post.id && ' — changing this breaks existing links'}
                  </span>
                </div>

                <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
                  <div className="field" style={{ flex: 2 }}>
                    <label className="field__label" htmlFor="postCategory">
                      Category
                    </label>
                    <select
                      id="postCategory"
                      className="select"
                      value={post.category}
                      onChange={(e) => setPost({ ...post, category: e.target.value })}
                    >
                      {['Guides', 'Technical', 'Company news', 'Case studies'].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    <label className="field__label" htmlFor="postRead">
                      Read time
                    </label>
                    <input
                      id="postRead"
                      className="input"
                      type="number"
                      min={1}
                      value={post.readMinutes}
                      onChange={(e) => setPost({ ...post, readMinutes: Number(e.target.value) })}
                    />
                  </div>
                </div>

                <div className="field">
                  <label className="field__label" htmlFor="postExcerpt">
                    Summary
                  </label>
                  <textarea
                    id="postExcerpt"
                    className="textarea"
                    placeholder="One or two sentences shown on the blog index."
                    value={post.excerpt}
                    onChange={(e) => setPost({ ...post, excerpt: e.target.value })}
                  />
                </div>

                <div className="field">
                  <label className="field__label" htmlFor="postBody">
                    Article
                  </label>
                  <textarea
                    id="postBody"
                    className="textarea"
                    style={{ minHeight: 220 }}
                    placeholder="Write the article here. Blank lines separate paragraphs."
                    value={post.body}
                    onChange={(e) => setPost({ ...post, body: e.target.value })}
                  />
                </div>

                <div className="field">
                  <span className="field__label">Cover image</span>
                  {post.coverPath ? (
                    <div className="stack stack--sm">
                      <img
                        src={publicMediaUrl(post.coverPath) ?? ''}
                        alt="Cover preview"
                        style={{
                          width: '100%',
                          maxHeight: 160,
                          objectFit: 'cover',
                          borderRadius: 'var(--radius)',
                        }}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setPost({ ...post, coverPath: null })}
                      >
                        Remove image
                      </Button>
                    </div>
                  ) : (
                    <input
                      className="input"
                      type="file"
                      accept="image/*"
                      disabled={upload.isPending}
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) {
                          void handleUpload(file, 'blog', (path) =>
                            setPost((prev) => ({ ...prev, coverPath: path })),
                          )
                        }
                      }}
                    />
                  )}
                </div>

                <label className="row" style={{ cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={post.published}
                    onChange={(e) => setPost({ ...post, published: e.target.checked })}
                  />
                  <span className="small">Publish to the website</span>
                </label>

                {saveBlog.error && (
                  <p
                    className="small"
                    style={{
                      padding: 'var(--space-3)',
                      background: 'var(--danger-bg)',
                      color: 'var(--danger-fg)',
                      borderRadius: 'var(--radius)',
                    }}
                    role="alert"
                  >
                    {(saveBlog.error as Error).message}
                  </p>
                )}

                <Button type="submit" variant="primary" disabled={saveBlog.isPending}>
                  {saveBlog.isPending ? 'Saving…' : post.id ? 'Save changes' : 'Create post'}
                </Button>
              </form>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Posts" />
            <CardBody>
              <QueryState
                isLoading={blogQuery.isLoading}
                error={blogQuery.error as Error | null}
                isEmpty={(blogQuery.data?.length ?? 0) === 0}
                emptyIcon="✍️"
                emptyTitle="No posts yet"
                emptyMessage="Articles help prospects trust you before they ever call."
              >
                <div className="stack stack--sm">
                  {(blogQuery.data ?? []).map((item) => (
                    <div
                      key={item.id}
                      className="row row--between"
                      style={{
                        padding: 'var(--space-3)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius)',
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div className="small strong">{item.title}</div>
                        <div className="xs dim">
                          {item.category}
                          {item.publishedAt && ` · ${date(item.publishedAt)}`}
                        </div>
                      </div>
                      <div className="row">
                        <Badge tone={item.published ? 'success' : 'neutral'}>
                          {item.published ? 'Live' : 'Draft'}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setPost({
                              id: item.id,
                              slug: item.slug,
                              title: item.title,
                              excerpt: item.excerpt ?? '',
                              body: item.body ?? '',
                              category: item.category ?? 'Guides',
                              readMinutes: item.readMinutes ?? 5,
                              coverPath: item.coverPath,
                              published: item.published,
                            })
                            setEditingPost(true)
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (window.confirm(`Delete "${item.title}"?`)) {
                              deleteBlog.mutate(item.id)
                            }
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </QueryState>
            </CardBody>
          </Card>
        </div>
      )}

      {/* ====================================================== REVIEWS */}
      {tab === 'reviews' && (
        <Card>
          <CardHeader
            title="Customer reviews"
            action={
              pending.length > 0 ? (
                <Badge tone="warning">{pending.length} awaiting moderation</Badge>
              ) : undefined
            }
          />
          <CardBody>
            <p className="small muted" style={{ marginBottom: 'var(--space-4)' }}>
              Reviews are requested automatically when a project closes. Nothing reaches the public
              site until somebody approves it here.
            </p>

            <QueryState
              isLoading={reviewsQuery.isLoading}
              error={reviewsQuery.error as Error | null}
              isEmpty={(reviewsQuery.data?.length ?? 0) === 0}
              emptyIcon="⭐"
              emptyTitle="No reviews yet"
              emptyMessage="They arrive as projects reach turnover."
            >
              <div className="stack">
                {(reviewsQuery.data ?? []).map((review) => (
                  <div
                    key={review.id}
                    style={{
                      padding: 'var(--space-4)',
                      border: '1px solid var(--border)',
                      borderLeft: `3px solid ${
                        review.status === 'approved'
                          ? 'var(--success-solid)'
                          : review.status === 'rejected'
                            ? 'var(--danger-solid)'
                            : 'var(--warning-solid)'
                      }`,
                      borderRadius: 'var(--radius)',
                    }}
                  >
                    <div className="row row--between">
                      <span className="row">
                        <span aria-hidden>{'★'.repeat(review.rating)}</span>
                        <span className="small strong">{review.displayName}</span>
                        <span className="xs dim">{review.displayLocation}</span>
                      </span>
                      <Badge
                        tone={
                          review.status === 'approved'
                            ? 'success'
                            : review.status === 'rejected'
                              ? 'danger'
                              : 'warning'
                        }
                      >
                        {review.published ? 'Live' : review.status}
                      </Badge>
                    </div>

                    <p className="small" style={{ marginTop: 'var(--space-3)' }}>
                      {review.quote}
                    </p>

                    {review.status === 'pending' && (
                      <div className="row" style={{ marginTop: 'var(--space-3)' }}>
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={moderate.isPending}
                          onClick={() =>
                            moderate.mutate({
                              id: review.id,
                              approve: true,
                              moderatorId: user?.id ?? '',
                            })
                          }
                        >
                          Approve &amp; publish
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={moderate.isPending}
                          onClick={() =>
                            moderate.mutate({
                              id: review.id,
                              approve: false,
                              moderatorId: user?.id ?? '',
                            })
                          }
                        >
                          Reject
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </QueryState>
          </CardBody>
        </Card>
      )}
    </>
  )
}
