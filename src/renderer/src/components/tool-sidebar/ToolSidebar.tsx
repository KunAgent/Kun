import type { ReactElement, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Plus, X } from 'lucide-react'
import { useToolSidebarStore, type PanelTab } from './tool-sidebar-store'
import { getAddMenuPanels, getPanelMeta } from './panel-registry'

type ToolSidebarProps = {
  width: number
  onBeginResize: (event: ReactPointerEvent<HTMLDivElement>) => void
  onCollapse?: () => void
  renderTab: (tab: PanelTab) => ReactNode
}

export function ToolSidebar({
  width,
  onBeginResize,
  renderTab
}: ToolSidebarProps): ReactElement {
  const { t } = useTranslation(['common'])
  const tabs = useToolSidebarStore((s) => s.tabs)
  const activeTabId = useToolSidebarStore((s) => s.activeTabId)
  const setActiveTab = useToolSidebarStore((s) => s.setActiveTab)
  const closeTab = useToolSidebarStore((s) => s.closeTab)
  const openTab = useToolSidebarStore((s) => s.openTab)

  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const addMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (tabs.length === 0) {
      setAddMenuOpen(true)
    }
  }, [tabs.length])

  useEffect(() => {
    if (!addMenuOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && addMenuRef.current?.contains(target)) return
      setAddMenuOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [addMenuOpen])

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null
  const addMenuItems = getAddMenuPanels().filter(
    (meta) => !tabs.some((tab) => tab.type === meta.type)
  )

  return (
    <>
      <div
        role="separator"
        aria-orientation="vertical"
        className="ds-workbench-divider ds-no-drag relative z-20 shrink-0 cursor-col-resize"
        onPointerDown={onBeginResize}
      />
      <div
        className="ds-tool-sidebar flex h-full min-h-0 shrink-0 flex-col bg-ds-sidebar"
        style={{ width }}
      >
        <div className="ds-no-drag flex min-h-0 shrink-0 items-center gap-0.5 border-b border-ds-border-muted px-1.5 py-1">
          <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
            {tabs.map((tab) => {
              const meta = getPanelMeta(tab.type)
              const Icon = meta.icon
              const active = tab.id === activeTabId
              return (
                <div
                  key={tab.id}
                  className={`group/tab flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium transition ${
                    active
                      ? 'bg-ds-hover text-ds-ink'
                      : 'text-ds-muted hover:bg-ds-hover/60 hover:text-ds-ink'
                  }`}
                >
                  <button
                    type="button"
                    className="flex min-w-0 items-center gap-1.5"
                    onClick={() => setActiveTab(tab.id)}
                    title={t(meta.labelKey)}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.85} />
                    <span className="max-w-[8rem] truncate">{t(meta.labelKey)}</span>
                  </button>
                  {meta.closable ? (
                    <button
                      type="button"
                      className="ml-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-ds-faint opacity-0 transition hover:bg-ds-border-muted hover:text-ds-ink group-hover/tab:opacity-100"
                      onClick={() => closeTab(tab.id)}
                      aria-label={t('toolSidebarCloseTab')}
                      title={t('toolSidebarCloseTab')}
                    >
                      <X className="h-3 w-3" strokeWidth={2} />
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>

          <div ref={addMenuRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setAddMenuOpen((value) => !value)}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
              aria-label={t('toolSidebarAddPanel')}
              title={t('toolSidebarAddPanel')}
            >
              <Plus className="h-4 w-4" strokeWidth={1.85} />
            </button>
            {addMenuOpen && addMenuItems.length > 0 ? (
              <div className="ds-card-strong absolute right-0 top-full z-50 mt-1.5 w-52 overflow-hidden rounded-[14px] border border-ds-border py-1.5 shadow-[0_18px_52px_rgba(20,47,95,0.18)] backdrop-blur-xl dark:shadow-[0_22px_58px_rgba(0,0,0,0.38)]">
                <div className="border-b border-ds-border-muted px-3 pb-1.5 pt-1 text-[11px] font-semibold text-ds-faint">
                  {t('toolSidebarAddPanel')}
                </div>
                {addMenuItems.map((meta) => {
                  const Icon = meta.icon
                  const isOpen = tabs.some((tab) => tab.type === meta.type)
                  return (
                    <button
                      key={meta.type}
                      type="button"
                      onClick={() => {
                        openTab(meta.type)
                        setAddMenuOpen(false)
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                    >
                      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.85} />
                      <span className="min-w-0 flex-1 truncate">{t(meta.labelKey)}</span>
                      {isOpen ? <Check className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2} /> : null}
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>
        </div>

        <div className="relative min-h-0 flex-1">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className="absolute inset-0 min-h-0"
              style={{ display: tab.id === activeTabId ? 'flex' : 'none' }}
            >
              <div className="h-full w-full min-h-0">{renderTab(tab)}</div>
            </div>
          ))}
          {!activeTab ? (
            <div className="flex h-full items-center justify-center text-[13px] text-ds-faint">
              {t('toolSidebarEmpty')}
            </div>
          ) : null}
        </div>
      </div>
    </>
  )
}
