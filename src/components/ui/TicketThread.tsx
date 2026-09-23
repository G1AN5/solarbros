import { type FormEvent, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { FormError } from '@/components/ui/FormError'
import { relative } from '@/lib/format'
import { DownloadButton } from '@/components/ui/DownloadButton'
import { usePostTicketMessage, useTicketAttachments, useTicketThread } from '@/lib/queries/tickets'

/* ============================================================================
   TicketThread — one conversation, rendered the same on both sides.
   ----------------------------------------------------------------------------
   Written once and used by the customer's support page and the staff queue,
   because the alternative is two views of the same rows that drift apart. The
   only difference between them is `allowInternal`, and even that is a
   convenience: migration 0039 refuses an internal note from a customer whether
   or not this component offers the checkbox.

   Deliberately plain markup — no avatars, no bubbles with tails, no animation
   on arrival. A technician reads this on a phone with two bars of signal.
   ========================================================================== */

interface TicketThreadProps {
  ticketId: string
  /** Staff only: lets the author keep a note out of the customer's view. */
  allowInternal?: boolean
  /** A closed ticket is history. Reading stays; writing stops. */
  readOnly?: boolean
}

export function TicketThread({ ticketId, allowInternal, readOnly }: TicketThreadProps) {
  const threadQuery = useTicketThread(ticketId)
  const messages = threadQuery.data ?? []
  const post = usePostTicketMessage()
  const attachments = useTicketAttachments(ticketId).data ?? []
  const [internal, setInternal] = useState(false)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const body = String(new FormData(form).get('body') ?? '')

    post.mutate(
      { ticketId, body, isInternal: allowInternal ? internal : false },
      {
        onSuccess: () => {
          form.reset()
          setInternal(false)
        },
      },
    )
  }

  return (
    <div className="thread">
      {attachments.length > 0 && (
        <div className="thread__files">
          <span className="field__label">
            {attachments.length} attachment{attachments.length === 1 ? '' : 's'}
          </span>
          {attachments.map((file) => (
            <div key={file.id} className="row row--between">
              <span className="small">📎 {file.name}</span>
              <DownloadButton storagePath={file.storagePath} label="Open" />
            </div>
          ))}
        </div>
      )}

      {threadQuery.isLoading ? (
        <p className="small dim">Loading the conversation…</p>
      ) : messages.length === 0 ? (
        <p className="small dim">
          Nothing has been said on this ticket yet. The first message is a good place to add
          anything that did not fit in the description.
        </p>
      ) : (
        <div className="thread__list">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`thread__msg${message.authorIsStaff ? ' thread__msg--staff' : ''}${
                message.isInternal ? ' thread__msg--internal' : ''
              }`}
            >
              <div className="thread__meta">
                <span className="strong">{message.authorName}</span>
                {message.isInternal && <span className="thread__tag">Internal note</span>}
                <span className="dim">{relative(message.createdAt)}</span>
              </div>
              {/* white-space: pre-wrap in the stylesheet, so the line breaks
                  someone typed survive without dangerouslySetInnerHTML. */}
              <p className="thread__body">{message.body}</p>
            </div>
          ))}
        </div>
      )}

      {!readOnly && (
        <form className="thread__compose" onSubmit={handleSubmit}>
          <textarea
            name="body"
            className="textarea"
            rows={3}
            required
            placeholder={allowInternal ? 'Reply to the customer…' : 'Add to this ticket…'}
          />

          <div className="row row--between">
            {allowInternal ? (
              <label className="row small" style={{ gap: 'var(--space-2)' }}>
                <input
                  type="checkbox"
                  checked={internal}
                  onChange={(event) => setInternal(event.target.checked)}
                />
                Internal note — the customer will not see this
              </label>
            ) : (
              <span className="xs dim">Our team is notified as soon as you send this.</span>
            )}

            <Button type="submit" variant="primary" size="sm" disabled={post.isPending}>
              {post.isPending ? 'Sending…' : 'Send'}
            </Button>
          </div>

          <FormError error={post.error} />
        </form>
      )}
    </div>
  )
}
