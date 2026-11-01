import { useState } from 'react'
import { Maximize2, Play, SlidersHorizontal, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DesignArtifact } from '../../../../design/design-types'
import { useCanvasSelectionStore } from '../../../../design/canvas/canvas-selection-store'
import {
  openCanvasInspectorTab,
  useCanvasInspectorStore
} from '../../../../design/canvas/canvas-inspector-store'
import { BoardDownloadMenu } from '../chrome/BoardDownloadMenu'

/** Height of the label row above a board, in screen pixels. */
export function htmlFrameChromeOffset(screenWidth: number): number {
  return screenWidth > 160 ? 30 : 22
}

export type HtmlFrameChromeActionLevel = 'full' | 'basic' | 'expand' | 'none'

/**
 * How many board actions fit beside the name: the name keeps priority, so
 * narrow boards drop download first, then tweaks, and a tiny board shows
 * only expand while it is selected.
 */
export function htmlFrameChromeActionLevel(options: { screenWidth: number; active: boolean }): HtmlFrameChromeActionLevel {
  if (options.screenWidth >= 260) return 'full'
  if (options.screenWidth >= 150) return 'basic'
  return options.active && options.screenWidth >= 100 ? 'expand' : 'none'
}

type HtmlFrameChromeProps = {
  active: boolean
  artifact?: DesignArtifact
  chromeOffset: number
  drawingActive: boolean
  failedMessage: string
  interactive: boolean
  previewWebviewUrl: string
  screenWidth: number
  shapeId: string
  shapeName: string
  workspaceRoot: string
  onToggleInteractive?: (shapeId: string) => void
  readOnly?: boolean
  /** Outer-to-inner path of the hovered or selected element. */
  crumbs?: { id: number; label: string; current: boolean }[]
  onSelectCrumb?: (id: number) => void
}

const actionButton =
  'pointer-events-auto inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink'

export function HtmlFrameChrome({
  active,
  artifact,
  chromeOffset,
  drawingActive,
  failedMessage,
  interactive,
  previewWebviewUrl,
  screenWidth,
  shapeId,
  shapeName,
  workspaceRoot,
  readOnly,
  crumbs = [],
  onSelectCrumb,
  onToggleInteractive
}: HtmlFrameChromeProps): React.JSX.Element {
  const { t } = useTranslation('common')
  const ready = Boolean(previewWebviewUrl) && !drawingActive && !failedMessage
  const [hovered, setHovered] = useState(false)
  // Icons stay out of the way until the board is hovered or selected; the name
  // strip is otherwise just the name.
  const actionsVisible = hovered || active
  const statusDot = drawingActive ? 'generating' : failedMessage ? 'failed' : null
  const level = interactive ? 'none' : htmlFrameChromeActionLevel({ screenWidth, active })
  const showActions = level !== 'none' || interactive
  const showCrumbs = crumbs.length > 0 && screenWidth > 360 && !interactive
  const selectBoard = (): void => useCanvasSelectionStore.getState().select([shapeId])
  const expandBoard = (): void => {
    selectBoard()
    useCanvasInspectorStore.getState().focusBoard(shapeId)
  }
  const stop = (event: React.SyntheticEvent): void => event.stopPropagation()
  return (
    <div
      className="pointer-events-none absolute left-0 right-0 z-20 flex items-center justify-between gap-1.5"
      style={{
        top: -chromeOffset,
        height: chromeOffset - 4,
        fontSize: screenWidth > 220 ? 12.5 : 11
      }}
    >
      {statusDot ? (
        <span
          aria-hidden="true"
          data-canvas-board-status={statusDot}
          className={`pointer-events-none h-1.5 w-1.5 shrink-0 rounded-full ${
            statusDot === 'generating' ? 'animate-pulse bg-[#6a4df4]' : 'bg-[#c2410c]'
          }`}
        />
      ) : null}
      <button
        type="button"
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        className={`pointer-events-auto min-w-0 truncate rounded-[4px] text-left leading-none transition-colors ${
          showCrumbs ? 'max-w-[40%] shrink-0' : 'flex-1'
        } ${
          active ? 'font-semibold text-accent' : 'font-medium text-ds-muted hover:text-ds-ink'
        }`}
        onPointerDown={stop}
        onClick={(event) => {
          stop(event)
          selectBoard()
        }}
        onDoubleClick={(event) => {
          stop(event)
          if (ready) expandBoard()
        }}
        title={shapeName}
        data-canvas-board-label={shapeId}
      >
        {shapeName}
      </button>
      {showCrumbs ? (
        <nav
          aria-label={shapeName}
          className="pointer-events-auto flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden whitespace-nowrap text-[11px] leading-none"
          data-canvas-pick-breadcrumb="true"
        >
          {crumbs.map((crumb) => (
            <span key={crumb.id} className="flex min-w-0 items-center gap-0.5">
              <span aria-hidden="true" className="text-ds-faint">›</span>
              <button
                type="button"
                onPointerDown={stop}
                onClick={(event) => { stop(event); onSelectCrumb?.(crumb.id) }}
                aria-current={crumb.current ? 'true' : undefined}
                className={`min-w-0 truncate rounded-[4px] px-0.5 transition-colors ${
                  crumb.current ? 'font-semibold text-accent' : 'text-ds-muted hover:text-ds-ink'
                }`}
              >
                {crumb.label}
              </button>
            </span>
          ))}
        </nav>
      ) : null}
      {showActions ? (
        <div
          className={`pointer-events-auto flex h-full shrink-0 items-center gap-0.5 transition-opacity ${
            actionsVisible ? 'opacity-100' : 'opacity-0 [&_*]:!pointer-events-none'
          }`}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          onDoubleClick={stop}
        >
          {ready && !readOnly && (interactive || active) ? (
            <button
              type="button"
              onPointerDown={stop}
              onClick={(event) => {
                stop(event)
                selectBoard()
                onToggleInteractive?.(shapeId)
              }}
              title={t(interactive ? 'canvasBoardPreviewExit' : 'canvasBoardPreview')}
              aria-label={t(interactive ? 'canvasBoardPreviewExit' : 'canvasBoardPreview')}
              aria-pressed={interactive}
              className={`${actionButton} ${interactive ? 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent' : ''}`}
              data-canvas-board-preview={shapeId}
            >
              {interactive ? (
                <Square className="h-3 w-3" strokeWidth={2.2} />
              ) : (
                <Play className="h-3.5 w-3.5" strokeWidth={1.9} />
              )}
            </button>
          ) : null}
          {readOnly || level === 'expand' || level === 'none' ? null : (
            <button
              type="button"
              onPointerDown={stop}
              onClick={(event) => {
                stop(event)
                selectBoard()
                openCanvasInspectorTab('tweaks')
              }}
              title={t('canvasBoardTweaks')}
              aria-label={t('canvasBoardTweaks')}
              className={actionButton}
              data-canvas-board-tweaks={shapeId}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.9} />
            </button>
          )}
          {ready ? (
            <button
              type="button"
              onPointerDown={stop}
              onClick={(event) => {
                stop(event)
                expandBoard()
              }}
              title={t('canvasBoardExpand')}
              aria-label={t('canvasBoardExpand')}
              className={actionButton}
              data-canvas-board-expand={shapeId}
            >
              <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.9} />
            </button>
          ) : null}
          {ready && artifact && level === 'full' ? (
            <BoardDownloadMenu artifact={artifact} workspaceRoot={workspaceRoot} buttonClassName={actionButton} />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
