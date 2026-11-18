import { useState, type PointerEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelRightClose, Sparkles } from 'lucide-react'
import { sideRailButtonClass, WorkbenchSideRailSurface } from '../../components/workbench/WorkbenchSideRail'
import { ColabKunPane, type ColabKunChatHost } from './ColabKunPane'
import { useColabNotebookStore } from './colab-notebook-store'
import type { ColabNotebookRuntime } from './use-colab-notebook-runtime'

const MIN_WIDTH = 296
const MAX_WIDTH = 520
const DEFAULT_WIDTH = 340

export function ColabRightSidebar({ runtime, chat }: {
  runtime: ColabNotebookRuntime
  chat?: ColabKunChatHost
}): ReactElement {
  const { t } = useTranslation('common')
  const open = useColabNotebookStore((s) => s.sidePanelOpen)
  const setOpen = useColabNotebookStore((s) => s.setSidePanelOpen)
  const [width, setWidth] = useState(DEFAULT_WIDTH)

  function beginResize(event: PointerEvent<HTMLDivElement>): void {
    event.preventDefault()
    const handle = event.currentTarget
    const startX = event.clientX
    const startWidth = width
    const move = (e: globalThis.PointerEvent): void => {
      setWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + startX - e.clientX)))
    }
    handle.setPointerCapture(event.pointerId)
    handle.addEventListener('pointermove', move)
    handle.addEventListener('lostpointercapture', () => handle.removeEventListener('pointermove', move), { once: true })
  }

  return (
    <>
      {!open ? (
        <WorkbenchSideRailSurface data-colab-chat-rail>
          <button type="button" className={sideRailButtonClass(false)} aria-controls="colab-kun-sidebar"
            title={t('colabNb.showSidePanel')} aria-label={t('colabNb.showSidePanel')}
            onClick={() => setOpen(true)}>
            <Sparkles aria-hidden="true" />
          </button>
        </WorkbenchSideRailSurface>
      ) : null}
      <aside id="colab-kun-sidebar" aria-label={t('colabNb.kunPanelTitle')} hidden={!open}
        style={{ width, maxWidth: '46%' }} data-colab-right-sidebar="kun"
        className={`ds-no-drag relative h-full min-h-0 shrink-0 flex-col border-l border-ds-border bg-ds-card ${open ? 'flex' : 'hidden'}`}>
        <div role="separator" aria-orientation="vertical" onPointerDown={beginResize}
          className="absolute -left-1 top-0 z-20 h-full w-2 touch-none cursor-col-resize hover:bg-accent/20" />
        <header className="flex shrink-0 items-center gap-2 border-b border-ds-border px-3 py-1.5">
          <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
          <h2 className="flex-1 text-[12.5px] font-semibold text-ds-ink">{t('colabNb.kunPanelTitle')}</h2>
          <button type="button" onClick={() => setOpen(false)} title={t('colabNb.hideSidePanel')}
            aria-label={t('colabNb.hideSidePanel')} aria-controls="colab-kun-sidebar"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-ds-muted hover:bg-ds-hover hover:text-ds-ink">
            <PanelRightClose className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>
        {/* Keep the session and composer mounted when collapsing to the Work-style rail. */}
        <ColabKunPane chat={chat} runtime={runtime} />
      </aside>
    </>
  )
}
