import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement
} from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, Download, Minus, Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { copyImageToClipboard } from '../../lib/copy-image-to-clipboard'

type ImagePreviewLightboxProps = {
  open: boolean
  src: string
  alt: string
  title?: string
  downloadHref?: string
  downloadName?: string
  downloadDisabled?: boolean
  downloadLabel?: string
  onDownload?: () => void | Promise<void>
  copyPath?: string
  copyWorkspaceRoot?: string
  copyDataUrl?: string
  onCopy?: () => void | Promise<void>
  onClose: () => void
}

const MIN_ZOOM = 0.25
const MAX_ZOOM = 3
const ZOOM_STEP = 0.25
const PREVIEW_PADDING = 16
const COPY_RESET_MS = 1400

const lightboxIconButtonClass =
  'inline-flex h-11 w-11 items-center justify-center rounded-full bg-white text-zinc-700 shadow-[0_14px_34px_rgba(0,0,0,0.22)] transition hover:bg-zinc-50 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-800'

type CopyState = 'idle' | 'copying' | 'copied' | 'failed'

type ImagePreviewSize = {
  width: number
  height: number
}

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
}

export function imagePreviewDisplaySize(
  naturalSize: ImagePreviewSize,
  viewportSize: ImagePreviewSize,
  zoom: number
): ImagePreviewSize {
  const boundedZoom = clampZoom(zoom)
  const availableWidth = Math.max(1, viewportSize.width - PREVIEW_PADDING)
  const availableHeight = Math.max(1, viewportSize.height - PREVIEW_PADDING)
  const fitScale = Math.min(
    1,
    availableWidth / Math.max(1, naturalSize.width),
    availableHeight / Math.max(1, naturalSize.height)
  )

  return {
    width: naturalSize.width * fitScale * boundedZoom,
    height: naturalSize.height * fitScale * boundedZoom
  }
}

export function imagePreviewStageStyle(imageSize: ImagePreviewSize | null): CSSProperties {
  return {
    minWidth: '100%',
    minHeight: '100%',
    ...(imageSize ? {
      width: `${imageSize.width + PREVIEW_PADDING}px`,
      height: `${imageSize.height + PREVIEW_PADDING}px`
    } : {})
  }
}

