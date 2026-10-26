import { useMemo, type ReactElement } from 'react'
import type { AgentDispatchAssignmentRoute } from '@shared/agent-dispatch'
import { useChatStore } from '../../store/chat-store'
import { useHarnessStore } from '../../store/harness-store'
import { effectiveHarnessId } from '../../lib/ade-composer-harness'
import { resolvePlanBuildRoute, usePlanBuildAgentStore } from '../../plan/plan-build-agent-store'
import { AgentDispatchRoutePicker } from '../chat/AgentDispatchRoutePicker'

export type PlanBuildRouteInfo = {
  route: AgentDispatchAssignmentRoute
  external: boolean
  agentName: string
}

/** The Agent a build of this plan runs on: the card's pick, else the composer's Agent. */
export function usePlanBuildRoute(planId: string): PlanBuildRouteInfo {
  const picked = usePlanBuildAgentStore((state) => (planId ? state.plans[planId] : undefined))
  const composerHarnessId = useChatStore((state) => state.composerHarnessId)
  const composerModel = useChatStore((state) => state.composerModel)
  const composerProviderId = useChatStore((state) => state.composerProviderId)
  const composerCredentialMode = useChatStore((state) => state.composerCredentialMode)
  const threadHarnessId = useChatStore((state) => {
    const id = state.activeThreadId
    if (!id) return undefined
    return (state.threads.find((thread) => thread.id === id) ??
      (state.adeThreads ?? []).find((thread) => thread.id === id))?.harnessId
  })
  const route = useMemo(() => resolvePlanBuildRoute(picked, {
    harnessId: effectiveHarnessId(composerHarnessId, threadHarnessId),
    model: composerModel,
    providerId: composerProviderId,
    credentialMode: composerCredentialMode
  }), [picked, composerHarnessId, threadHarnessId, composerModel, composerProviderId, composerCredentialMode])
  const rowName = useHarnessStore((state) =>
    state.rows.find((row) => row.definition.id === route.agentId)?.definition.displayName)
  const external = route.agentId !== 'kun'
  return { route, external, agentName: rowName || (external ? route.agentId : 'Kun') }
}

/** Agent + model chooser for a plan build; the pick is remembered per plan. */
export function PlanBuildAgentPicker({ planId, route, disabled }: {
  planId: string
  route: AgentDispatchAssignmentRoute
  disabled: boolean
}): ReactElement {
  const setRoute = usePlanBuildAgentStore((state) => state.setRoute)
  return (
    <div data-plan-build-agent={route.agentId} className="flex min-w-0 items-center">
      <AgentDispatchRoutePicker route={route} disabled={disabled}
        onChange={(next) => setRoute(planId, next)} />
    </div>
  )
}
