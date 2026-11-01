import { createHash } from 'node:crypto'
import type { RoomRuntimeDeps } from './room-runtime-types.js'
import type { RoomContinuation } from './room-continuation-dispatch.js'
import { goalBudgetStatus } from '../loop/goal-execution-budget.js'
import { sourceDispatchAuthority } from '../workbench-bridge/dispatch-authority.js'

/** A model-supplied task id alone is never evidence of the turn that created it. */
export async function assistantSourceEvidence(deps: RoomRuntimeDeps, input: RoomContinuation) {
  if (input.kind !== 'personal_assistant' || !input.assistantTaskId || !input.assistantOwnerId || !input.sourceCallId || !deps.sessions.loadItemPage) return null
  const thread = await deps.threads.getMetadata(input.threadId)
  if (!thread || thread.status === 'archived' || !thread.goal || goalBudgetStatus(thread, thread.goal) !== 'active') return null
  if (!thread.roomContext && !thread.goal.tokenBudget) return null
  if (input.goalCreatedAt && input.goalCreatedAt !== thread.goal.createdAt) return null
  const source = thread.turns.find(turn => turn.id === input.sourceTurnId)
  if (!source?.clientRequestId || ['aborted', 'failed'].includes(source.status)) return null
  if (!thread.roomContext && thread.turns.slice(thread.turns.indexOf(source) + 1).some(turn => !turn.messageSource && turn.clientRequestId)) return null
  const page = await deps.sessions.loadItemPage(thread.id, { turnId: source.id, callId: input.sourceCallId, maxItems: 8, maxBytes: 256 * 1024 })
  const result = page.items.find(item => item.kind === 'tool_result' && item.callId === input.sourceCallId && !item.isError)
  const output = result?.kind === 'tool_result' && result.output && typeof result.output === 'object' ? result.output as Record<string, unknown> : null
  const mcp = output?.result && typeof output.result === 'object' ? output.result as Record<string, unknown> : null
  const structured = mcp?.structuredContent && typeof mcp.structuredContent === 'object' ? mcp.structuredContent as Record<string, unknown> : null
  const task = structured?.task && typeof structured.task === 'object' ? structured.task as Record<string, unknown> : null
  if (output?.serverId !== 'kun_assistants' || output.toolName !== 'assign_assistant_task' || task?.taskId !== input.assistantTaskId) return null
  const fingerprint = createHash('sha256').update(JSON.stringify({
    threadId: thread.id, turnId: source.id, workspace: thread.workspace, additionalWorkspaces: thread.additionalWorkspaces ?? [],
    currentPolicy: { approvalPolicy: thread.approvalPolicy, sandboxMode: thread.sandboxMode, approvalReviewer: thread.approvalReviewer },
    sourcePolicy: sourceDispatchAuthority(thread, source), goalCreatedAt: thread.goal.createdAt, goalTokenBudget: thread.goal.tokenBudget ?? null,
    currentRoute: { model: thread.model, providerId: thread.providerId, accountId: thread.accountId, harnessId: thread.harnessId, mode: thread.mode },
    route: { model: source.model, providerId: source.providerId, accountId: source.accountId, harnessId: source.harnessId,
      credentialMode: source.credentialMode, clientSurface: source.clientSurface, gatewayBinding: source.gatewayBinding,
      reasoningEffort: source.reasoningEffort, serviceTier: source.serviceTier, harnessAgentId: source.harnessAgentId,
      harnessSettings: source.harnessSettings, mode: source.mode, disableUserInput: source.disableUserInput,
      agentSurface: source.agentSurface, designProfile: source.designProfile, designDocumentTarget: source.designDocumentTarget }
  })).digest('hex')
  if (input.sourceFingerprint && input.sourceFingerprint !== fingerprint) return null
  return { thread, source, fingerprint, goalCreatedAt: thread.goal.createdAt }
}
