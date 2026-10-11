import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Download, Maximize, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RoomPreviewImage } from '@shared/rooms-api'
import './rooms-content.css'

export function RoomImageLightbox({ title, image, onClose, onPrevious, onNext, navigationBusy = false, error }: {
  title: string; image: RoomPreviewImage; onClose: () => void
  onPrevious?: () => void; onNext?: () => void; navigationBusy?: boolean; error?: string
}) {
  const { t } = useTranslation('common')
  const [url, setUrl] = useState(''), [scale, setScale] = useState<number | null>(null)
  const [size, setSize] = useState({ width: image.width, height: image.height })
  const [area, setArea] = useState({ width: 800, height: 600 })
  const panel = useRef<HTMLDivElement>(null), close = useRef<HTMLButtonElement>(null), viewport = useRef<HTMLDivElement>(null)
  const dragging = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const fit = Math.min(1, Math.max(1, area.width - 24) / Math.max(1, size.width), Math.max(1, area.height - 24) / Math.max(1, size.height))
  const zoom = scale ?? fit
  const changeZoom = (factor: number) => setScale(Math.min(8, Math.max(.05, zoom * factor)))
  useEffect(() => {
    const bytes = Uint8Array.from(atob(image.dataBase64), (value) => value.charCodeAt(0))
    const next = URL.createObjectURL(new Blob([bytes], { type: image.mimeType }))
    setUrl(next); setScale(null); setSize({ width: image.width, height: image.height })
    if (viewport.current) { viewport.current.scrollTop = 0; viewport.current.scrollLeft = 0 }
    return () => URL.revokeObjectURL(next)
  }, [image])
  useEffect(() => {
    const element = viewport.current
    const measure = () => { if (element) setArea({ width: element.clientWidth, height: element.clientHeight }) }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    if (element) observer?.observe(element)
    return () => observer?.disconnect()
  }, [])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    close.current?.focus()
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  const content = <div className="rooms-lightbox-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div ref={panel} role="dialog" aria-modal="true" aria-label={title} className="rooms-lightbox"
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); onClose() }
        if (event.key === 'ArrowLeft' && onPrevious && !navigationBusy) { event.preventDefault(); onPrevious() }
        if (event.key === 'ArrowRight' && onNext && !navigationBusy) { event.preventDefault(); onNext() }
        if (event.key === '+' || event.key === '=') { event.preventDefault(); changeZoom(1.25) }
        if (event.key === '-') { event.preventDefault(); changeZoom(.8) }
        if (event.key === '0') { event.preventDefault(); setScale(null) }
        if (event.key !== 'Tab') return
        const controls = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],[tabindex="0"]')
        const first = controls?.[0], last = controls?.[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }}>
      <header><span title={title}>{title}</span><a href={url} download={title} aria-label={t('roomsDownload')}><Download size={18} /></a>
        <button ref={close} type="button" onClick={onClose} aria-label={t('roomsClose')}><X size={20} /></button></header>
      <div className="rooms-lightbox-controls" role="toolbar" aria-label={t('roomsImageControls')}>
        {onPrevious ? <button type="button" disabled={navigationBusy} onClick={onPrevious} aria-label={t('roomsImagePrevious')}><ChevronLeft size={18} /></button> : null}
        <button type="button" onClick={() => changeZoom(.8)} aria-label={t('roomsImageZoomOut')}><ZoomOut size={18} /></button>
        <output aria-live="polite">{Math.round(zoom * 100)}%</output>
        <button type="button" onClick={() => changeZoom(1.25)} aria-label={t('roomsImageZoomIn')}><ZoomIn size={18} /></button>
        <button type="button" onClick={() => setScale(1)} aria-label={t('roomsImageOriginal')}>1:1</button>
        <button type="button" onClick={() => setScale(null)} aria-label={t('roomsImageFit')}><Maximize size={18} /></button>
        {onNext ? <button type="button" disabled={navigationBusy} onClick={onNext} aria-label={t('roomsImageNext')}><ChevronRight size={18} /></button> : null}
      </div>
      {error ? <p className="rooms-lightbox-error" role="alert">{error}</p> : null}
      <div ref={viewport} className="rooms-lightbox-viewport" tabIndex={0} aria-label={t('roomsImagePan')}
        onPointerDown={(event) => {
          if (event.button !== 0 || !viewport.current) return
          dragging.current = { x: event.clientX, y: event.clientY, left: viewport.current.scrollLeft, top: viewport.current.scrollTop }
          event.currentTarget.setPointerCapture(event.pointerId)
        }} onPointerMove={(event) => {
          if (!dragging.current || !viewport.current) return
          viewport.current.scrollLeft = dragging.current.left - (event.clientX - dragging.current.x)
          viewport.current.scrollTop = dragging.current.top - (event.clientY - dragging.current.y)
        }} onPointerUp={() => { dragging.current = null }} onPointerCancel={() => { dragging.current = null }}>
        <div className="rooms-lightbox-canvas" style={{ width: Math.max(area.width, size.width * zoom), height: Math.max(area.height, size.height * zoom) }}>
          {url ? <img src={url} alt={title} draggable={false} onLoad={(event) => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
            style={{ width: size.width * zoom, height: size.height * zoom }} /> : null}
        </div>
      </div>
    </div>
  </div>
  return typeof document !== 'undefined' && document.body?.nodeType === 1 ? createPortal(content, document.body) : content
}
