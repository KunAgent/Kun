import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppSettingsV1, ScheduleReasoningEffort, ScheduledTaskV1 } from '@shared/app-settings'
import type { ScheduledTaskHarnessV1 } from '@shared/schedule-task-harness'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { threadHasIsolatedWorkspace } from '../../lib/thread-workspace-owner'
import { useChatStore } from '../../store/chat-store'
import { preparePlanBuild } from '../../plan/prepare-plan-build'
import { activePlanScheduledTask, scheduledTaskTime, startedPlanScheduledHandoff } from '../../plan/plan-scheduled-task'
import { planBuildReasoningEffort, usePlanBuildAgentStore, type PlanBuildRoute } from '../../plan/plan-build-agent-store'
import { ensureGuiPlanLoadedFromMeta } from '../../plan/load-plan-from-meta'
import { guiPlanMetaMatchesArtifact, type GuiPlanToolMeta } from '../../plan/plan-tool'
import { useGuiPlanStore } from '../../plan/plan-store'
import { usePlanWorktreePreferenceStore } from '../../plan/plan-worktree-preference-store'

export type ScheduleDraft = {
  providerId: string
  model: string
  reasoningEffort: ScheduleReasoningEffort
  mode: 'agent'
  schedule: { kind: 'at'; atTime: string; timeZone: string }
}

const SCHEDULE_EFFORTS: readonly string[] = ['auto', 'off', 'low', 'medium', 'high', 'max']

/** Card route → the scheduled task's external Agent; Kun builds carry none. */
function scheduleHarness(route: PlanBuildRoute): ScheduledTaskHarnessV1 | undefined {
  if (route.agentId === 'kun') return undefined
  const effort = planBuildReasoningEffort(route)
  return {
    id: route.agentId,
    ...(route.credentialMode ? { credentialMode: route.credentialMode } : {}),
    ...(route.providerId ? { providerId: route.providerId } : {}),
    ...(route.model ? { model: route.model } : {}),
    ...(effort ? { reasoningEffort: effort } : {})
  }
}

/** Kun builds follow the card's model and level in the schedule too. */
export function scheduleExecutorForRoute(route: PlanBuildRoute, label: string): {
  label: string; providerId?: string; model?: string; reasoningEffort?: ScheduleReasoningEffort
} {
  if (route.agentId !== 'kun') return { label }
  const effort = route.reasoningEffort === 'xhigh' ? 'max' : route.reasoningEffort
  return {
    label,
    ...(route.providerId ? { providerId: route.providerId } : {}),
    ...(route.model ? { model: route.model } : {}),
    ...(effort && SCHEDULE_EFFORTS.includes(effort) ? { reasoningEffort: effort as ScheduleReasoningEffort } : {})
  }
}

/**
 * Scheduled build state for one plan card: the persisted task, its dialog,
 * and the handoff a scheduled external run opened (mirrored onto the card).
 */
