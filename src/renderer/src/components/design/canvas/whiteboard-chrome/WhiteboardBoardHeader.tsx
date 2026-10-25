import { useCallback, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Maximize, Maximize2, Minimize, Minimize2, PanelRight } from 'lucide-react'
import {
  CANVAS_CHROME_KBD,
  CANVAS_CHROME_MENU,
  CANVAS_CHROME_MENU_SECTION,
  useCanvasChromeDismiss
} from '../chrome/canvas-chrome-primitives'

/** Where the Code whiteboard is shown: the right rail, the whole stage, or the whole window. */
export type WhiteboardViewMode = 'docked' | 'focused' | 'fullscreen'

const HEADER_BUTTON =
  'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[9px] px-2 text-[12.5px] text-ds-muted transition-colors hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-tint/40'

function ViewModeItem({
  icon,
  label,
  hint,
  checked,
  onSelect
}: {
  icon: ReactNode
  label: string
  hint: string
  checked: boolean
  onSelect: () => void
}): ReactElement {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      className={`flex w-full items-start gap-2.5 rounded-[9px] px-2.5 py-2 text-left transition hover:bg-ds-hover ${
        checked ? 'bg-ds-hover' : ''
      }`}
      onClick={onSelect}
    >
      <span className={`mt-px flex h-4 w-4 shrink-0 items-center justify-center ${checked ? 'text-accent' : 'text-ds-muted'}`}>
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[12.5px] font-medium text-ds-ink">{label}</span>
        <span className="text-[11.5px] leading-4 text-ds-muted">{hint}</span>
      </span>
      {checked ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2.2} /> : null}
    </button>
  )
}

/**
 * The Code whiteboard's own header row. It holds the board menu on the left
 * and the view switch on the right, so the canvas below keeps a clear top
 * band for its tool bar at every panel width.
 */
export function WhiteboardBoardHeader({
  boardMenu,
  view,
  onViewChange,
  notice
}: {
  boardMenu: ReactNode
  view: WhiteboardViewMode
  onViewChange: (view: WhiteboardViewMode) => void
  /** Short-lived status text (copied, export failed). */
  notice?: string | null
}): ReactElement {
  const { t } = useTranslation('common')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  useCanvasChromeDismiss(open, rootRef, close)
  const choose = (next: WhiteboardViewMode): void => {
    setOpen(false)
    if (next !== view) onViewChange(next)
  }
  const exitLabel = view === 'fullscreen' ? t('whiteboardExitFullscreen') : t('whiteboardExitFill')

  return (
    <div
      className="relative z-50 flex h-12 shrink-0 items-center justify-between gap-2 border-b border-ds-border-muted bg-ds-elevated px-2.5"
      data-whiteboard-header="true"
      data-whiteboard-view={view}
    >
      <div className="flex min-w-0 flex-1 items-center">{boardMenu}</div>
      <div className="flex shrink-0 items-center gap-1">
        {notice ? (
          <span role="status" className="mr-1 max-w-48 truncate text-[11.5px] text-ds-muted">{notice}</span>
        ) : null}
        {view !== 'docked' ? (
          <button
            type="button"
            className={`${HEADER_BUTTON} bg-ds-hover text-ds-ink`}
            data-whiteboard-exit-view="true"
            onClick={() => onViewChange('docked')}
          >
            {view === 'fullscreen'
              ? <Minimize className="h-3.5 w-3.5" strokeWidth={1.9} />
              : <Minimize2 className="h-3.5 w-3.5" strokeWidth={1.9} />}
            <span>{exitLabel}</span>
            <kbd className={`${CANVAS_CHROME_KBD} pl-1`}>Esc</kbd>
          </button>
        ) : null}
        <div ref={rootRef} className="relative">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={t('whiteboardViewMenu')}
            title={t('whiteboardViewMenu')}
            data-whiteboard-view-menu-trigger="true"
            className={`${HEADER_BUTTON} gap-0.5 px-1.5 ${open ? 'bg-accent-tint/15 text-accent' : ''}`}
            onClick={() => setOpen((value) => !value)}
          >
            <Maximize2 className="h-4 w-4" strokeWidth={1.85} />
            <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} strokeWidth={2.2} />
          </button>
          {open ? (
            <div role="menu" className={`${CANVAS_CHROME_MENU} right-0 top-[calc(100%+6px)] w-72`}>
              <div className={CANVAS_CHROME_MENU_SECTION}>{t('whiteboardViewMenu')}</div>
              <ViewModeItem
                icon={<PanelRight className="h-4 w-4" strokeWidth={1.8} />}
                label={t('whiteboardViewDocked')}
                hint={t('whiteboardViewDockedHint')}
                checked={view === 'docked'}
                onSelect={() => choose('docked')}
              />
              <ViewModeItem
                icon={<Maximize2 className="h-4 w-4" strokeWidth={1.8} />}
                label={t('whiteboardViewFill')}
                hint={t('whiteboardViewFillHint')}
                checked={view === 'focused'}
                onSelect={() => choose('focused')}
              />
              <ViewModeItem
                icon={<Maximize className="h-4 w-4" strokeWidth={1.8} />}
                label={t('whiteboardViewFullscreen')}
                hint={t('whiteboardViewFullscreenHint')}
                checked={view === 'fullscreen'}
                onSelect={() => choose('fullscreen')}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
