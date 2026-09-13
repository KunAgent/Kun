import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function RoomModal({ title, onClose, children, busy = false }: { title: string; onClose: () => void; children: ReactNode; busy?: boolean }) {
  const { t } = useTranslation('common')
  const ref = useRef<HTMLDialogElement>(null), close = useRef(onClose); close.current = onClose
  useEffect(() => {
    const focused = document.activeElement as HTMLElement | null
    const dialog = ref.current
    dialog?.showModal()
    return () => { dialog?.close(); if (focused?.isConnected) focused.focus() }
  }, [])
  return createPortal(<dialog ref={ref} className="rooms-init-dialog" aria-label={title}
    onCancel={(event) => {
      event.preventDefault()
      // A disabled control can lose focus during a save. Escape must still
      // dismiss its nested popover before closing the containing modal.
      const panel = Array.from(ref.current?.querySelectorAll<HTMLElement>('.rooms-popover-surface') ?? []).at(-1)
      const anchor = panel && Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button[aria-controls]') ?? [])
        .find((button) => button.getAttribute('aria-controls') === panel.id)
      if (anchor) { anchor.click(); anchor.focus(); return }
      if (!busy) close.current()
    }}>
    <header><h2>{title}</h2><button type="button" className="rooms-icon-button" aria-label={t('roomsClose')} disabled={busy} onClick={onClose}><X size={18} /></button></header>
    {children}
  </dialog>, document.body)
}
