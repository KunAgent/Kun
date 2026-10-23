import { memo, useEffect, useRef, useState, type ReactElement } from 'react'
import { ChevronLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import {
  useCanvasInspectorStore,
  type CanvasBoardFocusFit
} from '../../../design/canvas/canvas-inspector-store'
import { isHtmlFrame } from '../../../design/canvas/canvas-types'
import { embeddedArtifactFile } from '../../../design/canvas/embedded-artifact-file'
import { useDesignWorkspaceStore } from '../../../design/design-workspace-store'
import { useDesignHtmlPreview } from '../DesignHtmlPreviewHost'
import { BoardDownloadMenu } from './chrome/BoardDownloadMenu'
import { canvasChromeButtonClass } from './chrome/canvas-chrome-primitives'

const FOCUS_GUTTER = 32
const MIN_SCALE = 0.05
const MAX_SCALE = 3

/**
 * Scale of a board inside the focus view: `fit` shows the whole board, `fill`
 * matches the available width and scrolls vertically.
 */
export function canvasBoardFocusScale(
  fit: CanvasBoardFocusFit,
  available: { width: number; height: number },
  board: { width: number; height: number }
): number {
  const width = Math.max(1, available.width - FOCUS_GUTTER * 2)
  const height = Math.max(1, available.height - FOCUS_GUTTER * 2)
  const boardWidth = Math.max(1, board.width)
  const boardHeight = Math.max(1, board.height)
  const raw = fit === 'fill' ? width / boardWidth : Math.min(width / boardWidth, height / boardHeight)
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, raw))
}

function CanvasBoardFocusViewInner({ workspaceRoot }: { workspaceRoot: string }): ReactElement | null {
  const { t } = useTranslation('common')
  const focusedShapeId = useCanvasInspectorStore((s) => s.focusedShapeId)
  const focusBoard = useCanvasInspectorStore((s) => s.focusBoard)
  const fit = useCanvasInspectorStore((s) => s.focusFit)
  const setFit = useCanvasInspectorStore((s) => s.setFocusFit)
  const shape = useCanvasShapeStore((s) => (focusedShapeId ? s.document.objects[focusedShapeId] : undefined))
  const artifacts = useDesignWorkspaceStore((s) => s.artifacts)
  const file = shape && isHtmlFrame(shape) ? embeddedArtifactFile(shape, artifacts) : null
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [available, setAvailable] = useState({ width: 0, height: 0 })
  const preview = useDesignHtmlPreview({
    workspaceRoot,
    relativePath: file?.path ?? '',
    enabled: Boolean(file && workspaceRoot),
    partition: 'kun-proto'
  })

  useEffect(() => {
    if (focusedShapeId && !file) focusBoard(null)
  }, [file, focusBoard, focusedShapeId])

  useEffect(() => {
    if (!focusedShapeId) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') focusBoard(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [focusBoard, focusedShapeId])

  useEffect(() => {
    const host = hostRef.current
    if (!host || typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect) setAvailable({ width: rect.width, height: rect.height })
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [focusedShapeId])

  if (!focusedShapeId || !shape || !file) return null

  const board = { width: Math.max(1, shape.width), height: Math.max(1, shape.height) }
  const scale = canvasBoardFocusScale(fit, available, board)
  const title = file.artifact.title || shape.name
  const fitOptions: { id: CanvasBoardFocusFit; labelKey: string }[] = [
    { id: 'fill', labelKey: 'canvasFocusFill' },
    { id: 'fit', labelKey: 'canvasFocusFit' }
  ]

  return (
    <div
      className="ds-no-drag absolute inset-0 z-[60] flex flex-col bg-[#ecebe8] dark:bg-[#0e0f12]"
      role="dialog"
      aria-label={title}
      data-canvas-board-focus={shape.id}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-ds-border bg-ds-elevated px-2.5">
        <button
          type="button"
          className={canvasChromeButtonClass(false)}
          onClick={() => focusBoard(null)}
          title={t('canvasFocusBack')}
          aria-label={t('canvasFocusBack')}
          data-canvas-focus-back="true"
        >
          <ChevronLeft className="h-[18px] w-[18px]" strokeWidth={1.9} />
        </button>
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ds-ink">{title}</h2>
        <BoardDownloadMenu
          artifact={file.artifact}
          workspaceRoot={workspaceRoot}
          buttonClassName={canvasChromeButtonClass(false)}
          iconClassName="h-4 w-4"
        />
        <div role="radiogroup" aria-label={t('canvasFocusScale')} className="flex items-center rounded-[10px] bg-ds-hover p-0.5">
          {fitOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={fit === option.id}
              onClick={() => setFit(option.id)}
              data-canvas-focus-fit={option.id}
              className={`h-7 rounded-[8px] px-3 text-[13px] transition ${
                fit === option.id
                  ? 'bg-ds-elevated font-medium text-ds-ink shadow-[0_1px_2px_rgba(15,23,42,0.12)]'
                  : 'text-ds-muted hover:text-ds-ink'
              }`}
            >
              {t(option.labelKey)}
            </button>
          ))}
        </div>
      </div>
      <div ref={hostRef} className="min-h-0 flex-1 overflow-auto">
        <div
          className="flex min-h-full min-w-full items-center justify-center"
          style={{ padding: FOCUS_GUTTER }}
        >
          <div className="relative shrink-0" style={{ width: board.width * scale, height: board.height * scale }}>
            <div
              className="absolute left-0 top-0 overflow-hidden rounded-[10px] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.06),0_18px_48px_rgba(15,23,42,0.12)] ring-1 ring-black/[0.06] dark:bg-[#101214] dark:ring-white/10"
              style={{ width: board.width, height: board.height, transform: `scale(${scale})`, transformOrigin: 'top left' }}
            >
              {preview.state.webviewUrl ? (
                preview.renderWebview({ className: 'h-full w-full border-0' })
              ) : (
                <div className="flex h-full items-center justify-center text-[13px] text-ds-faint">
                  {preview.state.error || t('designCanvasLoading')}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export const CanvasBoardFocusView = memo(CanvasBoardFocusViewInner)
