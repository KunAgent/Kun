import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RoomPreviewImage } from '@shared/rooms-api'
import './rooms-content.css'

export function RoomImageLightbox({ title, image, onClose }: { title: string; image: RoomPreviewImage; onClose: () => void }) {
  const { t } = useTranslation('common')
  const [url, setUrl] = useState('')
  const panel = useRef<HTMLDivElement>(null), close = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const bytes = Uint8Array.from(atob(image.dataBase64), (value) => value.charCodeAt(0))
    const next = URL.createObjectURL(new Blob([bytes], { type: image.mimeType }))
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [image])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    close.current?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])
  const content = <div className="rooms-lightbox-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div ref={panel} role="dialog" aria-modal="true" aria-label={title} className="rooms-lightbox"
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); onClose() }
        if (event.key !== 'Tab') return
        const controls = panel.current?.querySelectorAll<HTMLElement>('button,a[href]')
        const first = controls?.[0], last = controls?.[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }}>
      <header><span>{title}</span><a href={url} download={title} aria-label={t('roomsDownload')}><Download size={18} /></a>
        <button ref={close} type="button" onClick={onClose} aria-label={t('roomsClose')}><X size={20} /></button></header>
      {url ? <img src={url} alt={title} width={image.width} height={image.height} /> : null}
    </div>
  </div>
  return typeof document !== 'undefined' && document.body?.nodeType === 1 ? createPortal(content, document.body) : content
}
