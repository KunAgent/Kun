import { useCallback, useMemo, useRef, useState, type PointerEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, History, PanelRightClose, Sparkles, SquarePen } from 'lucide-react'
import { normalizeWorkspaceRoot } from '../../lib/workspace-path'
import { useChatStore } from '../../store/chat-store'
import { useColabDismiss } from '../use-colab-dismiss'
import { ColabKunPane, type ColabKunChatHost, type ColabKunSessionControl } from './ColabKunPane'
import { ColabPortsTab } from './ColabPortsTab'
import { ColabFilesTab, ColabResourcesTab, ColabVariablesTab } from './ColabRuntimePane'
import { readColabKunThreadIds, rememberColabKunThread } from './colab-kun-threads'
import { useColabNotebookStore, type NotebookSidePanelTab } from './colab-notebook-store'
import { useColabPortForwardStore } from './colab-port-forward-store'
import type { ColabNotebookRuntime } from './use-colab-notebook-runtime'

const MIN_WIDTH = 296
const MAX_WIDTH = 520
const DEFAULT_WIDTH = 352

const headerIconButton =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-40 disabled:hover:bg-transparent'

export function ColabRightSidebar({
  runtime,
  chat
}: {
  runtime: ColabNotebookRuntime
  chat?: ColabKunChatHost
}): ReactElement {
  const { t } = useTranslation('common')
  const open = useColabNotebookStore((s) => s.sidePanelOpen)
  const tab = useColabNotebookStore((s) => s.sidePanelTab)
  const variablesCount = useColabNotebookStore((s) => s.variables.length)
  const threads = useChatStore((s) => s.threads)
  const forwardsCount = useColabPortForwardStore(
    (s) =>
      s.forwards.filter(
        (item) => item.sessionId === runtime.session?.id && item.state !== 'failed'
      ).length
  )
  const setOpen = useColabNotebookStore((s) => s.setSidePanelOpen)
  const setTab = useColabNotebookStore((s) => s.setSidePanelTab)
  const [width, setWidth] = useState(DEFAULT_WIDTH)

  const [draftFresh, setDraftFresh] = useState(false)
  const [colabThreadIds, setColabThreadIds] = useState<string[]>(() => readColabKunThreadIds())
  const [historyOpen, setHistoryOpen] = useState(false)
  const historyRef = useRef<HTMLDivElement>(null)
  const closeHistory = useCallback(() => setHistoryOpen(false), [])
  useColabDismiss(historyOpen, closeHistory, historyRef)

  const workspaceThreads = useMemo(() => {
    const root = normalizeWorkspaceRoot(runtime.wsKey)
    const colabSet = new Set(colabThreadIds)
    const inWorkspace = threads.filter(
      (th) => !th.archived && (!root || normalizeWorkspaceRoot(th.workspace ?? '') === root)
    )
    return [
      ...inWorkspace.filter((th) => colabSet.has(th.id)),
      ...inWorkspace.filter((th) => !colabSet.has(th.id))
    ].slice(0, 20)
  }, [colabThreadIds, runtime.wsKey, threads])

  const activeThread = useMemo(() => {
    if (draftFresh || !chat?.activeThreadId || !colabThreadIds.includes(chat.activeThreadId)) return null
    const thread = threads.find((th) => th.id === chat.activeThreadId)
    if (!thread) return null
    const root = normalizeWorkspaceRoot(runtime.wsKey)
    return !root || normalizeWorkspaceRoot(thread.workspace ?? '') === root ? thread : null
  }, [chat?.activeThreadId, colabThreadIds, draftFresh, runtime.wsKey, threads])
  const effectiveThreadId = activeThread?.id ?? null

  const sessionControl = useMemo<ColabKunSessionControl>(
    () => ({
      draftFresh,
      setDraftFresh,
      colabThreadIds,
      setColabThreadIds,
      effectiveThreadId
    }),
    [colabThreadIds, draftFresh, effectiveThreadId]
  )

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
    handle.addEventListener(
      'lostpointercapture',
      () => handle.removeEventListener('pointermove', move),
      { once: true }
    )
  }

  const openInCode = (): void => {
    const store = useChatStore.getState()
    store.setRoute('chat')
    if (effectiveThreadId) void store.selectThread(effectiveThreadId)
  }

  const usingJupyter = Boolean(
    runtime.activeSessionId &&
      runtime.jupyterSession &&
      runtime.activeSessionId === runtime.jupyterSession.id
  )
  const showPortsTab = !usingJupyter && Boolean(runtime.session || runtime.pending)
  const effectiveTab: NotebookSidePanelTab = tab === 'ports' && !showPortsTab ? 'resources' : tab

  const tabs: Array<{ id: NotebookSidePanelTab; label: string; icon?: boolean; count?: number }> = [
    { id: 'kun', label: t('colabNb.tabKun'), icon: true },
    { id: 'variables', label: t('colabNb.variablesTitle'), count: variablesCount },
    { id: 'files', label: t('colabNb.tabFiles') },
    ...(showPortsTab
      ? [{ id: 'ports' as const, label: t('colabNb.tabPorts'), count: forwardsCount }]
      : []),
    { id: 'resources', label: t('colabNb.tabResources') }
  ]

  return (
    <aside
      id="colab-kun-sidebar"
      aria-label={t('colabNb.kunPanelTitle')}
      hidden={!open}
      style={{ width, maxWidth: '46%' }}
      data-colab-right-sidebar={effectiveTab}
      className={`ds-no-drag relative h-full min-h-0 shrink-0 flex-col border-l border-ds-border-muted bg-ds-card ${
        open ? 'flex' : 'hidden'
      }`}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        onPointerDown={beginResize}
        className="absolute -left-1 top-0 z-20 h-full w-2 touch-none cursor-col-resize hover:bg-accent-tint/20"
      />
      <header
        data-colab-right-header
        className="flex h-11 shrink-0 items-center gap-1 border-b border-ds-border-muted pl-2.5 pr-2"
      >
        <div
          role="tablist"
          className="inline-flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-[9px] bg-ds-surface-subtle p-[2px] [scrollbar-width:none]"
        >
          {tabs.map((item) => {
            const active = effectiveTab === item.id
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(item.id)}
                className={`inline-flex h-[26px] shrink-0 items-center gap-1 rounded-[7px] text-[12px] transition ${
                  tabs.length >= 5 ? 'px-1.5' : 'px-2'
                } ${
                  active
                    ? 'bg-ds-card font-semibold text-ds-ink shadow-sm'
                    : 'text-ds-muted hover:text-ds-ink'
                }`}
              >
                {item.icon ? (
                  <Sparkles className="h-3 w-3 shrink-0 text-accent" aria-hidden="true" />
                ) : null}
                <span className="truncate">{item.label}</span>
                {item.count && item.count > 0 ? (
                  <span className="rounded bg-ds-surface-subtle px-1 font-mono text-[10px] text-ds-faint">
                    {item.count}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {effectiveTab === 'kun' ? (
            <>
              <div ref={historyRef} className="relative">
                <button
                  type="button"
                  data-colab-kun-history-trigger
                  disabled={workspaceThreads.length === 0}
                  onClick={() => setHistoryOpen((v) => !v)}
                  title={t('colabNb.kunHistory')}
                  aria-label={t('colabNb.kunHistory')}
                  className={headerIconButton}
                >
                  <History className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                {historyOpen ? (
                  <div className="absolute right-0 top-full z-30 mt-1.5 max-h-64 w-64 overflow-y-auto rounded-[10px] border border-ds-border bg-ds-card p-1 shadow-xl">
                    {workspaceThreads.map((th) => {
                      const isCurrent = !draftFresh && th.id === effectiveThreadId
                      return (
                        <button
                          key={th.id}
                          type="button"
                          onClick={() => {
                            setDraftFresh(false)
                            setHistoryOpen(false)
                            setColabThreadIds(rememberColabKunThread(th.id))
                            void useChatStore.getState().selectThread(th.id)
                          }}
                          className={`flex w-full items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-left text-[12px] ${
                            isCurrent
                              ? 'bg-accent-tint/10 font-semibold text-accent'
                              : 'text-ds-ink hover:bg-ds-hover'
                          }`}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {th.title?.trim() || t('colabNb.kunNewSession')}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                data-colab-kun-new-session
                onClick={() => setDraftFresh(true)}
                title={t('colabNb.kunNewSession')}
                aria-label={t('colabNb.kunNewSession')}
                className={headerIconButton}
              >
                <SquarePen className="h-3.5 w-3.5" aria-hidden="true" />
              </button>

              {effectiveThreadId ? (
                <button
                  type="button"
                  onClick={openInCode}
                  title={t('colabNb.kunOpenInCode')}
                  aria-label={t('colabNb.kunOpenInCode')}
                  className={headerIconButton}
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </>
          ) : null}

          <button
            type="button"
            onClick={() => setOpen(false)}
            title={t('colabNb.hideSidePanel')}
            aria-label={t('colabNb.hideSidePanel')}
            aria-controls="colab-kun-sidebar"
            className={headerIconButton}
          >
            <PanelRightClose className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Keep the Kun session and composer mounted across tab switches and collapse. */}
      <div
        hidden={effectiveTab !== 'kun'}
        className={effectiveTab === 'kun' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}
      >
        <ColabKunPane chat={chat} runtime={runtime} sessionControl={sessionControl} />
      </div>
      {open && effectiveTab === 'variables' ? <ColabVariablesTab runtime={runtime} /> : null}
      {open && effectiveTab === 'files' ? <ColabFilesTab runtime={runtime} /> : null}
      {open && effectiveTab === 'ports' && showPortsTab ? <ColabPortsTab runtime={runtime} /> : null}
      {open && effectiveTab === 'resources' ? <ColabResourcesTab runtime={runtime} /> : null}
    </aside>
  )
}
