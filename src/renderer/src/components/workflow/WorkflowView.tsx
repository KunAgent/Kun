import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil, Play, Plus, Power, Trash2, Workflow as WorkflowIcon } from 'lucide-react'
import {
  mergeWorkflowSettings,
  normalizeWorkflowSettings,
  type AppSettingsV1,
  type WorkflowNodePresetV1,
  type WorkflowNodeRunResultV1,
  type WorkflowNodeV1,
  type WorkflowRuntimeStatus,
  type WorkflowV1
} from '@shared/app-settings'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { confirmDialog } from '../../lib/confirm-dialog'
import { SidebarTitlebarToggleButton } from '../sidebar/SidebarPrimitives'
import { WorkflowEditorView } from './WorkflowEditorView'
import { createWorkflow } from './workflow-types'

type Props = {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  onOpenThread?: (threadId: string) => void
}

const EMPTY_WORKFLOWS: WorkflowV1[] = []
const EMPTY_PRESETS: WorkflowNodePresetV1[] = []

function statusTone(status: WorkflowV1['lastStatus']): string {
  if (status === 'running') return 'bg-amber-500/15 text-amber-900 dark:text-amber-100'
  if (status === 'success') return 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-100'
  if (status === 'error') return 'bg-red-500/15 text-red-700 dark:text-red-100'
  return 'bg-ds-subtle text-ds-muted'
}

function formatDateTime(value: string, fallback: string): string {
  if (!value.trim()) return fallback
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : fallback
}

