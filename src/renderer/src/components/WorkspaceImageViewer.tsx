import { useLayoutEffect, useState, type ReactElement } from 'react'

type Translate = (key: string, values?: Record<string, unknown>) => string

const ZOOM_STEPS = [0.1, 0.25, 0.5, 1, 2, 4, 8, 16]

export type ImageViewerZoom = 'fit' | number

export type ImageDimensions = { width: number; height: number }

type Props = {
  t: Translate
  src: string
  alt: string
  zoom: ImageViewerZoom
  onZoomChange: (zoom: ImageViewerZoom) => void
  onDimensions: (dimensions: ImageDimensions | null) => void
  convertedFrom?: string
}

export function nextImageZoom(current: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOM_STEPS.find((step) => step > current + 1e-6) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]
  return [...ZOOM_STEPS].reverse().find((step) => step < current - 1e-6) ?? ZOOM_STEPS[0]
}

/**
 * Checkerboard stage that fits large images and never stretches small ones
 * past 100%; zooming in renders pixels crisp instead of smoothing them.
 */
export function WorkspaceImageViewer({
  t,
  src,
  alt,
  zoom,
  onZoomChange,
  onDimensions,
  convertedFrom
}: Props): ReactElement {
  const [natural, setNatural] = useState<ImageDimensions | null>(null)

  // Before paint, so a data URL that decodes immediately cannot have its size wiped afterwards.
  useLayoutEffect(() => {
    setNatural(null)
  }, [src])

  const scale = zoom === 'fit' ? 1 : zoom
  const style = zoom === 'fit' || !natural
    ? { maxWidth: '100%', maxHeight: '100%' }
    : { width: natural.width * scale, height: natural.height * scale, maxWidth: 'none', maxHeight: 'none' }

  return (
    <div className="ds-file-preview-image-frame">
      <div className="ds-file-preview-image-stage">
        <img
          src={src}
          alt={alt}
          draggable={false}
          className={zoom !== 'fit' && zoom >= 2 ? 'is-pixelated' : undefined}
          style={{ ...style, objectFit: 'contain' }}
          onLoad={(event) => {
            const next = { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }
            setNatural(next)
            onDimensions(next)
          }}
        />
      </div>
      {convertedFrom ? (
        <span className="absolute left-3 top-3 z-[2] rounded-full border border-ds-border bg-ds-card px-2.5 py-0.5 text-[11px] text-ds-muted">
          {t('filePreviewImageConverted', { format: convertedFrom })}
        </span>
      ) : null}
      <div role="group" aria-label={t('filePreviewZoom')} className="ds-file-preview-floating">
        <button type="button" aria-label={t('filePreviewZoomOut')} onClick={() => onZoomChange(nextImageZoom(zoom === 'fit' ? 1 : zoom, -1))}>−</button>
        <span className="is-label" aria-live="polite">{zoom === 'fit' ? t('filePreviewZoomFit') : `${Math.round(zoom * 100)}%`}</span>
        <button type="button" aria-label={t('filePreviewZoomIn')} onClick={() => onZoomChange(nextImageZoom(zoom === 'fit' ? 1 : zoom, 1))}>+</button>
        <button type="button" aria-pressed={zoom === 'fit'} onClick={() => onZoomChange('fit')}>{t('filePreviewZoomFit')}</button>
        <button type="button" aria-pressed={zoom === 1} onClick={() => onZoomChange(1)}>1:1</button>
      </div>
    </div>
  )
}
