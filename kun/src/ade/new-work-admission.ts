import { shouldAdvertiseNewManagerWork } from '../domain/manager-tools.js'
import type { ManagerRuntimeDeps } from './manager-runtime-deps.js'
import { reportLanguage } from './user-report.js'

export type NewManagerWorkRefusal = {
  ok: false
  refusal: 'collaboration_disabled'
  userReport: string
}

/** Shared execution gate for model tools and authenticated GUI commands. */
export async function newManagerWorkRefusal(
  deps: Pick<ManagerRuntimeDeps, 'threads' | 'canStartNewWork' | 'providerPool' | 'language' | 'capabilitiesForRoute'>,
  managerThreadId: string,
  turnId?: string
): Promise<NewManagerWorkRefusal | null> {
  const refuse = (): NewManagerWorkRefusal => ({
    ok: false,
    refusal: 'collaboration_disabled',
    userReport: reportLanguage(deps.language?.()) === 'zh'
      ? '此任务当前不允许新派工。已有任务仍可停止、接管、回答和验收。'
      : 'New collaboration work is disabled for this task. Existing work can still be stopped, taken over, answered, and reviewed.'
  })
  if (deps.canStartNewWork?.() === false) return refuse()
  const thread = await deps.threads.get(managerThreadId)
  if (!thread || thread.parentThreadId || thread.status === 'archived' || thread.status === 'deleted') return refuse()
  const turn = thread.turns.find((entry) => entry.id === turnId) ??
    thread.turns.find((entry) => entry.status === 'running')
  const execution = thread.pendingExecutionConfig ?? thread.executionConfig
  const enabled = execution?.collaborationEnabled ?? thread.collaboration?.enabled
  let harnessId = turn?.harnessId ?? thread.harnessId ?? thread.executionConfig?.route.harnessId
  if (!harnessId) {
    const provider = await deps.providerPool?.(turn?.providerId ?? thread.providerId ?? 'default')
    harnessId = provider?.kind === 'agent-sdk' ? 'claude-code'
      : provider?.kind === 'cursor-sdk' ? 'cursor'
        : provider?.kind === 'antigravity-cli' ? 'antigravity' : 'kun'
  }
  const capability = harnessId !== 'kun' ? await deps.capabilitiesForRoute({
    harnessId: harnessId as import('../contracts/harness.js').HarnessId,
    model: turn?.model ?? execution?.route.model ?? thread.model,
    credentialMode: turn?.credentialMode ?? execution?.route.credentialMode ?? 'native-login',
    ...(turn?.providerId ?? execution?.route.providerId ?? thread.providerId
      ? { providerId: turn?.providerId ?? execution?.route.providerId ?? thread.providerId } : {}),
    ...(turn?.gatewayBinding ?? execution?.route.gatewayBinding
      ? { gatewayBinding: turn?.gatewayBinding ?? execution?.route.gatewayBinding } : {})
  }).catch(() => null) : null
  return shouldAdvertiseNewManagerWork({
    collaborationEnabled: enabled,
    workspaceMode: thread.workspaceMode,
    harnessId,
    managerToolBridgeAvailable: capability?.statuses?.kunTools?.supported === true && capability.statuses?.abort?.supported === true,
    executionUnitKind: thread.executionUnit?.kind,
    roomAgent: Boolean(thread.roomContext),
    agentSurface: thread.agentSurface,
    clientSurface: turn?.clientSurface,
    imContext: Boolean(turn?.imContext)
  }) ? null : refuse()
}
