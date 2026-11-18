import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, FolderOpen, NotebookPen, Plus } from 'lucide-react'
import { useChatStore } from '../../store/chat-store'
import {
  isColabSessionRunning,
  normalizeColabWorkspaceKey,
  selectWorkspaceSessions,
  useColabStore,
  useColabSubscription
} from '../colab-store'
import { ColabConnectionsSection } from '../ColabConnectionsSection'
import { ColabComputeControls, ColabRuntimePane } from './ColabRuntimePane'
import { JupyterRuntimeSection } from './JupyterRuntimeSection'
import { useNotebookPullStore } from './notebook-pull-store'
import { useColabNotebookStore } from './colab-notebook-store'
import { useJupyterStore, useJupyterSubscription } from './jupyter-store'
import { useColabNotebookRuntime } from './use-colab-notebook-runtime'

const sectionTitle = 'flex items-center justify-between px-2.5 pb-1 pt-3.5 text-[11.5px] font-semibold text-ds-faint'
const iconButton =
  'flex h-6 w-6 items-center justify-center rounded-md text-ds-faint hover:bg-ds-hover hover:text-ds-ink disabled:opacity-40'

/** Compact status indicator for the sidebar Colab entry while a runtime is live. */
export function ColabNavBadge({ workspaceRoot }: { workspaceRoot: string }): ReactElement | null {
  useColabSubscription()
  useJupyterSubscription()
  const { t } = useTranslation('common')
  const snapshot = useColabStore((s) => s.snapshot)
  const jupyterSessions = useJupyterStore((s) => s.snapshot.sessions)
  const live = selectWorkspaceSessions(snapshot, workspaceRoot).find(isColabSessionRunning)
  const wsKey = normalizeColabWorkspaceKey(workspaceRoot)
  const jpy = jupyterSessions.find((s) => s.workspaceRoot === wsKey)
  const label = live ? live.accelerator : jpy ? jpy.serverName : null
  if (!label) return null
  return (
    <span
      className="h-2 w-2 shrink-0 rounded-full bg-emerald-500"
      title={t('colabNb.gpuRunning', { gpu: label })}
      aria-label={t('colabNb.gpuRunning', { gpu: label })}
    />
  )
}