export function usePlanBuildSchedule(input: {
  planId: string
  planMeta?: GuiPlanToolMeta
  graphEnabled: boolean
  route: PlanBuildRoute
  agentName: string
}) {
  const { planId, planMeta, graphEnabled, route, agentName } = input
  const { t } = useTranslation('common')
  const [settings, setSettings] = useState<AppSettingsV1 | null>(null)
  const [scheduledTask, setScheduledTask] = useState<ScheduledTaskV1 | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [scheduleError, setScheduleError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [nowMs, setNowMs] = useState(Date.now())
  const planIdRef = useRef(planId)
  planIdRef.current = planId

  const refreshSchedule = useCallback(async (): Promise<void> => {
    if (!planId) {
      setScheduledTask(null)
      return
    }
    try {
      const next = await rendererRuntimeClient.getSettings({ forceRefresh: true })
      if (planIdRef.current !== planId) return
      setSettings(next)
      setScheduledTask(activePlanScheduledTask(next.schedule.tasks, planId))
      const started = startedPlanScheduledHandoff(next.schedule.tasks, planId)
      const store = usePlanBuildAgentStore.getState()
      const current = store.handoffs[planId]
      const startedAt = Date.parse(started?.task.lastRunAt ?? '') || Date.now()
      if (started?.task.harness && current?.threadId !== started.threadId && (current?.startedAt ?? 0) < startedAt) {
        const { id, reasoningEffort, ...rest } = started.task.harness
        store.setHandoff(planId, {
          threadId: started.threadId,
          route: { agentId: id, ...rest, ...(reasoningEffort ? { reasoningEffort } : {}) } as PlanBuildRoute,
          planTitle: started.task.title,
          startedAt
        })
      }
    } catch (error) {
      useChatStore.getState().setError(error instanceof Error ? error.message : String(error))
    }
  }, [planId])

  useEffect(() => { void refreshSchedule() }, [refreshSchedule])

  useEffect(() => {
    const onFocus = (): void => { void refreshSchedule() }
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') void refreshSchedule()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refreshSchedule])

  useEffect(() => {
    if (!scheduledTask) return
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [scheduledTask])

  const taskTime = scheduledTask ? scheduledTaskTime(scheduledTask) : ''
  const hasActiveSchedule = Boolean(taskTime && Date.parse(taskTime) > nowMs)

  useEffect(() => {
    if (scheduledTask && !hasActiveSchedule) void refreshSchedule()
  }, [hasActiveSchedule, refreshSchedule, scheduledTask])

  const openSchedule = async (task: ScheduledTaskV1 | null): Promise<void> => {
    setScheduleError('')
    try {
      setSettings(await rendererRuntimeClient.getSettings({ forceRefresh: true }))
      setScheduledTask(task)
      setDialogOpen(true)
    } catch (error) {
      useChatStore.getState().setError(error instanceof Error ? error.message : String(error))
    }
  }

  const cancelSchedule = async (): Promise<void> => {
    if (!scheduledTask) return
    setSubmitting(true)
    try {
      const result = await window.kunGui.deleteScheduleTask(scheduledTask.id)
      if (!result.ok) throw new Error(result.message)
      setScheduledTask(null)
      await refreshSchedule()
    } catch (error) {
      useChatStore.getState().setError(error instanceof Error ? error.message : String(error))
    } finally {
      setSubmitting(false)
    }
  }

  const submitSchedule = async (draft: ScheduleDraft): Promise<void> => {
    // The card can outlive the plan store entry (app restart, another
    // thread's plan taking over): reload the plan from its create_plan
    // meta instead of silently dropping the submission.
    if (planMeta) {
      const current = useGuiPlanStore.getState().activePlan
      if (!current || !guiPlanMetaMatchesArtifact(planMeta, current)) {
        await ensureGuiPlanLoadedFromMeta(planMeta)
      }
    }
    const planState = useGuiPlanStore.getState()
    const plan = planState.activePlan
    if (!plan || (planMeta ? !guiPlanMetaMatchesArtifact(planMeta, plan) : plan.id !== planId)) {
      setScheduleError(t('planLoadFailed'))
      return
    }
    const harness = scheduleHarness(route)
    setSubmitting(true)
    setScheduleError('')
    try {
      if (scheduledTask) {
        const result = await window.kunGui.updateScheduleTask({
          taskId: scheduledTask.id,
          providerId: draft.providerId,
          model: draft.model,
          reasoningEffort: draft.reasoningEffort,
          ...(harness ? { harness } : {}),
          schedule: draft.schedule
        })
        if (!result.ok) throw new Error(result.message)
        setScheduledTask(result.task)
      } else {
        const activeThreadId = useChatStore.getState().activeThreadId
        const selectedPreference = usePlanWorktreePreferenceStore.getState().plans[plan.id]
        const prepared = await preparePlanBuild({
          plan,
          content: planState.content,
          orchestration: 'direct',
          graphEnabled,
          usePromptWorktree: !harness && selectedPreference?.usePromptWorktree === true,
          workspaceAlreadyIsolated: threadHasIsolatedWorkspace(useChatStore.getState(), activeThreadId),
          usePromptWorktreeExplicit: selectedPreference?.overridden,
          branchPrefix: selectedPreference?.branchPrefix ?? 'codex/',
          activeThreadId,
          save: async (target, content) => {
            const result = await window.kunGui.writeWorkspaceFile({ workspaceRoot: target.workspaceRoot, path: target.relativePath, content })
            if (result.ok && useGuiPlanStore.getState().activePlan?.id === target.id) useGuiPlanStore.getState().markSaved(content)
            return result.ok
          },
          currentPlanId: () => useGuiPlanStore.getState().activePlan?.id,
          currentThreadId: () => useChatStore.getState().activeThreadId,
          getGitBranches: window.kunGui.getGitBranches,
          ...(harness ? { taskWorktreeAgentName: agentName } : {})
        })
        const result = await window.kunGui.createScheduleTask({
          ...draft,
          // An external handoff opens its own conversation instead of reusing this one.
          ...(activeThreadId && !harness ? { sourceThreadId: activeThreadId } : {}),
          sourcePlanId: prepared.planId,
          title: prepared.title,
          prompt: prepared.prompt,
          workspaceRoot: prepared.workspaceRoot,
          orchestration: 'direct',
          ...(harness ? { harness } : {})
        })
        if (!result.ok) throw new Error(result.message)
        setScheduledTask(result.task)
      }
      setDialogOpen(false)
      await refreshSchedule()
    } catch (error) {
      setScheduleError(error instanceof Error ? error.message : String(error))
    } finally {
      setSubmitting(false)
    }
  }

  return {
    settings, scheduledTask, taskTime, hasActiveSchedule, nowMs,
    dialogOpen, setDialogOpen, scheduleError, submitting,
    openSchedule, submitSchedule, cancelSchedule
  }
}
