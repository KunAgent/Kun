import { useEffect, useRef, useState, type ReactElement } from 'react'
import {
  Check,
  ClipboardList,
  Columns3,
  Copy,
  ExternalLink,
  Loader2,
  PanelRightClose,
  RefreshCw,
  Save,
  ShieldCheck,
  TriangleAlert
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { WriteMarkdownEditor } from '../write/WriteMarkdownEditor'
import { WriteRichEditor } from '../../write/tiptap/WriteRichEditor'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { useChatStore } from '../../store/chat-store'
import {
  guiPlanMatchesContext,
  readRememberedGuiPlan,
  useGuiPlanStore
} from '../../plan/plan-store'
import { openWorkspacePathInEditor } from '../../lib/open-workspace-path'
import { sddDraftRelativePathForPlanPath } from '@shared/sdd'
import { useSddTrace } from '../../sdd/use-sdd-trace'
import type { PlanBuildOrchestration } from '../../plan/plan-build'
import { PlanBuildActions } from './PlanBuildActions'
import { useProjectBoardEnabled } from '../../project-board/use-project-board-enabled'

type Props = {
  workspaceRoot: string
  activeThreadId: string | null
  runtimeReady: boolean
  graphEnabled: boolean
  busy: boolean
  className?: string
  onCollapse: () => void
  onBuildPlan: (orchestration: PlanBuildOrchestration) => void
  onVerifyPlan?: () => void
  onReplanChanged?: (changedIds: string[]) => void
}

function normalizeWorkspaceRoot(value: string): string {
  return value.trim().replaceAll('\\', '/').replace(/\/+$/, '')
}

function statusLabelKey(saveStatus: string, operationStatus: string): string {
  if (operationStatus === 'drafting') return 'planStatusDrafting'
  if (operationStatus === 'refining') return 'planStatusRefining'
  if (operationStatus === 'building') return 'planStatusBuilding'
  if (operationStatus === 'error' || saveStatus === 'error') return 'planStatusError'
  if (saveStatus === 'saving') return 'planStatusSaving'
  if (saveStatus === 'dirty') return 'planStatusDirty'
  return 'planStatusSaved'
}

export function PlanPanel({
  workspaceRoot,
  activeThreadId,
  runtimeReady,
  graphEnabled,
  busy,
  className = '',
  onCollapse,
  onBuildPlan,
  onVerifyPlan,
  onReplanChanged
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const openBoard = useChatStore((state) => state.openBoard)
  const { enabled: projectBoardEnabled } = useProjectBoardEnabled()
  const {
    activePlan,
    content,
    saveStatus,
    operationStatus,
    error,
    setActivePlan,
    setContent,
    setSaveStatus,
    setSaveStatusForPlan,
    markSavedForPlan,
    setOperationStatus,
    clearActivePlan
  } = useGuiPlanStore(
    useShallow((s) => ({
      activePlan: s.activePlan,
      content: s.content,
      saveStatus: s.saveStatus,
      operationStatus: s.operationStatus,
      error: s.error,
      setActivePlan: s.setActivePlan,
      setContent: s.setContent,
      setSaveStatus: s.setSaveStatus,
      setSaveStatusForPlan: s.setSaveStatusForPlan,
      markSavedForPlan: s.markSavedForPlan,
      setOperationStatus: s.setOperationStatus,
      clearActivePlan: s.clearActivePlan
    }))
  )
  const {
    inlineCompletion,
    inlineCompletionApiReady,
    recentEdits,
    loadWriteSettings,
    setSelection,
    recordRecentEdits
  } = useWriteWorkspaceStore(
    useShallow((s) => ({
      inlineCompletion: s.inlineCompletion,
      inlineCompletionApiReady: s.inlineCompletionApiReady,
      recentEdits: s.recentEdits,
      loadWriteSettings: s.loadWriteSettings,
      setSelection: s.setSelection,
      recordRecentEdits: s.recordRecentEdits
    }))
  )

  useEffect(() => {
    void loadWriteSettings()
  }, [loadWriteSettings])

  useEffect(() => {
    const normalizedWorkspace = normalizeWorkspaceRoot(workspaceRoot)
    if (!normalizedWorkspace) {
      if (activePlan) {
        console.warn('[PlanPanel] clearing plan — workspace empty', { workspaceRoot, activePlan })
        clearActivePlan()
      }
      return
    }
    if (activePlan && guiPlanMatchesContext(activePlan, normalizedWorkspace, activeThreadId)) return
    const remembered = readRememberedGuiPlan(normalizedWorkspace, activeThreadId)
    if (!remembered) {
      if (activePlan) {
        console.warn('[PlanPanel] clearing plan — no match and no remembered', {
          normalizedWorkspace,
          activeThreadId,
          planWorkspace: activePlan.workspaceRoot,
          planThreadId: activePlan.threadId,
        })
        clearActivePlan()
      }
      return
    }
    let cancelled = false
    setOperationStatus('idle')
    void window.kunGui
      .readWorkspaceFile({
        workspaceRoot: normalizedWorkspace,
        path: remembered.relativePath
      })
      .then((result) => {
        if (cancelled) return
        if (!result.ok) {
          setOperationStatus('error', result.message)
          return
        }
        setActivePlan({ ...remembered, absolutePath: result.path }, result.content)
      })
      .catch((loadError) => {
        if (cancelled) return
        setOperationStatus(
          'error',
          loadError instanceof Error ? loadError.message : String(loadError)
        )
      })
    return () => {
      cancelled = true
    }
  }, [
    activePlan,
    activeThreadId,
    clearActivePlan,
    setActivePlan,
    setOperationStatus,
    workspaceRoot
  ])

  useEffect(() => {
    if (!activePlan || saveStatus !== 'dirty') return
    const timer = window.setTimeout(() => {
      const snapshot = useGuiPlanStore.getState()
      if (snapshot.activePlan?.id !== activePlan.id || snapshot.saveStatus !== 'dirty') return
      const contentToSave = snapshot.content
      const planId = activePlan.id
      const threadId = activePlan.threadId?.trim() || activeThreadId?.trim() || null
      setSaveStatusForPlan(planId, threadId, 'saving')
      void window.kunGui
        .writeWorkspaceFile({
          workspaceRoot: activePlan.workspaceRoot,
          path: activePlan.relativePath,
          content: contentToSave
        })
        .then(async (result) => {
          const latest = useGuiPlanStore.getState()
          if (latest.activePlan?.id !== activePlan.id) return
          if (!result.ok) {
            setSaveStatusForPlan(planId, threadId, 'error', result.message)
            return
          }
          if (latest.content === contentToSave) {
            if (threadId && runtimeReady) {
              const synced = await useChatStore.getState().syncPlanTodosFromMarkdown(threadId, activePlan, contentToSave)
              if (!synced) {
                setSaveStatusForPlan(planId, threadId, 'error', t('planTodoSyncFailed'))
                return
              }
            }
            markSavedForPlan(planId, threadId, contentToSave)
          } else {
            setSaveStatusForPlan(planId, threadId, 'dirty')
          }
        })
        .catch((saveError) => {
          setSaveStatusForPlan(
            planId,
            threadId,
            'error',
            saveError instanceof Error ? saveError.message : String(saveError)
          )
        })
    }, 650)
    return () => window.clearTimeout(timer)
  }, [
    activePlan,
    activeThreadId,
    content,
    markSavedForPlan,
    runtimeReady,
    saveStatus,
    setSaveStatusForPlan,
    t
  ])

  const readOnly =
    operationStatus === 'drafting' ||
    operationStatus === 'refining' ||
    operationStatus === 'building'
  const hasPlan = Boolean(activePlan)
  const canUseAgent =
    runtimeReady &&
    !busy &&
    saveStatus !== 'saving' &&
    hasPlan &&
    !readOnly
  const statusKey = statusLabelKey(saveStatus, operationStatus)

  const sddDraftRelativePath = activePlan
    ? sddDraftRelativePathForPlanPath(activePlan.relativePath)
    : null
  const trace = useSddTrace({
    workspaceRoot: activePlan?.workspaceRoot ?? '',
    draftRelativePath: sddDraftRelativePath
  })
  const traceCovered = trace
    ? trace.perRequirement.filter((entry) => entry.totalSteps > 0).length
    : 0
  const traceDriftIds = trace ? [...trace.changedIds, ...trace.addedIds] : []

  const openPlanFile = (): void => {
    if (!activePlan) return
    void openWorkspacePathInEditor(
      { path: activePlan.relativePath },
      activePlan.workspaceRoot
    )
  }

  const [copyPathStatus, setCopyPathStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const copyPathResetRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (copyPathResetRef.current !== null) window.clearTimeout(copyPathResetRef.current)
    },
    []
  )

  const handleCopyPath = async (): Promise<void> => {
    if (!activePlan) return
    try {
      if (!navigator?.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(activePlan.relativePath)
      setCopyPathStatus('success')
    } catch {
      setCopyPathStatus('error')
    }
    if (copyPathResetRef.current !== null) window.clearTimeout(copyPathResetRef.current)
    copyPathResetRef.current = window.setTimeout(() => {
      setCopyPathStatus('idle')
      copyPathResetRef.current = null
    }, 1600)
  }

  const copyPathLabel =
    copyPathStatus === 'success'
      ? t('copySuccess')
      : copyPathStatus === 'error'
        ? t('copyFailed')
        : t('planCopyPath')

  return (
    <aside
      className={`ds-sidebar-surface ds-no-drag flex min-h-0 flex-col border-l border-ds-border-muted ${className}`}
    >
      <div className="ds-sidebar-surface-chrome shrink-0 border-b border-ds-border-muted">
        <div className="flex h-12 min-w-0 items-center gap-2 px-4">
          {projectBoardEnabled ? (
            <button
              type="button"
              onClick={() => openBoard(activePlan?.workspaceRoot || workspaceRoot)}
              disabled={!activePlan}
              className="ds-sidebar-toggle-button shrink-0 disabled:cursor-not-allowed disabled:opacity-45"
              aria-label={t('projectBoardOpen')}
              title={t('projectBoardOpen')}
            >
              <Columns3 className="h-4 w-4" strokeWidth={1.9} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onCollapse}
            className="ds-sidebar-toggle-button shrink-0"
            aria-label={t('rightPanelCollapse')}
            title={t('rightPanelCollapse')}
          >
            <PanelRightClose className="h-4 w-4" strokeWidth={1.85} />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[12px] bg-ds-surface-subtle px-3 py-1.5 dark:bg-white/8">
            <ClipboardList className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.8} />
            <span className="min-w-0 truncate text-[13px] font-medium text-ds-ink">
              {activePlan?.featureName || t('planPanelTitle')}
            </span>
          </div>
          <button
            type="button"
            onClick={openPlanFile}
            disabled={!activePlan}
            className="ds-sidebar-toggle-button shrink-0 disabled:cursor-not-allowed disabled:opacity-45"
            aria-label={t('planOpenFile')}
            title={t('planOpenFile')}
          >
            <ExternalLink className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 px-4 pb-3">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full border border-ds-border-muted bg-ds-surface-subtle px-3 py-1.5 text-[11.5px] font-medium text-ds-muted dark:bg-white/6">
            <span className="min-w-0 flex-1 truncate">
              {activePlan?.relativePath ?? t('planNoActiveFile')}
            </span>
            {activePlan ? (
              <button
                type="button"
                onClick={() => void handleCopyPath()}
                className={`shrink-0 rounded-full p-0.5 transition hover:text-accent ${
                  copyPathStatus === 'success'
                    ? 'text-emerald-500'
                    : copyPathStatus === 'error'
                      ? 'text-rose-400'
                      : 'text-ds-faint'
                }`}
                aria-label={copyPathLabel}
                title={copyPathLabel}
              >
                {copyPathStatus === 'success' ? (
                  <Check className="h-3 w-3" strokeWidth={2} />
                ) : (
                  <Copy className="h-3 w-3" strokeWidth={1.8} />
                )}
              </button>
            ) : null}
          </div>
          <div className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-ds-border-muted bg-ds-card px-2.5 py-1.5 text-[11.5px] font-medium text-ds-muted">
            {saveStatus === 'saving' || operationStatus === 'drafting' || operationStatus === 'refining' || operationStatus === 'building' ? (
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
            ) : (
              <Save className="h-3 w-3" strokeWidth={1.85} />
            )}
            <span>{t(statusKey)}</span>
          </div>
        </div>
        {trace && trace.blocks.length > 0 ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2 px-4 pb-3">
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 text-[11.5px] font-semibold text-accent">
              {t('planCoverageLabel', { covered: traceCovered, total: trace.blocks.length })}
            </span>
            {trace.uncoveredIds.length > 0 ? (
              <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-amber-500/12 px-2.5 py-1 text-[11.5px] font-semibold text-amber-700 dark:text-amber-300">
                <TriangleAlert className="h-3 w-3 shrink-0" strokeWidth={2} />
                <span className="truncate">
                  {t('planCoverageUncovered', { ids: trace.uncoveredIds.join(', ') })}
                </span>
              </span>
            ) : null}
            {onVerifyPlan ? (
              <button
                type="button"
                onClick={onVerifyPlan}
                disabled={!canUseAgent}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-ds-border-muted bg-ds-card px-2.5 py-1 text-[11.5px] font-semibold text-ds-ink transition hover:border-accent/30 hover:text-accent disabled:cursor-not-allowed disabled:opacity-45"
              >
                <ShieldCheck className="h-3 w-3" strokeWidth={2} />
                {busy ? t('planVerifyRunning') : t('planVerify')}
              </button>
            ) : null}
            {traceDriftIds.length > 0 ? (
              <div className="flex min-w-0 flex-1 basis-full items-center gap-2 rounded-xl border border-amber-200/80 bg-amber-50/90 px-3 py-1.5 text-[11.5px] text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/35 dark:text-amber-100">
                <TriangleAlert className="h-3 w-3 shrink-0" strokeWidth={2} />
                <span className="min-w-0 flex-1 truncate">
                  {t('sddChangedBanner', { ids: traceDriftIds.join(', ') })}
                </span>
                {onReplanChanged ? (
                  <button
                    type="button"
                    onClick={() => onReplanChanged(traceDriftIds)}
                    disabled={busy || readOnly}
                    className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 font-semibold transition hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <RefreshCw className="h-3 w-3" strokeWidth={2} />
                    {t('sddReplanButton')}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="ds-sidebar-surface-body min-h-0 flex-1 overflow-hidden">
        {!normalizeWorkspaceRoot(workspaceRoot) ? (
          <div className="flex h-full items-center justify-center px-5 text-center text-[13.5px] leading-6 text-ds-muted">
            {t('planNoWorkspace')}
          </div>
        ) : !hasPlan ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10 text-accent">
              <ClipboardList className="h-5 w-5" strokeWidth={1.9} />
            </div>
            <div className="mt-4 text-[16px] font-semibold text-ds-ink">{t('planEmptyTitle')}</div>
            <p className="mt-2 max-w-[22rem] text-[13px] leading-6 text-ds-muted">
              {t('planEmptySub')}
            </p>
          </div>
        ) : (
          <div className="flex h-full min-h-0 min-w-0 flex-col">
            <div className="ds-sidebar-surface-body min-h-0 min-w-0 flex-1">
              <WriteRichEditor
                value={content}
                workspaceRoot={activePlan!.workspaceRoot}
                filePath={activePlan!.absolutePath ?? activePlan!.relativePath}
                readOnly={readOnly}
                completionModel={inlineCompletion.model}
                completionEnabled={inlineCompletion.enabled && inlineCompletionApiReady}
                completionDebounceMs={inlineCompletion.debounceMs}
                completionMinAcceptScore={inlineCompletion.minAcceptScore}
                completionLongEnabled={inlineCompletion.longCompletionEnabled}
                completionLongDebounceMs={inlineCompletion.longDebounceMs}
                completionLongMinAcceptScore={inlineCompletion.longMinAcceptScore}
                recentEdits={recentEdits}
                onChange={setContent}
                onDocumentEdit={recordRecentEdits}
                onSelectionChange={setSelection}
                onSaveShortcut={() => {
                  const snapshot = useGuiPlanStore.getState()
                  if (snapshot.activePlan?.id === activePlan!.id && snapshot.saveStatus === 'dirty') {
                    setSaveStatus('dirty')
                  }
                }}
                onImagePasteSaved={() => {
                  setOperationStatus('idle')
                }}
                onImagePasteError={(message) => setOperationStatus('error', message)}
                fallback={
                  <WriteMarkdownEditor
                    value={content}
                    workspaceRoot={activePlan!.workspaceRoot}
                    filePath={activePlan!.absolutePath ?? activePlan!.relativePath}
                    appearance="live"
                    livePreviewEnabled
                    readOnly={readOnly}
                    completionModel={inlineCompletion.model}
                    completionEnabled={inlineCompletion.enabled && inlineCompletionApiReady}
                    completionDebounceMs={inlineCompletion.debounceMs}
                    completionMinAcceptScore={inlineCompletion.minAcceptScore}
                    completionLongEnabled={inlineCompletion.longCompletionEnabled}
                    completionLongDebounceMs={inlineCompletion.longDebounceMs}
                    completionLongMinAcceptScore={inlineCompletion.longMinAcceptScore}
                    recentEdits={recentEdits}
                    onChange={setContent}
                    onDocumentEdit={recordRecentEdits}
                    onSelectionChange={setSelection}
                    onSaveShortcut={() => {
                      const snapshot = useGuiPlanStore.getState()
                      if (snapshot.activePlan?.id === activePlan!.id && snapshot.saveStatus === 'dirty') {
                        setSaveStatus('dirty')
                      }
                    }}
                    onImagePasteSaved={() => {
                      setOperationStatus('idle')
                    }}
                    onImagePasteError={(message) => setOperationStatus('error', message)}
                  />
                }
              />
            </div>
          </div>
        )}
      </div>

      {hasPlan ? (
        <div className="ds-sidebar-surface-chrome relative shrink-0 border-t border-ds-border-muted px-3 pb-2 pt-1.5">
          {error ? (
            <div className="mb-2 rounded-lg border border-red-300/70 bg-red-500/10 px-3 py-2 text-[12px] leading-5 text-red-700 dark:border-red-800/60 dark:text-red-300">
              {error}
            </div>
          ) : null}
          <p className="mb-2 px-1 text-[11px] leading-5 text-ds-muted">{t('planRefineHint')}</p>
          <PlanBuildActions
            disabled={!canUseAgent}
            graphEnabled={graphEnabled}
            variant="panel"
            planId={activePlan!.id}
            onBuild={onBuildPlan}
          />
        </div>
      ) : null}
    </aside>
  )
}
