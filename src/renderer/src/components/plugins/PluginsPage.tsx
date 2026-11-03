import { useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { SidebarTitlebarToggleButton } from '../sidebar/SidebarPrimitives'

type Translate = (key: string, values?: Record<string, unknown>) => string

/** Below this content width the rail folds into a filter row above the list. */
export const PLUGINS_COMPACT_WIDTH = 820

function useCompactLayout(): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [compact, setCompact] = useState(false)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node || typeof ResizeObserver === 'undefined') return
    // Layout pixels (offsetWidth), not getBoundingClientRect: the app body is
    // zoomed, and the breakpoint is meant in the same CSS pixels as the styles.
    const update = (): void => {
      const width = node.offsetWidth
      setCompact(width > 0 && width < PLUGINS_COMPACT_WIDTH)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return [ref, compact]
}

export function PluginsPage({
  t,
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  kind,
  onKind,
  actions,
  renderRail,
  renderMain,
  overlays
}: {
  t: Translate
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  kind: 'mcp' | 'skill'
  onKind: (kind: 'mcp' | 'skill') => void
  actions: ReactNode
  renderRail: (compact: boolean) => ReactNode
  renderMain: (compact: boolean) => ReactNode
  overlays?: ReactNode
}): ReactElement {
  const [contentRef, compact] = useCompactLayout()
  const tab = (value: 'mcp' | 'skill', label: string): ReactElement => {
    const active = kind === value
    const underline = value === 'skill' ? 'border-ds-skill' : 'border-accent'
    return (
      <button
        type="button"
        role="tab"
        aria-selected={active}
        onClick={() => onKind(value)}
        className={`-mb-px border-b-2 pb-[11px] pt-2.5 text-[14px] font-semibold transition ${active ? `${underline} text-ds-ink` : 'border-transparent text-ds-muted hover:text-ds-ink'}`}
      >
        {label}
      </button>
    )
  }
  return (
    <div className="ds-drag flex h-full min-h-0 flex-col bg-ds-main">
      <div className="ds-stage-inset shrink-0">
        <header className="ds-topbar-surface relative z-10 mt-3 flex min-h-[46px] w-full items-stretch overflow-visible rounded-[24px]">
          <div className="grid w-full min-w-0 items-center gap-2.5 px-3 py-2 sm:px-4 md:pl-5 md:pr-2">
            <div className={`flex min-w-0 items-center gap-2.5 ${leftSidebarCollapsed ? 'ds-window-controls-collapsed-titlebar-inset' : ''}`}>
              <SidebarTitlebarToggleButton
                onClick={onToggleLeftSidebar}
                title={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
                ariaLabel={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
              />
            </div>
          </div>
        </header>
      </div>
      <main className="ds-no-drag min-h-0 flex-1 overflow-y-auto">
        <div ref={contentRef} className={`mx-auto w-full max-w-[1180px] ${compact ? 'px-5 pb-8 pt-5' : 'px-8 pb-10 pt-7'}`}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <h1 className={`m-0 font-semibold tracking-tight text-ds-ink ${compact ? 'text-[19px]' : 'text-[22px]'}`}>{t('pluginsTitle')}</h1>
              {compact ? null : <p className="mb-0 mt-1 text-[13px] text-ds-muted">{t('pluginsSubtitle')}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          </div>
          <nav role="tablist" aria-label={t('pluginsKind')} className={`mt-[18px] flex gap-[26px] border-b border-ds-border-muted ${compact ? 'mt-3' : ''}`}>
            {tab('mcp', t('pluginsTabMcp'))}
            {tab('skill', t('pluginsTabSkill'))}
          </nav>
          <div className={compact ? 'mt-3.5 flex flex-col gap-3.5' : 'mt-[22px] flex gap-7'}>
            {renderRail(compact)}
            <div className="min-w-0 flex-1">{renderMain(compact)}</div>
          </div>
        </div>
      </main>
      {overlays}
    </div>
  )
}