export function ColabSidebarContent({ workspaceRoot }: { workspaceRoot: string }): ReactElement {
  const { t } = useTranslation('common')
  const runtime = useColabNotebookRuntime(workspaceRoot)
  const chooseWorkspace = useChatStore((s) => s.chooseWorkspace)
  const notebooks = useColabNotebookStore((s) => s.notebooks)
  const activePath = useColabNotebookStore((s) => s.activePath)
  const dirty = useColabNotebookStore((s) => s.dirty)
  const openNotebook = useColabNotebookStore((s) => s.openNotebook)
  const createNotebook = useColabNotebookStore((s) => s.createNotebook)
  const importLocalNotebooks = useColabNotebookStore((s) => s.importLocalNotebooks)
  const request = useColabNotebookStore((s) => s.connectionsFocusRequest)
  const pullVisible = useNotebookPullStore((s) => s.visible && s.task?.workspaceRoot === runtime.wsKey)
  const head = useRef<HTMLHeadingElement>(null)
  const [computeId, setComputeId] = useState<string | null>(null)
  const [showTools, setShowTools] = useState(false)
  const connections = useColabStore((s) => s.snapshot.connections)
  const compute = connections.find((account) => account.id === computeId)

  useEffect(() => {
    if (!request || !head.current) return
    head.current.scrollIntoView?.({ block: 'nearest' })
    head.current.focus({ preventScroll: true })
  }, [request])

  return (
    <div className="ds-no-drag flex min-h-0 flex-1 flex-col" data-colab-sidebar>
      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        <section data-colab-connections aria-labelledby="colab-left-connections">
          <h2 id="colab-left-connections" ref={head} tabIndex={-1} className={`${sectionTitle} focus-visible:outline-accent`}>
            {t('colabNb.accountsAndConnections')}
          </h2>
          <ColabConnectionsSection workspaceRoot={runtime.wsKey} notebookActions={{
            onPull: (account) => useNotebookPullStore.getState().open({ kind: 'drive', connectionId: account.id, label: account.name }, runtime.wsKey),
            onCompute: (account) => setComputeId((current) => current === account.id ? null : account.id)
          }} />
          {compute && runtime.wsKey ? (
            <div className="px-2 pb-2" data-colab-compute>
              <ColabComputeControls key={compute.id} runtime={runtime} account={compute} />
            </div>
          ) : null}
          <JupyterRuntimeSection key={runtime.wsKey} runtime={runtime}
            onPull={(server) => useNotebookPullStore.getState().open({ kind: 'jupyter', serverId: server.id, label: server.name }, runtime.wsKey)} />
        </section>
        <section className="border-t border-ds-border/70" aria-labelledby="colab-project-notebooks">
          <div className={sectionTitle}>
            <h2 id="colab-project-notebooks">{t('colabNb.notebooks')}</h2>
            {runtime.wsKey ? (
              <span className="flex items-center gap-0.5">
                <button type="button" className={iconButton} title={t('colabNb.importLocalBtn')} aria-label={t('colabNb.importLocalBtn')}
                  onClick={() => void importLocalNotebooks(runtime.wsKey).then((opened) => {
                    if (opened) useNotebookPullStore.getState().hide()
                  })}><FolderOpen className="h-3.5 w-3.5" /></button>
                <button type="button" className={iconButton} title={t('colabNb.newNotebook')} aria-label={t('colabNb.newNotebook')}
                  onClick={() => {
                    useNotebookPullStore.getState().hide()
                    void createNotebook(runtime.wsKey)
                  }}><Plus className="h-3.5 w-3.5" /></button>
              </span>
            ) : null}
          </div>
          {!runtime.wsKey ? (
            <div className="space-y-2 px-2.5 py-1.5 text-[12px] text-ds-muted">
              <p>{t('colabNb.noWorkspace')}</p>
              <button type="button" onClick={() => void chooseWorkspace({ createThreadAfter: false, selectThreadAfter: false })}
                className="rounded-md border border-ds-border bg-ds-card px-2 py-1 text-ds-ink hover:bg-ds-hover">
                {t('colabNb.chooseProject')}
              </button>
            </div>
          ) : notebooks.length === 0 ? (
            <p className="px-2.5 py-1.5 text-[12px] text-ds-faint">{t('colabNb.noNotebooks')}</p>
          ) : notebooks.map((path) => {
            const active = !pullVisible && path === activePath
            return (
              <button key={path} type="button" aria-current={active ? 'page' : undefined} onClick={() => {
                useNotebookPullStore.getState().hide()
                void openNotebook(path)
              }} className={`mx-1 flex w-[calc(100%_-_0.5rem)] items-center gap-2 rounded-[7px] px-2 py-1 text-left text-[12.5px] ${
                active ? 'bg-ds-card font-medium text-ds-ink shadow-sm' : 'text-ds-ink hover:bg-ds-hover'
              }`}>
                <NotebookPen className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate" title={path}>{path}</span>
                {active ? <span className="shrink-0 text-[11px] text-ds-faint">{dirty ? t('colabNb.unsaved') : t('colabNb.saved')}</span> : null}
              </button>
            )
          })}
        </section>
        {runtime.activeSessionId ? (
          <section className="mt-2 border-t border-ds-border/70">
            <button type="button" aria-expanded={showTools} onClick={() => setShowTools(!showTools)}
              className={`${sectionTitle} w-full gap-1 text-left hover:text-ds-ink`}>
              {t('colabNb.kernelTools')}<ChevronDown className={`h-3.5 w-3.5 ${showTools ? '' : '-rotate-90'}`} aria-hidden="true" />
            </button>
            {showTools ? <ColabRuntimePane runtime={runtime} /> : null}
          </section>
        ) : null}
      </div>
    </div>
  )
}
