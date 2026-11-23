import { useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Cloud, Download, NotebookPen, Plus, Search, Server } from 'lucide-react'
import { workspaceLabelFromPath } from '../../lib/workspace-label'
import { useChatStore } from '../../store/chat-store'
import {
  isColabSessionRunning,
  normalizeColabWorkspaceKey,
  selectWorkspaceSessions,
  useColabStore,
  useColabSubscription
} from '../colab-store'
import { useColabNotebookStore } from './colab-notebook-store'
import { useJupyterStore, useJupyterSubscription } from './jupyter-store'
import { NotebookRuntimeCard } from './NotebookRuntimeCard'
import { useColabNotebookRuntime } from './use-colab-notebook-runtime'

const sectionTitle =
  'flex items-center justify-between px-2.5 pb-1.5 pt-2 text-[11.5px] font-semibold text-ds-faint'
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
  const recentImports = useColabNotebookStore((s) => s.recentImports)
  const openNotebook = useColabNotebookStore((s) => s.openNotebook)
  const createNotebook = useColabNotebookStore((s) => s.createNotebook)
  const importLocalNotebooks = useColabNotebookStore((s) => s.importLocalNotebooks)
  const [query, setQuery] = useState('')

  const projectLabel = runtime.wsKey ? workspaceLabelFromPath(runtime.wsKey) : ''
  const filteredNotebooks = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return notebooks
    return notebooks.filter((path) => path.toLocaleLowerCase().includes(needle))
  }, [notebooks, query])

  const workspaceRecentImports = useMemo(() => {
    if (!runtime.wsKey) return []
    const existing = new Set(notebooks)
    return recentImports.filter(
      (item) => item.workspaceRoot === runtime.wsKey && existing.has(item.relativePath)
    )
  }, [notebooks, recentImports, runtime.wsKey])

  return (
    <div className="ds-no-drag flex min-h-0 flex-1 flex-col" data-colab-sidebar>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        <section aria-labelledby="colab-project-notebooks">
          <div className={sectionTitle}>
            <h2 id="colab-project-notebooks" className="min-w-0 truncate">
              {projectLabel ? `${t('colabNb.notebooks')} · ${projectLabel}` : t('colabNb.notebooks')}
            </h2>
            {runtime.wsKey ? (
              <span className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  className={iconButton}
                  title={t('colabNb.importLocalBtn')}
                  aria-label={t('colabNb.importLocalBtn')}
                  onClick={() => void importLocalNotebooks(runtime.wsKey)}
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className={iconButton}
                  title={t('colabNb.newNotebook')}
                  aria-label={t('colabNb.newNotebook')}
                  onClick={() => void createNotebook(runtime.wsKey)}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </span>
            ) : null}
          </div>

          {runtime.wsKey && notebooks.length > 0 ? (
            <label className="mx-2 mb-1.5 flex items-center gap-1.5 rounded-[8px] border border-ds-border/80 bg-ds-card/60 px-2.5 py-1 text-[12px] text-ds-muted focus-within:border-accent">
              <Search className="h-3.5 w-3.5 shrink-0 text-ds-faint" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('colabNb.searchNotebooks')}
                aria-label={t('colabNb.searchNotebooks')}
                className="min-w-0 flex-1 bg-transparent text-[12px] text-ds-ink outline-none placeholder:text-ds-faint"
              />
            </label>
          ) : null}

          {!runtime.wsKey ? (
            <div className="space-y-2 px-2.5 py-1.5 text-[12px] text-ds-muted">
              <p>{t('colabNb.noWorkspace')}</p>
              <button
                type="button"
                onClick={() => void chooseWorkspace({ createThreadAfter: false, selectThreadAfter: false })}
                className="rounded-md border border-ds-border bg-ds-card px-2.5 py-1 text-ds-ink hover:bg-ds-hover"
              >
                {t('colabNb.chooseProject')}
              </button>
            </div>
          ) : notebooks.length === 0 ? (
            <p className="px-2.5 py-1.5 text-[12px] text-ds-faint">{t('colabNb.noNotebooks')}</p>
          ) : filteredNotebooks.length === 0 ? (
            <p className="px-2.5 py-1.5 text-[12px] text-ds-faint">{t('colabNb.noMatchingNotebooks')}</p>
          ) : (
            <div className="space-y-0.5">
              {filteredNotebooks.map((path) => {
                const active = path === activePath
                return (
                  <button
                    key={path}
                    type="button"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => void openNotebook(path)}
                    className={`mx-1.5 flex w-[calc(100%_-_0.75rem)] items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-[12.5px] transition ${
                      active
                        ? 'bg-ds-card font-medium text-ds-ink shadow-sm'
                        : 'text-ds-ink hover:bg-ds-hover'
                    }`}
                  >
                    <NotebookPen className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate" title={path}>
                      {path}
                    </span>
                    {active && dirty ? (
                      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                        <span className="h-[5px] w-[5px] rounded-full bg-amber-500" />
                        <span>{t('colabNb.unsaved')}</span>
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          )}
        </section>

        {workspaceRecentImports.length > 0 ? (
          <section className="mt-2" aria-labelledby="colab-recent-imports">
            <h2 id="colab-recent-imports" className={sectionTitle}>
              {t('colabNb.recentImports')}
            </h2>
            <div className="space-y-0.5">
              {workspaceRecentImports.slice(0, 5).map((item) => {
                const prefix = item.sourceKind === 'drive' ? 'Drive' : item.sourceLabel
                return (
                  <button
                    key={`${item.sourceKind}:${item.relativePath}`}
                    type="button"
                    onClick={() => void openNotebook(item.relativePath)}
                    className="mx-1.5 flex w-[calc(100%_-_0.75rem)] items-center gap-2 rounded-[8px] px-2.5 py-1 text-left text-[12px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
                  >
                    {item.sourceKind === 'drive' ? (
                      <Cloud className="h-3.5 w-3.5 shrink-0 text-ds-faint" aria-hidden="true" />
                    ) : (
                      <Server className="h-3.5 w-3.5 shrink-0 text-ds-faint" aria-hidden="true" />
                    )}
                    <span className="min-w-0 flex-1 truncate" title={item.relativePath}>
                      {prefix} · {item.relativePath}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
        ) : null}
      </div>

      <NotebookRuntimeCard runtime={runtime} />
    </div>
  )
}
