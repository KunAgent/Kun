import { describe, expect, it } from 'vitest'
import { AgentDispatchIntentPublicSchema } from './agent-dispatch'
import { AgentDispatchIntentSchema, AgentDispatchStateSchema, publicAgentDispatchIntent } from '../../kun/src/contracts/agent-dispatch-intents'

describe('Agent dispatch HTTP contract mirror', () => {
  it.each(AgentDispatchStateSchema.options)('accepts the canonical %s state with all public fields', (state) => {
    const intent = AgentDispatchIntentSchema.parse({ intentId: 'dispatch', kind: 'worker', state, revision: 3,
      source: { threadId: 'parent', turnId: 'turn', toolCallId: 'call', applicationSessionId: 'app', userIntent: 'Private user excerpt',
        actingModelRoute: { model: 'model', providerId: 'provider', accountId: 'account', unresolvedGatewayAlias: true, requestedGatewayAlias: 'alias' } },
      policySnapshot: { approvalPolicy: 'auto', sandboxMode: 'danger-full-access', approvalReviewer: 'user' },
      recommendation: { title: 'Task', task: 'Assignment', agentId: 'codex', agentName: 'Codex', model: 'model', workspace: '/workspace',
        acceptanceCriteria: ['Tests pass'], permissionMode: 'full-access', effectivePermissionMode: 'approve-for-me', agentSelection: 'auto' },
      payload: { private: true }, requestLedger: { call: 'hash' }, startRequestId: 'start', batchId: 'batch',
      deadline: '2026-10-07T02:01:00.000Z', decision: { decision: 'allow', reason: 'Reviewed', decidedAt: '2026-10-07T02:00:00.000Z' },
      target: { taskId: 'task', threadId: 'child', turnId: 'child-turn', workerIds: ['child'], dispatchIds: ['dispatch'] },
      error: 'Error', resultSummary: 'Summary', replacementCount: 1, replacementReason: 'Replacement',
      previousTarget: { threadId: 'previous' }, cancellationRequested: false, takenOver: true, takeoverApplied: true,
      createdAt: '2026-10-07T02:00:00.000Z', updatedAt: '2026-10-07T02:00:00.000Z' })
    const publicIntent = publicAgentDispatchIntent(intent)
    expect(AgentDispatchIntentPublicSchema.parse(publicIntent)).toEqual(publicIntent)
    expect(AgentDispatchIntentPublicSchema.safeParse({ ...publicIntent, payload: { secret: true } }).success).toBe(false)
    expect(AgentDispatchIntentPublicSchema.safeParse({ ...publicIntent, source: { ...publicIntent.source, userIntent: 'Private' } }).success).toBe(false)
  })
})
