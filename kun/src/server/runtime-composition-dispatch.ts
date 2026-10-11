import { runWithoutTurnMutationFence } from '../manager/turn-mutation-context.js'
import { randomUUID } from 'node:crypto'
import { appSessionOwnerFromEnvironment } from '../contracts/app-session-owner.js'
import { publicAgentDispatchIntent } from '../contracts/agent-dispatch-intents.js'
import { createApprovalRequest } from '../domain/approval.js'
import { FileAgentDispatchIntentStore } from '../delegation/agent-dispatch-intent-store.js'
import { AgentDispatchService, bindAgentDispatchService } from '../delegation/agent-dispatch-service.js'
import type { createRuntimeModelComposition } from './runtime-composition-model.js'

/** One dispatch coordinator serves both native and bridged main Agents. */
export function createRuntimeAgentDispatch(model: Awaited<ReturnType<typeof createRuntimeModelComposition>>): AgentDispatchService {
  const { core } = model
  const service = new AgentDispatchService({
    store: new FileAgentDispatchIntentStore(core.activeOptions.dataDir),
    applicationSessionId: appSessionOwnerFromEnvironment()?.ownerSessionId ?? core.activeOptions.instanceId ?? randomUUID(),
    onUpdated: async (intent) => {
      await runWithoutTurnMutationFence(() => core.events.record({ kind: 'agent_dispatch_intent',
        threadId: intent.source.threadId, dispatchIntent: publicAgentDispatchIntent(intent) }))
    },
    review: (intent, signal) => {
      const recommendation = intent.recommendation
      const toolName = intent.kind === 'worker' ? 'worker_create' : 'create_code_task'
      return model.approvalReviewService.review({
        approval: createApprovalRequest({ id: `${intent.intentId}:review:${intent.revision}`,
          threadId: intent.source.threadId, turnId: intent.source.turnId, toolName,
          summary: `Delegate ${recommendation.title} to ${recommendation.agentName ?? recommendation.agentId}`,
          action: { version: 1, kind: 'external-effect', toolName, providerKind: 'delegation',
            toolKind: 'tool_call', effects: { network: true, externalWrite: true, processExecution: true, guiAutomation: false },
            workspace: recommendation.workspace ?? '.',
            targets: [{ kind: 'resource', value: recommendation.agentId }],
            arguments: { title: recommendation.title, task: recommendation.task,
              agentId: recommendation.agentId, model: recommendation.model,
              acceptanceCriteria: recommendation.acceptanceCriteria, permissionMode: recommendation.permissionMode },
            reason: 'Evaluate this concrete delegated task against the initiating user request and captured authority.' }
        }),
        route: intent.source.actingModelRoute,
        intent: intent.source.userIntent,
        signal
      })
    }
  })
  bindAgentDispatchService(core.threadStore, service)
  bindAgentDispatchService(core.stores.threadStore, service)
  return service
}
