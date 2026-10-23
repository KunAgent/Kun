import { memo, useCallback, useEffect, useRef, useState, type ReactElement, type RefObject } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  canvasInspectorTabsForSurface,
  clampCanvasInspectorHeight,
  useCanvasInspectorStore,
  type CanvasInspectorTab
} from '../../../design/canvas/canvas-inspector-store'
import type { CanvasSurface } from '../../../design/canvas/canvas-surface'
import { isDesignCanvasSurface } from '../../../design/canvas/canvas-surface'
import type { DesignArtifact } from '../../../design/design-types'
import { PropertiesPanel } from './PropertiesPanel'
import { CanvasLayersPanel } from './CanvasLayersPanel'
import { CanvasCodePanel } from './CanvasCodePanel'
import { CanvasTweaksPanel } from './CanvasTweaksPanel'

const TAB_LABEL_KEYS: Record<CanvasInspectorTab, string> = {
  properties: 'canvasInspectorTabProperties',
  outline: 'canvasInspectorTabOutline',
  code: 'canvasInspectorTabCode',
  tweaks: 'canvasInspectorTabTweaks'
}

/** Drawer visibility and height for a canvas host; hidden while the motion dock is open. */
export function useCanvasInspectorLayout(
  hostRef: RefObject<HTMLElement | null>,
  suppressed: boolean
): { visible: boolean; height: number; hostHeight: number } {
  const open = useCanvasInspectorStore((s) => s.open)
  const height = useCanvasInspectorStore((s) => s.height)
  const [hostHeight, setHostHeight] = useState(0)
  useEffect(() => {
    const host = hostRef.current
    if (!host || typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.height ?? 0
      setHostHeight((current) => (Math.abs(current - next) < 0.5 ? current : next))
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [hostRef])
  const visible = open && !suppressed
  return {
    visible,
    height: visible ? clampCanvasInspectorHeight(height, hostHeight) : 0,
    hostHeight
  }
}

type Props = {
  surface: CanvasSurface
  workspaceRoot: string
  height: number
  hostHeight: number
  onImplementDesign?: (artifact: DesignArtifact) => void
  onRequestModify?: (promptSeed: string) => void
  onOpenAgentSettings?: () => void
  designTargetDisabled?: boolean
}

function CanvasInspectorDrawerInner({
  surface,
  workspaceRoot,
  height,
  hostHeight,
  onImplementDesign,
  onRequestModify,
  onOpenAgentSettings,
  designTargetDisabled
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const storedTab = useCanvasInspectorStore((s) => s.tab)
  const setTab = useCanvasInspectorStore((s) => s.setTab)
  const setOpen = useCanvasInspectorStore((s) => s.setOpen)
  const setHeight = useCanvasInspectorStore((s) => s.setHeight)
  const tabs = canvasInspectorTabsForSurface(isDesignCanvasSurface(surface))
  const tab = tabs.includes(storedTab) ? storedTab : 'properties'
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null)

  const onResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = { startY: event.clientY, startHeight: height }
    const onMove = (move: PointerEvent): void => {
      const drag = dragRef.current
      if (!drag) return
      setHeight(clampCanvasInspectorHeight(drag.startHeight + drag.startY - move.clientY, hostHeight))
    }
    const onUp = (): void => {
      dragRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [height, hostHeight, setHeight])

  return (
    <section
      className="ds-no-drag absolute inset-x-0 bottom-0 z-[45] flex flex-col border-t border-ds-border bg-ds-elevated text-ds-ink shadow-[0_-10px_30px_rgba(15,23,42,0.06)]"
      style={{ height }}
      aria-label={t('canvasInspectorLabel')}
      data-canvas-inspector-drawer={surface}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={t('canvasInspectorResize')}
        className="group absolute inset-x-0 -top-1.5 z-10 flex h-3 cursor-row-resize items-center justify-center"
        onPointerDown={onResizeStart}
      >
        <span className="h-1 w-9 rounded-full bg-ds-border opacity-0 transition group-hover:opacity-100" />
      </div>
      <div className="flex h-11 shrink-0 items-center gap-0.5 px-2.5" role="tablist" aria-label={t('canvasInspectorLabel')}>
        {tabs.map((item) => {
          const selected = item === tab
          return (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setTab(item)}
              data-canvas-inspector-tab={item}
              className={`h-8 rounded-[8px] px-2.5 text-[13px] transition-colors ${
                selected ? 'font-semibold text-ds-ink' : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
              }`}
            >
              {t(TAB_LABEL_KEYS[item])}
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
          title={t('canvasInspectorHide')}
          aria-label={t('canvasInspectorHide')}
        >
          <X className="h-4 w-4" strokeWidth={1.9} />
        </button>
      </div>
      <div
        role="tabpanel"
        className={`min-h-0 flex-1 border-t border-ds-border-muted ${tab === 'code' ? 'overflow-hidden' : 'overflow-y-auto'}`}
      >
        {tab === 'properties' ? <PropertiesPanel surface={surface} /> : null}
        {tab === 'outline' ? <CanvasLayersPanel /> : null}
        {tab === 'code' ? <CanvasCodePanel workspaceRoot={workspaceRoot} /> : null}
        {tab === 'tweaks' ? (
          <CanvasTweaksPanel
            onImplementDesign={onImplementDesign}
            onRequestModify={onRequestModify}
            onOpenAgentSettings={onOpenAgentSettings}
            designTargetDisabled={designTargetDisabled}
          />
        ) : null}
      </div>
    </section>
  )
}

export const CanvasInspectorDrawer = memo(CanvasInspectorDrawerInner)
