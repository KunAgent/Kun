import { useCallback, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronRight,
  CloudCheck,
  Cpu,
  Download,
  ExternalLink,
  Loader2,
  MoreHorizontal,
  Save,
  Settings2,
  Sparkles,
  Terminal,
  X
} from 'lucide-react'
import { SidebarTitlebarToggleButton } from '../../components/sidebar/SidebarPrimitives'
import { useChatStore } from '../../store/chat-store'
import { useColabDismiss } from '../use-colab-dismiss'
import { KernelPickerPopover } from './KernelPickerPopover'
import { NotebookImportMenu } from './NotebookImportMenu'
import { useColabNotebookStore } from './colab-notebook-store'
import { useNotebookPullStore } from './notebook-pull-store'
import type { ColabNotebookRuntime } from './use-colab-notebook-runtime'

/** Topbar for the Notebook stage: breadcrumb, save chip, kernel picker, import, overflow, and Kun toggle. */
export function NotebookTopbar({
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  onClose,
  runtime,
  busy,
  usingJupyter
}: {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  onClose: () => void
  runtime: ColabNotebookRuntime
  busy: boolean
  usingJupyter: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const openSettings = useChatStore((s) => s.openSettings)
  const activePath = useColabNotebookStore((s) => s.activePath)
  const dirty = useColabNotebookStore((s) => s.dirty)
  const saving = useColabNotebookStore((s) => s.saving)
  const sidePanelOpen = useColabNotebookStore((s) => s.sidePanelOpen)
  const saveNotebook = useColabNotebookStore((s) => s.saveNotebook)
  const setSidePanelOpen = useColabNotebookStore((s) => s.setSidePanelOpen)
  const setKernelPickerOpen = useColabNotebookStore((s) => s.setKernelPickerOpen)

  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)
  const closeMore = useCallback(() => setMoreOpen(false), [])
  useColabDismiss(moreOpen, closeMore, moreRef)

  const canOpenExternal = usingJupyter
    ? Boolean(runtime.jupyterSession)
    : Boolean(runtime.session || runtime.connection)

  return (
    <div className="ds-stage-inset shrink-0 border-b border-ds-border-muted">
      <header className="ds-topbar-surface relative z-20 flex min-h-[50px] w-full items-center justify-between gap-3 overflow-visible px-3.5">
        <div
          className={`flex min-w-0 items-center gap-2 ${
            leftSidebarCollapsed ? 'ds-window-controls-collapsed-titlebar-inset' : ''
          }`}
        >
          <SidebarTitlebarToggleButton
            onClick={onToggleLeftSidebar}
            title={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
            ariaLabel={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
          />
          <span className="shrink-0 text-[13px] text-ds-muted">{t('colabNb.navLabel')}</span>
          {activePath ? (
            <>
              <ChevronRight className="h-3 w-3 shrink-0 text-ds-faint" aria-hidden="true" />
              <h1 className="min-w-0 truncate text-[14px] font-semibold text-ds-ink" title={activePath}>
                {activePath}
              </h1>
              {saving ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-[11.5px] text-ds-faint">
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  <span>{t('colabNb.saving')}</span>
                </span>
              ) : dirty ? (
                <button
                  type="button"
                  onClick={() => void saveNotebook()}
                  title={t('colabNb.save')}
                  className="ds-no-drag inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[11.5px] text-amber-600 transition hover:bg-amber-500/10 dark:text-amber-400"
                >
                  <span className="h-[6px] w-[6px] rounded-full bg-amber-500" />
                  <span>{t('colabNb.unsaved')}</span>
                </button>
              ) : (
                <span className="inline-flex shrink-0 items-center gap-1 text-[11.5px] text-ds-faint">
                  <CloudCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{t('colabNb.saved')}</span>
                </span>
              )}
            </>
          ) : null}
        </div>

        <div className="ds-no-drag flex shrink-0 items-center gap-1.5">
          <KernelPickerPopover runtime={runtime} busy={busy} />
          <NotebookImportMenu runtime={runtime} />

          <div ref={moreRef} className="relative">
            <button
              type="button"
              aria-expanded={moreOpen}
              aria-haspopup="menu"
              aria-label={t('colabNb.moreActions')}
              title={t('colabNb.moreActions')}
              onClick={() => setMoreOpen((v) => !v)}
              className="flex h-7 w-7 items-center justify-center rounded-[7px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </button>
            {moreOpen ? (
              <div
                role="menu"
                className="absolute right-0 top-full z-40 mt-2 w-56 rounded-[12px] border border-ds-border bg-ds-card py-1.5 text-[12.5px] shadow-xl"
              >
                {canOpenExternal ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMoreOpen(false)
                      runtime.openExternalNotebookUi()
                    }}
                    className="mx-1.5 flex w-[calc(100%-0.75rem)] items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-ds-ink hover:bg-ds-hover"
                  >
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-ds-muted" />
                    <span className="truncate">
                      {usingJupyter ? t('colabNb.jupyterOpenLab') : t('colabNb.openInColab')}
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMoreOpen(false)
                      setKernelPickerOpen(true)
                    }}
                    className="mx-1.5 flex w-[calc(100%-0.75rem)] items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-ds-ink hover:bg-ds-hover"
                  >
                    <Cpu className="h-3.5 w-3.5 shrink-0 text-ds-muted" />
                    <span className="truncate">{t('colabNb.connectRuntimeBtn')}</span>
                  </button>
                )}
                {usingJupyter && runtime.jupyterSession && runtime.wsKey ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMoreOpen(false)
                      useNotebookPullStore.getState().open(
                        {
                          kind: 'jupyter',
                          serverId: runtime.jupyterSession!.serverId,
                          label: runtime.jupyterSession!.serverName
                        },
                        runtime.wsKey
                      )
                    }}
                    className="mx-1.5 flex w-[calc(100%-0.75rem)] items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-ds-ink hover:bg-ds-hover"
                  >
                    <Download className="h-3.5 w-3.5 shrink-0 text-ds-muted" />
                    <span className="truncate">{t('colabNb.jupyterImportFromThis')}</span>
                  </button>
                ) : null}
                {!usingJupyter && (runtime.session || runtime.connection) ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMoreOpen(false)
                      void runtime.openSshTerminal()
                    }}
                    className="mx-1.5 flex w-[calc(100%-0.75rem)] items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-ds-ink hover:bg-ds-hover"
                  >
                    <Terminal className="h-3.5 w-3.5 shrink-0 text-ds-muted" />
                    <span className="truncate">{t('colabNb.openSshTerminal')}</span>
                  </button>
                ) : null}
                {activePath ? (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={saving}
                    onClick={() => {
                      setMoreOpen(false)
                      void saveNotebook()
                    }}
                    className="mx-1.5 flex w-[calc(100%-0.75rem)] items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-ds-ink hover:bg-ds-hover disabled:opacity-40"
                  >
                    <Save className="h-3.5 w-3.5 shrink-0 text-ds-muted" />
                    <span className="truncate">{t('colabNb.save')}</span>
                  </button>
                ) : null}
                <div className="my-1 border-t border-ds-border-muted" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false)
                    setKernelPickerOpen(true, { backend: usingJupyter ? 'jupyter' : undefined })
                  }}
                  className="mx-1.5 flex w-[calc(100%-0.75rem)] items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-ds-ink hover:bg-ds-hover"
                >
                  <Cpu className="h-3.5 w-3.5 shrink-0 text-ds-muted" />
                  <span className="truncate">{t('colabNb.runtimeManageMenu')}</span>
                </button>
                {!usingJupyter || runtime.connection ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMoreOpen(false)
                      openSettings('cloudCompute')
                    }}
                    className="mx-1.5 flex w-[calc(100%-0.75rem)] items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-ds-ink hover:bg-ds-hover"
                  >
                    <Settings2 className="h-3.5 w-3.5 shrink-0 text-ds-muted" />
                    <span className="truncate">{t('colabNb.accountComputeSettings')}</span>
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          <span className="mx-0.5 h-4 w-px bg-ds-border" aria-hidden="true" />

          <button
            type="button"
            data-colab-kun-toggle
            aria-pressed={sidePanelOpen}
            aria-label={t(sidePanelOpen ? 'colabNb.hideSidePanel' : 'colabNb.showSidePanel')}
            title={t(sidePanelOpen ? 'colabNb.hideSidePanel' : 'colabNb.showSidePanel')}
            onClick={() => setSidePanelOpen(!sidePanelOpen)}
            className={`inline-flex h-7 items-center gap-1.5 rounded-[8px] px-2.5 text-[12.5px] font-medium transition ${
              sidePanelOpen
                ? 'bg-accent-tint/10 text-accent'
                : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
            <span>{t('colabNb.tabKun')}</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label={t('artifactsClose')}
            title={t('artifactsClose')}
            className="flex h-7 w-7 items-center justify-center rounded-[7px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </header>
    </div>
  )
}
