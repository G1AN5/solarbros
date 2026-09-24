import { useEffect, useRef, useState, type FormEvent } from 'react'

import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { FormError } from '@/components/ui/FormError'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { QueryState } from '@/components/ui/QueryState'
import { relative } from '@/lib/format'
import { ROLE_LABEL } from '@/lib/labels'
import {
  useConversations,
  useMarkRead,
  useMessageableDirectory,
  useSendMessage,
  useStartConversation,
  useThread,
} from '@/lib/queries/messages'

/* ============================================================================
   MessagesPage — one page, all three portals.
   ----------------------------------------------------------------------------
   WHO CAN WRITE TO WHOM IS NOT DECIDED HERE
   The "New message" list is whatever `messageable_people` returns, which is
   already filtered by the database. This page never sees the names a customer
   is not entitled to, so there is no client-side filter to get wrong and no
   way to widen it by tampering with the request.

   TWO PANES ON A DESKTOP, ONE AT A TIME ON A PHONE
   A list beside a thread needs width that a phone does not have. Below the
   breakpoint the list becomes the page, and opening a conversation replaces it
   — which is how every messaging app on a phone behaves, and means no separate
   mobile route.
   ========================================================================== */

export function MessagesPage() {
  const conversationsQuery = useConversations()
  const conversations = conversationsQuery.data ?? []

  const [openId, setOpenId] = useState<string | null>(null)
  const [composing, setComposing] = useState(false)

  const thread = useThread(openId ?? undefined)
  const sendMessage = useSendMessage()
  const startConversation = useStartConversation()
  const markRead = useMarkRead()
  const directory = useMessageableDirectory()

  const open = conversations.find((c) => c.id === openId)
  const endOfThread = useRef<HTMLDivElement>(null)

  /* Clearing the unread badge is a side effect of opening the thread, which is
     exactly what an effect is for — it synchronises the database with what the
     person has now seen. */
  const markReadMutate = markRead.mutate
  useEffect(() => {
    if (openId) markReadMutate(openId)
  }, [openId, markReadMutate])

  // Newest message in view when a thread opens and when one arrives.
  useEffect(() => {
    endOfThread.current?.scrollIntoView({ block: 'end' })
  }, [thread.data])

  function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!openId) return
    const form = event.currentTarget
    const body = String(new FormData(form).get('body') ?? '')
    if (!body.trim()) return

    sendMessage.mutate({ conversationId: openId, body }, { onSuccess: () => form.reset() })
  }

  function handleStart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const otherId = String(form.get('person') ?? '')
    const body = String(form.get('body') ?? '')
    if (!otherId || !body.trim()) return

    startConversation.mutate(
      { otherId, body },
      {
        onSuccess: (conversationId) => {
          setComposing(false)
          setOpenId(conversationId)
        },
      },
    )
  }

  return (
    <div className="stack">
      <PageHeader
        title="Messages"
        description="Direct conversations with the people you work with."
        actions={
          <Button variant="primary" onClick={() => setComposing(true)}>
            New message
          </Button>
        }
      />

      <FormError error={sendMessage.error ?? startConversation.error} />

      <QueryState
        isLoading={conversationsQuery.isLoading}
        error={conversationsQuery.error}
        loadingLabel="Loading your conversations…"
      >
        <div className={`msg${openId ? ' msg--thread-open' : ''}`}>
          {/* ------------------------------------------------ THE LIST */}
          <div className="msg__list">
            {conversations.length === 0 && (
              <Card>
                <CardBody>
                  <p className="small muted">
                    No conversations yet. “New message” shows everyone you can write to.
                  </p>
                </CardBody>
              </Card>
            )}

            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                className={`msg__row${conversation.id === openId ? ' is-active' : ''}`}
                onClick={() => setOpenId(conversation.id)}
              >
                <Avatar
                  initials={conversation.other?.avatarInitials ?? '??'}
                  url={conversation.other?.avatarUrl}
                  name={conversation.other?.fullName}
                />
                <span className="msg__row-text">
                  <span className="row row--between">
                    <span className="strong small">
                      {conversation.other?.fullName ?? 'Removed account'}
                    </span>
                    <span className="xs dim">{relative(conversation.lastMessageAt)}</span>
                  </span>
                  <span className="xs dim msg__preview">{conversation.lastMessage}</span>
                </span>
                {conversation.unread && <span className="msg__dot" aria-label="Unread" />}
              </button>
            ))}
          </div>

          {/* ---------------------------------------------- THE THREAD */}
          <div className="msg__thread">
            {!open ? (
              <Card>
                <CardBody className="center">
                  <p className="muted small">Choose a conversation to read it.</p>
                </CardBody>
              </Card>
            ) : (
              <Card>
                <CardBody>
                  <div className="row row--between" style={{ marginBottom: 'var(--space-4)' }}>
                    <div className="row">
                      {/* Back to the list. Only visible on a phone, where the
                          thread covers the list entirely. */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="msg__back"
                        onClick={() => setOpenId(null)}
                      >
                        ←
                      </Button>
                      <Avatar
                        initials={open.other?.avatarInitials ?? '??'}
                        url={open.other?.avatarUrl}
                        name={open.other?.fullName}
                      />
                      <div>
                        <div className="strong small">
                          {open.other?.fullName ?? 'Removed account'}
                        </div>
                        <div className="xs dim">
                          {open.other ? ROLE_LABEL[open.other.role] : ''}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="msg__bubbles">
                    {(thread.data ?? []).map((message) => (
                      <div
                        key={message.id}
                        className={`msg__bubble${message.mine ? ' msg__bubble--mine' : ''}`}
                      >
                        <p className="msg__body">{message.body}</p>
                        <span className="xs dim">{relative(message.createdAt)}</span>
                      </div>
                    ))}
                    <div ref={endOfThread} />
                  </div>

                  <form onSubmit={handleSend} className="msg__compose">
                    <textarea
                      name="body"
                      className="textarea"
                      rows={2}
                      required
                      maxLength={4000}
                      placeholder="Write a message…"
                    />
                    <Button type="submit" variant="primary" disabled={sendMessage.isPending}>
                      {sendMessage.isPending ? 'Sending…' : 'Send'}
                    </Button>
                  </form>
                </CardBody>
              </Card>
            )}
          </div>
        </div>
      </QueryState>

      {/* ------------------------------------------------ NEW MESSAGE */}
      <Modal open={composing} onClose={() => setComposing(false)} title="New message">
        <form onSubmit={handleStart} className="stack" id="new-message-form">
          <div className="field">
            <label className="field__label" htmlFor="person">
              To
            </label>
            <select id="person" name="person" className="select" required>
              <option value="">Choose a person…</option>
              {(directory.data ?? []).map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName} — {ROLE_LABEL[person.role]}
                </option>
              ))}
            </select>
            {(directory.data ?? []).length === 0 && !directory.isLoading && (
              <p className="xs dim" style={{ marginTop: 'var(--space-2)' }}>
                There is nobody for you to message yet. Once an engineer or crew is assigned to your
                installation they will appear here.
              </p>
            )}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="newBody">
              Message
            </label>
            <textarea
              id="newBody"
              name="body"
              className="textarea"
              rows={4}
              required
              maxLength={4000}
            />
          </div>

          <Button type="submit" variant="primary" block disabled={startConversation.isPending}>
            {startConversation.isPending ? 'Sending…' : 'Send'}
          </Button>
        </form>
      </Modal>
    </div>
  )
}
