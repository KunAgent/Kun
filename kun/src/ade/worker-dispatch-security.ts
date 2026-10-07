import type { ToolHostContext } from '../ports/tool-host.js'
import type { AgentDispatchIntent, AgentDispatchPolicySnapshot } from '../contracts/agent-dispatch-intents.js'
import { kunToolPermissionModeFromSettings, kunToolPermissionModeSettings, type KunToolPermissionMode } from '../contracts/policy.js'
import { ChildSecuritySnapshot } from '../delegation/delegation-runtime-contracts.js'
import { intersectChildSecurity } from '../delegation/delegation-runtime-support.js'
import { childSecurity } from '../adapters/tool/delegation-tool-context.js'
import { PERMISSION_RANK } from './permission-clamp.js'
import type { ManagerRuntimeDeps } from './manager-runtime-deps.js'

/** Raw policy axes remain frozen; a native permission ceiling can only narrow them. */
export function intersectDispatchPolicy(
  source: Pick<ToolHostContext, 'approvalPolicy' | 'sandboxMode' | 'approvalReviewer'>,
  ceiling: KunToolPermissionMode
): AgentDispatchPolicySnapshot {
  const policy = {
    approvalPolicy: source.approvalPolicy,
    sandboxMode: source.sandboxMode ?? 'workspace-write',
    approvalReviewer: source.approvalReviewer ?? 'user'
  } as AgentDispatchPolicySnapshot
  const mode = kunToolPermissionModeFromSettings(policy)
  if (PERMISSION_RANK[mode] <= PERMISSION_RANK[ceiling]) return policy
  const narrowed = kunToolPermissionModeSettings(ceiling)
  return { ...narrowed, ...(policy.sandboxMode === 'read-only' ? { sandboxMode: 'read-only' as const } : {}) }
}

/** Rebuild after the source turn has ended; never restore one-call approval/MCP grants. */
export async function rebuildWorkerDispatchContext(
  deps: ManagerRuntimeDeps, intent: AgentDispatchIntent, signal: AbortSignal
): Promise<ToolHostContext> {
  const thread = await deps.threads.get(intent.source.threadId)
  const turn = thread?.turns.find((entry) => entry.id === intent.source.turnId)
    ?? await deps.turns.getTurn(intent.source.threadId, intent.source.turnId).catch(() => null)
  if (!thread || !turn) throw new Error('The source task or turn is no longer available.')
  const saved = ChildSecuritySnapshot.parse(intent.payload.security)
  if (thread.workspace !== saved.sandboxRoot) throw new Error('The source workspace changed; dispatch must be proposed again.')
  const threadPolicy = { approvalPolicy: thread.approvalPolicy,
    sandboxMode: thread.sandboxMode, approvalReviewer: thread.approvalReviewer ?? 'user' }
  const currentPolicy = JSON.stringify(threadPolicy) === JSON.stringify(intent.payload.threadPolicy)
    ? intent.policySnapshot : threadPolicy
  const live = deps.dispatchToolContext
    ? await deps.dispatchToolContext(intent, signal)
    : {
        threadId: thread.id, turnId: turn.id, workspace: thread.workspace,
        ...currentPolicy,
        ...(thread.toolCatalogEpoch ? { extensionToolCatalogEpoch: thread.toolCatalogEpoch } : {}),
        ...(thread.additionalWorkspaces ? { additionalWorkspaces: thread.additionalWorkspaces } : {}),
        abortSignal: signal, awaitApproval: async () => 'deny' as const
      }
  const liveMode = kunToolPermissionModeFromSettings({
    approvalPolicy: live.approvalPolicy,
    sandboxMode: live.sandboxMode ?? 'workspace-write',
    approvalReviewer: live.approvalReviewer
  })
  const sourcePolicy = intersectDispatchPolicy(intent.policySnapshot, liveMode)
  const security = intersectChildSecurity(saved, ChildSecuritySnapshot.parse(childSecurity(live)))
  const { sandboxRoot: _sandboxRoot, memoryEnabled, instructionsEnabled: _instructionsEnabled, ...restrictions } = security
  return {
    ...live,
    ...restrictions,
    ...sourcePolicy,
    ...(live.sandboxMode === 'read-only' ? { sandboxMode: 'read-only' } : {}),
    threadId: thread.id, turnId: turn.id, workspace: thread.workspace,
    actingModelRoute: intent.source.actingModelRoute,
    clientSurface: turn.clientSurface,
    agentSurface: turn.agentSurface ?? thread.agentSurface,
    harnessId: turn.harnessId ?? thread.harnessId,
    memoryPolicy: { enabled: memoryEnabled },
    // A host claim, not an executable one-call grant, authorizes creation now.
    activeToolCallId: undefined,
    kunActionApprovalGrant: undefined,
    approvedExternalWriteTargets: undefined,
    abortSignal: signal,
    awaitApproval: async () => 'deny'
  }
}
