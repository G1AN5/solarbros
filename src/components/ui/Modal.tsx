import { useEffect, useRef, type ReactNode } from 'react'

/* ============================================================================
   Modal — built on the native <dialog> element.
   ----------------------------------------------------------------------------
   WHY NOT A LIBRARY
   A dialog needs a focus trap, focus restoration on close, Escape to dismiss,
   `aria-modal`, and inertness for the rest of the page. Getting those right by
   hand is genuinely hard, and the popular libraries that do get them right cost
   30-50 KB.

   `showModal()` provides every one of them in the browser, for nothing. That
   matters here beyond tidiness: the field portal is used on mobile data from a
   roof, and this project has a standing rule that weight has to justify itself.

   TWO THINGS THE ELEMENT DOES NOT DO ON ITS OWN
   Closing on a backdrop click, and staying in step with React state when the
   user dismisses it with Escape. Both are handled below.
   ========================================================================== */

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  /** Rendered in the footer, right-aligned. Usually the confirm button. */
  footer?: ReactNode
  children: ReactNode
}

export function Modal({ open, onClose, title, footer, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return

    // showModal() throws if the dialog is already open, which React's strict
    // double-invoke in development makes easy to hit.
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return

    // Escape closes the element directly, without going through React. Without
    // this listener the parent still believes the modal is open, and the next
    // attempt to open it does nothing.
    const handleClose = () => onClose()
    dialog.addEventListener('close', handleClose)
    return () => dialog.removeEventListener('close', handleClose)
  }, [onClose])

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-label={title}
      onClick={(event) => {
        // The backdrop is part of the dialog element, so a click that landed on
        // the element itself rather than on its content came from outside the
        // visible box.
        if (event.target === ref.current) onClose()
      }}
    >
      <div className="modal__body">
        <div className="modal__head">
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal__content">{children}</div>

        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </dialog>
  )
}
