import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './mobile-sheet.css'

type MobileSheetProps = {
  open: boolean
  title: string
  closeLabel: string
  onClose: () => void
  children: ReactNode
}

/** The native modal owns focus containment and makes the underlying page inert. */
export function MobileSheet({ open, title, closeLabel, onClose, children }: MobileSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    if (!dialog) return
    const previousFocus = document.activeElement
    const onNativeClose = (): void => closeRef.current()
    dialog.addEventListener('close', onNativeClose)
    dialog.showModal()
    return () => {
      dialog.removeEventListener('close', onNativeClose)
      dialog.close()
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true })
      }
    }
  }, [open])

  if (!open) return null
  return createPortal(
    <dialog
      ref={dialogRef}
      className="kun-mobile-sheet"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        closeRef.current()
      }}
    >
      <header className="kun-mobile-sheet-header">
        <h2 id={titleId}>{title}</h2>
        <button type="button" onClick={onClose}>{closeLabel}</button>
      </header>
      <div className="kun-mobile-sheet-content">{children}</div>
    </dialog>,
    document.body
  )
}
