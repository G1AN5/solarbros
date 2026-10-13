import { type FormEvent, useState } from 'react'

import { useAuth } from '@/app/auth/useAuth'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { FormError } from '@/components/ui/FormError'
import { SYSTEM_TYPE_LABEL } from '@/lib/labels'
import { useMyReviews, useSubmitReview } from '@/lib/queries/client-portal'
import type { Project } from '@/types/domain'

/* ============================================================================
   LeaveReviewCard — asked once the installation is finished.
   ----------------------------------------------------------------------------
   The reviews on the public site could only be typed in by staff. A customer
   whose system is handed over is now asked here, once; what they write goes
   to the content team, who approve it before it is published — word for word.
   ========================================================================== */

export function LeaveReviewCard({ project }: { project: Project }) {
  const { user } = useAuth()
  const reviews = useMyReviews().data
  const submit = useSubmitReview()
  const [stars, setStars] = useState(5)
  const [sent, setSent] = useState(false)

  // Still loading, or already reviewed this project: nothing to ask.
  if (!reviews || reviews.some((r) => r.projectId === project.id)) {
    return sent ? <Thanks /> : null
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    submit.mutate(
      {
        projectId: project.id,
        rating: stars,
        quote: String(form.get('quote') ?? ''),
        displayName: String(form.get('displayName') ?? ''),
        displayLocation: String(form.get('displayLocation') ?? ''),
        systemSummary: `${project.systemKw} kWp ${SYSTEM_TYPE_LABEL[project.systemType]}`,
      },
      { onSuccess: () => setSent(true) },
    )
  }

  return (
    <Card style={{ marginBottom: 'var(--space-6)' }}>
      <CardHeader title="How did we do?" />
      <CardBody>
        <form className="stack" onSubmit={handleSubmit}>
          <p className="small muted">
            Your system is handed over — we would love to hear how it went. With your permission
            your words may appear on our website, after our team has read them.
          </p>

          <div className="row" style={{ gap: 4 }}>
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                className="star-button"
                style={{ fontSize: '1.75rem' }}
                aria-label={`${value} star${value === 1 ? '' : 's'}`}
                aria-pressed={stars >= value}
                onClick={() => setStars(value)}
              >
                {stars >= value ? '★' : '☆'}
              </button>
            ))}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="review-quote">
              Your review
            </label>
            <textarea
              id="review-quote"
              name="quote"
              className="textarea"
              rows={4}
              required
              minLength={10}
              placeholder="What was it like working with us, and how is the system doing?"
            />
          </div>

          <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
            <div className="field" style={{ flex: 1 }}>
              <label className="field__label" htmlFor="review-name">
                Name to show
              </label>
              <input
                id="review-name"
                name="displayName"
                className="input"
                defaultValue={user?.fullName.split(' ')[0] ?? ''}
                placeholder="e.g. Maria S."
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label className="field__label" htmlFor="review-location">
                City <span className="dim">(optional)</span>
              </label>
              <input
                id="review-location"
                name="displayLocation"
                className="input"
                placeholder="e.g. Paranaque"
              />
            </div>
          </div>

          <FormError error={submit.error} />

          <Button type="submit" variant="primary" disabled={submit.isPending}>
            {submit.isPending ? 'Sending…' : 'Send my review'}
          </Button>
        </form>
      </CardBody>
    </Card>
  )
}

function Thanks() {
  return (
    <Card style={{ marginBottom: 'var(--space-6)', borderColor: 'var(--success-solid)' }}>
      <CardBody>
        <p className="small">
          Thank you for your review. Our team reads every one before it is published.
        </p>
      </CardBody>
    </Card>
  )
}