export function ImagePreviewLightbox({
  open,
  src,
  alt,
  title,
  downloadHref,
  downloadName,
  downloadDisabled = false,
  downloadLabel,
  onDownload,
  copyPath,
  copyWorkspaceRoot,
  copyDataUrl,
  onCopy,
  onClose
}: ImagePreviewLightboxProps): ReactElement | null {
  const { t } = useTranslation('common')
  const [zoom, setZoom] = useState(1)
  const [copyState, setCopyState] = useState<CopyState>('idle')
  const [naturalSize, setNaturalSize] = useState<ImagePreviewSize | null>(null)
  const [viewportSize, setViewportSize] = useState<ImagePreviewSize | null>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const copyResetRef = useRef<number | null>(null)
  const copyHandlerRef = useRef<() => Promise<void>>(async () => undefined)
  const titleId = useId()
  const closeLabel = t('imagePreviewClose')
  const resolvedTitle = title || alt || t('imagePreviewTitle')
  const resolvedDownloadLabel = downloadLabel ?? t('imagePreviewDownload')
  const canCopy = typeof onCopy === 'function' || Boolean(copyPath?.trim() || copyDataUrl?.trim())
  const copyLabel =
    copyState === 'copied'
      ? t('copySuccess')
      : copyState === 'failed'
        ? t('copyFailed')
        : t('imagePreviewCopy')

  const handleCopy = async (): Promise<void> => {
    if (!canCopy || copyState === 'copying') return
    setCopyState('copying')
    try {
      if (onCopy) {
        await onCopy()
        setCopyState('copied')
      } else {
        const result = await copyImageToClipboard({
          ...(copyPath?.trim() ? { path: copyPath.trim() } : {}),
          ...(copyWorkspaceRoot?.trim() ? { workspaceRoot: copyWorkspaceRoot.trim() } : {}),
          ...(copyDataUrl?.trim() ? { dataUrl: copyDataUrl.trim() } : {})
        })
        setCopyState(result.ok ? 'copied' : 'failed')
      }
    } catch {
      setCopyState('failed')
    }
    if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current)
    copyResetRef.current = window.setTimeout(() => {
      setCopyState('idle')
    }, COPY_RESET_MS)
  }
  copyHandlerRef.current = handleCopy

  useEffect(() => {
    if (!open || typeof window === 'undefined') return
    setZoom(1)
    setCopyState('idle')
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') {
        event.preventDefault()
        void copyHandlerRef.current()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
      if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current)
    }
  }, [open, onClose])

  useEffect(() => {
    setNaturalSize(null)
  }, [src])

  useLayoutEffect(() => {
    if (!open) return
    const frame = frameRef.current
    if (!frame) return

    const updateViewportSize = (): void => {
      const nextSize = { width: frame.clientWidth, height: frame.clientHeight }
      setViewportSize((current) =>
        current?.width === nextSize.width && current.height === nextSize.height
          ? current
          : nextSize
      )
    }
    updateViewportSize()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateViewportSize)
      return () => window.removeEventListener('resize', updateViewportSize)
    }

    const resizeObserver = new ResizeObserver(updateViewportSize)
    resizeObserver.observe(frame)
    return () => resizeObserver.disconnect()
  }, [open])

  const zoomPercent = `${Math.round(zoom * 100)}%`
  const canDownload = !downloadDisabled && (typeof onDownload === 'function' || Boolean(downloadHref))
  const imageSize = naturalSize && viewportSize
    ? imagePreviewDisplaySize(naturalSize, viewportSize, zoom)
    : null
  const stageStyle = imagePreviewStageStyle(imageSize)
  const imageStyle: CSSProperties | undefined = imageSize ? {
    width: `${imageSize.width}px`,
    height: `${imageSize.height}px`
  } : undefined
  const imageWidth = imageSize?.width ?? 0
  const imageHeight = imageSize?.height ?? 0
  const viewportWidth = viewportSize?.width ?? 0
  const viewportHeight = viewportSize?.height ?? 0

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || imageWidth <= 0 || imageHeight <= 0) return
    viewport.scrollLeft = Math.max(0, (viewport.scrollWidth - viewport.clientWidth) / 2)
    viewport.scrollTop = Math.max(0, (viewport.scrollHeight - viewport.clientHeight) / 2)
  }, [imageHeight, imageWidth, viewportHeight, viewportWidth])

  if (!open || typeof document === 'undefined') return null

  const downloadControl = onDownload ? (
    <button
      type="button"
      onClick={() => void onDownload()}
      disabled={!canDownload}
      aria-label={resolvedDownloadLabel}
      title={resolvedDownloadLabel}
      className={lightboxIconButtonClass}
    >
      <Download className="h-5 w-5" strokeWidth={1.9} />
    </button>
  ) : downloadHref ? (
    <a
      href={downloadHref}
      download={downloadName || resolvedTitle}
      aria-label={resolvedDownloadLabel}
      title={resolvedDownloadLabel}
      className={lightboxIconButtonClass}
    >
      <Download className="h-5 w-5" strokeWidth={1.9} />
    </a>
  ) : null
  const copyControl = canCopy ? (
    <button
      type="button"
      onClick={() => void handleCopy()}
      disabled={copyState === 'copying'}
      aria-label={copyLabel}
      title={copyLabel}
      className={lightboxIconButtonClass}
    >
      {copyState === 'copied' ? (
        <Check className="h-5 w-5" strokeWidth={2} />
      ) : (
        <Copy className="h-5 w-5" strokeWidth={1.9} />
      )}
    </button>
  ) : null

  return createPortal(
    <div
      className="ds-no-drag fixed inset-0 z-[1100] bg-zinc-950/82 text-white backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <h2 id={titleId} className="sr-only">
        {resolvedTitle}
      </h2>
      <div className="absolute right-3 top-3 z-10 flex items-center gap-2 sm:right-4 sm:top-4">
        {copyControl}
        {downloadControl}
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          title={closeLabel}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white text-zinc-700 shadow-[0_14px_34px_rgba(0,0,0,0.22)] transition hover:bg-zinc-50 hover:text-zinc-950 dark:bg-zinc-100 dark:text-zinc-800"
        >
          <X className="h-5 w-5" strokeWidth={2} />
        </button>
      </div>
      <div className="flex h-full w-full items-center justify-center px-4 py-20 sm:px-8">
        <div
          ref={frameRef}
          className="h-full w-full max-w-[min(1120px,calc(100vw-32px))] overflow-hidden rounded-[18px] border border-white/16 bg-[rgba(255,250,242,0.96)] shadow-[0_30px_90px_rgba(0,0,0,0.42)] dark:bg-zinc-950/88"
        >
          <div ref={viewportRef} className="h-full w-full overflow-auto">
            <div className="flex items-center justify-center p-2" style={stageStyle}>
              <img
                src={src}
                alt={alt}
                className={`${imageSize ? 'max-w-none' : 'h-auto w-auto max-h-full max-w-full'} block shrink-0 select-none object-contain`}
                style={imageStyle}
                draggable={false}
                onLoad={(event) => {
                  const image = event.currentTarget
                  setNaturalSize({ width: image.naturalWidth, height: image.naturalHeight })
                }}
              />
            </div>
          </div>
        </div>
      </div>
      <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center overflow-hidden rounded-full bg-white text-zinc-700 shadow-[0_14px_34px_rgba(0,0,0,0.24)] dark:bg-zinc-100 dark:text-zinc-800">
        <button
          type="button"
          onClick={() => setZoom((value) => clampZoom(value - ZOOM_STEP))}
          disabled={zoom <= MIN_ZOOM}
          aria-label={t('imagePreviewZoomOut')}
          title={t('imagePreviewZoomOut')}
          className="inline-flex h-10 w-11 items-center justify-center transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Minus className="h-4 w-4" strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={() => setZoom(1)}
          aria-label={t('imagePreviewResetZoom')}
          title={t('imagePreviewResetZoom')}
          className="h-10 min-w-16 px-3 text-[13px] font-semibold transition hover:bg-zinc-100"
        >
          {zoomPercent}
        </button>
        <button
          type="button"
          onClick={() => setZoom((value) => clampZoom(value + ZOOM_STEP))}
          disabled={zoom >= MAX_ZOOM}
          aria-label={t('imagePreviewZoomIn')}
          title={t('imagePreviewZoomIn')}
          className="inline-flex h-10 w-11 items-center justify-center transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Plus className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>
    </div>,
    document.body
  )
}
