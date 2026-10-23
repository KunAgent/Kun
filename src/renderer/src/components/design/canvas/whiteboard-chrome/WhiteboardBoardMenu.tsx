import { useCallback, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Copy, Download, FolderOpen, Lock, Shapes } from 'lucide-react'
import type { CanvasEngine } from '../../../../whiteboard/canvas-engine'
import {
  CANVAS_CHROME_MENU,
  CANVAS_CHROME_MENU_SECTION,
  CANVAS_CHROME_MENU_SEPARATOR,
  CanvasChromeMenuItem,
  useCanvasChromeDismiss
} from '../chrome/canvas-chrome-primitives'

export type WhiteboardBoardAction = 'export-png' | 'export-svg' | 'copy-image' | 'reveal'

/**
 * The board title button and its menu: engine choice (locked once the board
 * has content) plus the export actions the live engine supports.
 */
export function WhiteboardBoardMenu({
  title,
  engine,
  canSwitchEngine,
  onEngineChange,
  actions,
  onAction
}: {
  title: string
  engine: CanvasEngine
  canSwitchEngine: boolean
  onEngineChange: (engine: CanvasEngine) => void
  /** Actions the current engine can run right now; the rest are hidden. */
  actions: readonly WhiteboardBoardAction[]
  onAction: (action: WhiteboardBoardAction) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  useCanvasChromeDismiss(open, rootRef, close)
  const engineLabel = engine === 'excalidraw' ? t('canvasEngineExcalidraw') : t('canvasEngineKun')
  const run = (action: WhiteboardBoardAction): void => {
    setOpen(false)
    onAction(action)
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('whiteboardBoardMenu')}
        title={t('whiteboardBoardMenu')}
        data-whiteboard-board-menu-trigger="true"
        className={`flex h-8 min-w-0 max-w-full items-center gap-2 rounded-[9px] pl-1 pr-2 transition-colors hover:bg-ds-hover ${
          open ? 'bg-ds-hover' : ''
        }`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] bg-accent-tint/15 text-accent">
          <Shapes className="h-3.5 w-3.5" strokeWidth={1.9} />
        </span>
        <span className="min-w-0 truncate text-[13px] font-semibold text-ds-ink">{title}</span>
        <span className="shrink-0 rounded-full bg-ds-hover px-2 py-0.5 text-[10.5px] text-ds-muted">{engineLabel}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-ds-faint transition-transform ${open ? 'rotate-180' : ''}`}
          strokeWidth={2}
        />
      </button>
      {open ? (
        <div role="menu" className={`${CANVAS_CHROME_MENU} left-0 top-[calc(100%+6px)] w-64`}>
          <div className={CANVAS_CHROME_MENU_SECTION}>{t('whiteboardEngineSection')}</div>
          <div className="px-1 pb-1">
            <div
              className="flex gap-0.5 rounded-[9px] bg-ds-hover p-0.5"
              role="radiogroup"
              aria-label={t('whiteboardEngineSection')}
              data-canvas-engine-switcher="true"
            >
              {(['kun', 'excalidraw'] as const).map((value) => {
                const active = engine === value
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={!active && !canSwitchEngine}
                    data-canvas-engine-option={value}
                    className={`h-7 flex-1 rounded-[7px] text-[12px] transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      active ? 'bg-ds-elevated font-medium text-ds-ink shadow-sm' : 'text-ds-muted hover:text-ds-ink'
                    }`}
                    onClick={() => {
                      if (active || !canSwitchEngine) return
                      setOpen(false)
                      onEngineChange(value)
                    }}
                  >
                    {value === 'kun' ? t('canvasEngineKun') : t('canvasEngineExcalidraw')}
                  </button>
                )
              })}
            </div>
            {!canSwitchEngine ? (
              <div className="mt-1.5 flex items-center gap-1.5 px-1 text-[11px] text-ds-faint">
                <Lock className="h-3 w-3 shrink-0" strokeWidth={2} />
                {t('canvasEngineSwitchLocked')}
              </div>
            ) : null}
          </div>
          {actions.length > 0 ? <div className={CANVAS_CHROME_MENU_SEPARATOR} /> : null}
          {actions.includes('export-png') ? (
            <CanvasChromeMenuItem
              icon={<Download className="h-4 w-4" strokeWidth={1.8} />}
              label={t('whiteboardExportPng')}
              onSelect={() => run('export-png')}
            />
          ) : null}
          {actions.includes('export-svg') ? (
            <CanvasChromeMenuItem
              icon={<Download className="h-4 w-4" strokeWidth={1.8} />}
              label={t('whiteboardExportSvg')}
              onSelect={() => run('export-svg')}
            />
          ) : null}
          {actions.includes('copy-image') ? (
            <CanvasChromeMenuItem
              icon={<Copy className="h-4 w-4" strokeWidth={1.8} />}
              label={t('whiteboardCopyImage')}
              onSelect={() => run('copy-image')}
            />
          ) : null}
          {actions.includes('reveal') ? (
            <CanvasChromeMenuItem
              icon={<FolderOpen className="h-4 w-4" strokeWidth={1.8} />}
              label={t('whiteboardRevealFile')}
              onSelect={() => run('reveal')}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