export function WorkflowView({ leftSidebarCollapsed, onToggleLeftSidebar }: Props): ReactElement {
  const { t } = useTranslation('common')
  const [settings, setSettings] = useState<AppSettingsV1 | null>(null)
  const [status, setStatus] = useState<WorkflowRuntimeStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  const refreshStatus = useCallback(async (): Promise<void> => {
    if (typeof window.kunGui?.getWorkflowStatus !== 'function') return
    try {
      setStatus(await window.kunGui.getWorkflowStatus())
    } catch {
      /* ignore transient status errors */
    }
  }, [])

  const load = useCallback(async (): Promise<void> => {
    try {
      const [nextSettings, nextStatus] = await Promise.all([
        rendererRuntimeClient.getSettings({ forceRefresh: true }),
        typeof window.kunGui?.getWorkflowStatus === 'function'
          ? window.kunGui.getWorkflowStatus()
          : Promise.resolve(null)
      ])
      setSettings(nextSettings)
      setStatus(nextStatus)
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => void refreshStatus(), 5_000)
    return () => window.clearInterval(id)
  }, [load, refreshStatus])

  const workflowSettings = settings ? normalizeWorkflowSettings(settings.workflow) : null
  const workflows = workflowSettings?.workflows ?? EMPTY_WORKFLOWS
  const presets = workflowSettings?.presets ?? EMPTY_PRESETS
  const runningIds = useMemo(() => new Set(status?.runningWorkflowIds ?? []), [status])

  const persistPresets = useCallback(
    async (nextPresets: WorkflowNodePresetV1[]): Promise<void> => {
      if (!settings) return
      const nextWorkflow = mergeWorkflowSettings(settings.workflow, { presets: nextPresets })
      setSettings({ ...settings, workflow: nextWorkflow })
      const saved = await rendererRuntimeClient.setSettings({ workflow: nextWorkflow })
      setSettings(saved)
    },
    [settings]
  )

  const handleSavePreset = useCallback(
    (preset: WorkflowNodePresetV1): Promise<void> => persistPresets([...presets, preset]),
    [persistPresets, presets]
  )

  const handleDeletePreset = useCallback(
    (presetId: string): Promise<void> => persistPresets(presets.filter((preset) => preset.id !== presetId)),
    [persistPresets, presets]
  )

  const persist = useCallback(
    async (nextWorkflows: WorkflowV1[]): Promise<void> => {
      if (!settings) return
      const nextWorkflow = mergeWorkflowSettings(settings.workflow, { enabled: true, workflows: nextWorkflows })
      setSettings({ ...settings, workflow: nextWorkflow })
      const saved = await rendererRuntimeClient.setSettings({ workflow: nextWorkflow })
      setSettings(saved)
      void refreshStatus()
    },
    [refreshStatus, settings]
  )

  const handleCreate = useCallback(async (): Promise<void> => {
    const created = createWorkflow(t('workflowUntitled'))
    await persist([...workflows, created])
    setEditingId(created.id)
  }, [persist, t, workflows])

  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      if (!(await confirmDialog(t('workflowDeleteConfirm')))) return
      await persist(workflows.filter((workflow) => workflow.id !== id))
    },
    [persist, t, workflows]
  )

  const handleToggleEnabled = useCallback(
    async (id: string, enabled: boolean): Promise<void> => {
      await persist(
        workflows.map((workflow) =>
          workflow.id === id ? { ...workflow, enabled, updatedAt: new Date().toISOString() } : workflow
        )
      )
    },
    [persist, workflows]
  )

  const handleRun = useCallback(
    async (id: string): Promise<void> => {
      if (typeof window.kunGui?.runWorkflow !== 'function') return
      const result = await window.kunGui.runWorkflow(id)
      if (!result.ok) {
        setError(result.message)
        return
      }
      setError(null)
      void refreshStatus()
    },
    [refreshStatus]
  )

  const handleStop = useCallback(
    async (id: string): Promise<void> => {
      if (typeof window.kunGui?.stopWorkflow !== 'function') return
      await window.kunGui.stopWorkflow(id)
      void refreshStatus()
    },
    [refreshStatus]
  )

  const handleRunNode = useCallback(
    async (workflowId: string, nodeId: string): Promise<void> => {
      if (typeof window.kunGui?.runWorkflowNode !== 'function') return
      const result = await window.kunGui.runWorkflowNode(workflowId, nodeId)
      if (!result.ok) {
        setError(result.message)
        return
      }
      setError(null)
      void refreshStatus()
    },
    [refreshStatus]
  )

  const handleEditorPersist = useCallback(
    async (patch: {
      name: string
      enabled: boolean
      nodes: WorkflowNodeV1[]
      connections: WorkflowV1['connections']
    }): Promise<void> => {
      if (!editingId) return
      await persist(
        workflows.map((workflow) =>
          workflow.id === editingId
            ? { ...workflow, ...patch, updatedAt: new Date().toISOString() }
            : workflow
        )
      )
    },
    [editingId, persist, workflows]
  )

  const editingWorkflow = editingId ? workflows.find((workflow) => workflow.id === editingId) ?? null : null

  if (editingWorkflow && settings) {
    const lastRun = editingWorkflow.runs[editingWorkflow.runs.length - 1]
    const lastResults: Record<string, WorkflowNodeRunResultV1> = {}
    if (lastRun) {
      for (const result of lastRun.nodeResults) lastResults[result.nodeId] = result
    }
    return (
      <WorkflowEditorView
        key={editingWorkflow.id}
        workflow={editingWorkflow}
        settings={settings}
        runStatus={status?.nodeStatus[editingWorkflow.id] ?? {}}
        lastResults={lastResults}
        running={runningIds.has(editingWorkflow.id)}
        onPersist={handleEditorPersist}
        onRun={() => handleRun(editingWorkflow.id)}
        onRunNode={(nodeId) => handleRunNode(editingWorkflow.id, nodeId)}
        onStop={() => handleStop(editingWorkflow.id)}
        onBack={() => setEditingId(null)}
        presets={presets}
        onSavePreset={handleSavePreset}
        onDeletePreset={handleDeletePreset}
      />
    )
  }

  return (
    <div className="ds-drag flex h-full min-h-0 flex-col bg-ds-main">
      <div className="ds-stage-inset shrink-0">
        <header className="ds-topbar-surface relative z-10 mt-3 flex min-h-[46px] w-full items-stretch overflow-visible rounded-[24px]">
          <div className="grid w-full min-w-0 items-center gap-2.5 px-3 py-2 sm:px-4 md:pl-5 md:pr-2">
            <div
              className={`flex min-w-0 items-center gap-2.5 ${
                leftSidebarCollapsed ? 'ds-window-controls-safe-inset' : ''
              }`}
            >
              <SidebarTitlebarToggleButton
                onClick={onToggleLeftSidebar}
                title={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
                ariaLabel={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
              />
              <h1 className="min-w-0 flex-1 truncate text-[15px] font-medium text-ds-muted">
                {t('workflow')}
              </h1>
            </div>
          </div>
        </header>
      </div>

      <main className="ds-no-drag min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-8">
        <div className="mx-auto flex w-full max-w-[880px] flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[14px] leading-6 text-ds-faint">{t('workflowSubtitle')}</p>
            <button
              type="button"
              onClick={() => void handleCreate()}
              className="inline-flex items-center gap-2 rounded-xl bg-ds-userbubble px-4 py-2 text-[13px] font-semibold text-ds-userbubbleFg shadow-sm transition hover:opacity-90"
            >
              <Plus className="h-4 w-4" strokeWidth={2} />
              {t('workflowNew')}
            </button>
          </div>

          {error ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-[13px] text-red-700 dark:text-red-200">
              {error}
            </div>
          ) : null}

          {loading ? (
            <p className="text-[13px] text-ds-faint">{t('loading')}</p>
          ) : workflows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-ds-border px-6 py-16 text-center">
              <WorkflowIcon className="h-8 w-8 text-ds-faint" strokeWidth={1.5} />
              <p className="text-[14px] font-medium text-ds-ink">{t('workflowEmpty')}</p>
              <p className="max-w-[360px] text-[13px] text-ds-faint">{t('workflowEmptyHint')}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {workflows.map((workflow) => {
                const running = runningIds.has(workflow.id)
                const lastStatus: WorkflowV1['lastStatus'] = running ? 'running' : workflow.lastStatus
                return (
                  <div
                    key={workflow.id}
                    className="flex flex-col gap-3 rounded-2xl border border-ds-border bg-ds-card px-4 py-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-[15px] font-semibold text-ds-ink">
                            {workflow.name || t('workflowUntitled')}
                          </h3>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusTone(lastStatus)}`}>
                            {t(`workflowStatus_${lastStatus}`)}
                          </span>
                        </div>
                        <p className="mt-1 text-[12px] text-ds-faint">
                          {t('workflowNodeCount', { count: workflow.nodes.length })} ·{' '}
                          {t('workflowLastRun')}: {formatDateTime(workflow.lastRunAt, t('workflowNeverRun'))}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void handleToggleEnabled(workflow.id, !workflow.enabled)}
                          className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition ${
                            workflow.enabled
                              ? 'border-accent/40 bg-accent/10 text-accent'
                              : 'border-ds-border text-ds-muted hover:bg-ds-hover'
                          }`}
                          title={t('workflowEnabled')}
                          aria-label={t('workflowEnabled')}
                        >
                          <Power className="h-4 w-4" strokeWidth={1.8} />
                        </button>
                        <button
                          type="button"
                          onClick={() => (running ? void handleStop(workflow.id) : void handleRun(workflow.id))}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-ds-border bg-ds-card px-3 text-[12.5px] font-medium text-ds-ink transition hover:bg-ds-hover"
                        >
                          <Play className="h-3.5 w-3.5" strokeWidth={1.9} />
                          {t('workflowRunNow')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(workflow.id)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-ds-border text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                          title={t('workflowEdit')}
                          aria-label={t('workflowEdit')}
                        >
                          <Pencil className="h-4 w-4" strokeWidth={1.8} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(workflow.id)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-ds-border text-ds-muted transition hover:bg-red-500/10 hover:text-red-600"
                          title={t('workflowDelete')}
                          aria-label={t('workflowDelete')}
                        >
                          <Trash2 className="h-4 w-4" strokeWidth={1.8} />
                        </button>
                      </div>
                    </div>
                    {workflow.lastMessage.trim() ? (
                      <p className="rounded-lg bg-ds-subtle px-3 py-2 text-[12.5px] text-ds-muted">
                        <span className="font-medium text-ds-faint">{t('workflowLastResult')}: </span>
                        {workflow.lastMessage.length > 240
                          ? `${workflow.lastMessage.slice(0, 240)}…`
                          : workflow.lastMessage}
                      </p>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
