import { createHash } from 'node:crypto'
import type { ThreadExecutionConfig, ThreadRecord } from '../contracts/threads.js'
import { canonicalizeFingerprintValue } from './turn-request-fingerprint.js'

// UI labels and resolution timestamps are not execution authority. Preserve
// only the settings that can change where or under which limits a turn runs.
function semanticConfig(config: ThreadExecutionConfig | undefined) {
  if (!config) return undefined
  const { revision: _revision, resolvedAt: _resolvedAt, origins: _origins, ...semantics } = config
  return semantics
}

/** Immutable target scope captured when a user links an owned native task. */
export function nativeFollowUpTargetFingerprint(thread: ThreadRecord): string {
  const origin = thread.workbenchOrigin && {
    kind: thread.workbenchOrigin.kind, roomId: thread.workbenchOrigin.roomId,
    linkId: thread.workbenchOrigin.linkId, agentId: thread.workbenchOrigin.agentId,
    capabilityCeiling: thread.workbenchOrigin.capabilityCeiling
  }
  const scope = {
    schemaVersion: 2, threadId: thread.id, workspace: thread.workspace,
    historyRefId: thread.historyRefId, remoteFork: thread.remoteFork, remoteRewind: thread.remoteRewind,
    additionalWorkspaces: thread.additionalWorkspaces, knowledgeBases: thread.knowledgeBases,
    taskWorkspaceId: thread.taskWorkspaceId, workspaceMode: thread.workspaceMode ?? 'code',
    roomContext: thread.roomContext, workbenchOrigin: origin, taskOrigin: thread.taskOrigin,
    executionUnit: thread.executionUnit, relation: thread.relation, parentThreadId: thread.parentThreadId,
    ownerExtensionId: thread.ownerExtensionId, ownerExtensionVersion: thread.ownerExtensionVersion,
    extensionVisibility: thread.extensionVisibility, extensionProfile: thread.extensionProfile, extensionBudget: thread.extensionBudget,
    toolCatalogEpoch: thread.toolCatalogEpoch, agentId: thread.agentId, systemPrompt: thread.systemPrompt,
    model: thread.model, providerId: thread.providerId, harnessId: thread.harnessId, accountId: thread.accountId,
    mode: thread.mode, approvalPolicy: thread.approvalPolicy, sandboxMode: thread.sandboxMode,
    approvalReviewer: thread.approvalReviewer, collaboration: thread.collaboration,
    executionConfig: semanticConfig(thread.executionConfig), pendingExecutionConfig: semanticConfig(thread.pendingExecutionConfig),
    agentSurface: thread.agentSurface ?? 'code', designProfile: thread.designProfile,
    goal: thread.goal && { objective: thread.goal.objective, tokenBudget: thread.goal.tokenBudget, createdAt: thread.goal.createdAt },
    costBudgetUsd: thread.costBudgetUsd
  }
  return createHash('sha256').update(JSON.stringify(canonicalizeFingerprintValue(scope)), 'utf8').digest('hex')
}
