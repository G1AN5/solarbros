/* ============================================================================
   FormError — the one treatment for "your submission did not go through".
   ----------------------------------------------------------------------------
   Separate from QueryState, which handles a failed READ. A failed WRITE is a
   different problem for the person in front of the screen: they have just typed
   something, and the worst outcome is a form that clears itself and leaves them
   unsure whether it sent.

   So this never touches the form. It appears above the button, every field
   stays filled, and the visitor can correct one thing and try again.

   IT TRUSTS THE MESSAGE IT IS GIVEN, WHICH IS A DECISION MADE UPSTREAM
   The message is rendered as-is, because the query layer has already decided
   what is safe to show — validation text written for a customer passes through,
   and anything else has been replaced with a plain sentence. Filtering here as
   well would mean two places deciding the same thing, and eventually
   disagreeing. See `asReadableError` in lib/queries/public-forms.ts.
   ========================================================================== */

interface FormErrorProps {
  error: Error | null
  /** Replaces the message entirely when a page has better context. */
  message?: string
}

export function FormError({ error, message }: FormErrorProps) {
  if (!error) return null

  return (
    <div
      role="alert"
      style={{
        padding: 'var(--space-4)',
        background: 'var(--danger-bg)',
        color: 'var(--danger-fg)',
        borderRadius: 'var(--radius)',
      }}
    >
      <strong className="small">We could not send that</strong>
      <p className="small" style={{ marginTop: 'var(--space-1)' }}>
        {message ?? error.message}
      </p>
      <p className="xs" style={{ marginTop: 'var(--space-2)', opacity: 0.85 }}>
        Your details are still here — nothing was lost.
      </p>
    </div>
  )
}
