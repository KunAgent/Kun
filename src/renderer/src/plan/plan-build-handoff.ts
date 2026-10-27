import type { AdeHarnessRow } from '@shared/ade-harnesses'
import { harnessConnectionPresentation } from '../lib/harness-connection-presentation'
import { accountIdForComposerSelection, readThreadComposerSelection } from '../store/chat-store-helpers'
import { harnessRowRunsTurns, harnessRowUnavailableCode } from '../store/harness-store'
import type { ChatState } from '../store/chat-store-types'
import { usePlanBuildAgentStore, planBuildReasoningEffort, type PlanBuildRoute } from './plan-build-agent-store'
import type { PreparedPlanBuild } from './prepare-plan-build'
import type { GuiPlanArtifact } from './plan-store'

type Translate = (key: string, options?: Record<string, unknown>) => string

/**
 * Why an external Agent cannot take a plan right now, checked before any
 * conversation or worktree exists so a refusal leaves nothing behind.
 */
export function planBuildHandoffBlocker(
  agentId: string,
  rows: readonly AdeHarnessRow[],
  t: Translate
): string | null {
  // Before discovery lands nothing is known; the runtime still refuses a bad route.
  if (rows.length === 0) return null
  const row = rows.find((entry) => entry.definition.id === agentId)
  if (!row) return t('planBuildHandoffAgentMissing', { agent: agentId })
  const agent = row.definition.displayName
  if (!harnessRowRunsTurns(row)) return t('planBuildHandoffAgentMissing', { agent })
  const code = harnessRowUnavailableCode(row)
  if (!code) return null
  if (code === 'detecting') return t('planBuildHandoffAgentDetecting', { agent })
  const { labelKey } = harnessConnectionPresentation(row)
  return t('planBuildHandoffAgentNotReady', { agent, reason: labelKey ? t(labelKey) : code })
}

/**
 * Model route for an external build: the plan card's pick wins, then the
 * composer when it names this Agent, then the source thread's remembered pick.
 */
export function externalPlanBuildRoute(input: {
  agentId: string
  picked: PlanBuildRoute | undefined
  chatState: Pick<ChatState, 'activeThreadId' | 'composerHarnessId' | 'composerModel' | 'composerProviderId' |
    'composerCredentialMode' | 'composerModelGroups' | 'composerReasoningEffort'>
}): PlanBuildRoute & { accountId?: string } {
  const { agentId, picked, chatState } = input
  if (picked) return picked
  if (chatState.composerHarnessId.trim()) {
    const model = chatState.composerModel
    const providerId = chatState.composerProviderId
    const accountId = accountIdForComposerSelection(chatState.composerModelGroups, providerId, model)
    return {
      agentId,
      ...(model ? { model } : {}),
      ...(providerId ? { providerId } : {}),
      ...(chatState.composerCredentialMode ? { credentialMode: chatState.composerCredentialMode as PlanBuildRoute['credentialMode'] } : {}),
      ...(chatState.composerReasoningEffort ? { reasoningEffort: chatState.composerReasoningEffort } : {}),
      ...(accountId ? { accountId } : {})
    }
  }
  const remembered = chatState.activeThreadId ? readThreadComposerSelection(chatState.activeThreadId) : null
  if (remembered?.harnessId !== agentId) return { agentId }
  return {
    agentId,
    ...(remembered.model ? { model: remembered.model } : {}),
    ...(remembered.providerId ? { providerId: remembered.providerId } : {}),
    ...(remembered.credentialMode ? { credentialMode: remembered.credentialMode as PlanBuildRoute['credentialMode'] } : {})
  }
}

/**
 * Hand a prepared plan to an external Agent: a fresh conversation bound to a
 * host task worktree. Success records the handoff (persisted, so the card and
 * the build conversation keep it across restarts); failure stays on the card.
 */
export async function handOffPlanBuild(input: {
  plan: GuiPlanArtifact
  prepared: PreparedPlanBuild
  route: PlanBuildRoute & { accountId?: string }
  displayText: string
  chatState: ChatState
  getChatState: () => ChatState
  t: Translate
}): Promise<boolean> {
  const { plan, prepared, route, chatState } = input
  const store = usePlanBuildAgentStore.getState()
  const effort = planBuildReasoningEffort(route)
  const sourceThreadId = chatState.activeThreadId
  const dispatched = await chatState.dispatchExternalPlanBuild({
    prompt: prepared.prompt,
    displayText: input.displayText,
    title: prepared.title,
    workspaceRoot: prepared.workspaceRoot,
    harnessId: route.agentId,
    credentialMode: route.credentialMode ?? '',
    model: route.model ?? '',
    providerId: route.providerId ?? '',
    ...(route.accountId ? { accountId: route.accountId } : {}),
    ...(effort ? { reasoningEffort: effort } : {})
  })
  const after = input.getChatState()
  if (!dispatched) {
    store.setFailure(plan.id, {
      agentId: route.agentId,
      message: after.error || input.t('planBuildHandoffFailed')
    })
    after.setError(null)
    return false
  }
  if (after.activeThreadId) {
    const { accountId: _account, ...persisted } = route
    store.setHandoff(plan.id, {
      threadId: after.activeThreadId,
      route: persisted,
      planTitle: plan.featureName || prepared.title,
      planPath: plan.relativePath,
      ...(sourceThreadId && sourceThreadId !== after.activeThreadId ? { sourceThreadId } : {}),
      startedAt: Date.now()
    })
  }
  return true
}
