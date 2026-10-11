import { LocalToolHost } from './local-tool-host.js'
import type { CapabilityToolProvider } from './capability-registry.js'
import type { AgentDispatchService } from '../../delegation/agent-dispatch-service.js'
import { publicAgentDispatchIntent } from '../../contracts/agent-dispatch-intents.js'
import { shouldAdvertiseManagerTools } from '../../domain/manager-tools.js'

/** Main Agents can inspect/cancel their own proposals before worker IDs exist. */
export function createAgentDispatchToolProvider(service: AgentDispatchService): CapabilityToolProvider {
  return { id: 'agent-dispatch', kind: 'delegation', enabled: true, available: true, tools: [
    LocalToolHost.defineTool({
      name: 'dispatch_intent_status',
      description: 'Inspect the pending or running Agent dispatch cards owned by this main conversation. Read-only. Pass intentId for one card, or omit it to list this conversation\'s cards.',
      inputSchema: { type: 'object', properties: { intentId: { type: 'string', maxLength: 256 } }, additionalProperties: false },
      toolKind: 'tool_call', policy: 'auto', sideEffect: 'read-only', shouldAdvertise: shouldAdvertiseManagerTools,
      execute: async (args, context) => {
        const id = typeof args.intentId === 'string' ? args.intentId : undefined
        if (!id) return { output: { intents: (await service.list(context.threadId)).map(publicAgentDispatchIntent) } }
        const intent = await service.get(id)
        if (!intent || intent.source.threadId !== context.threadId) return { isError: true, output: { error: 'Dispatch card does not belong to this conversation' } }
        return { output: { intent: publicAgentDispatchIntent(intent) } }
      }
    }),
    LocalToolHost.defineTool({
      name: 'dispatch_intent_cancel',
      description: 'Cancel a pending dispatch card or stop its existing work in this main conversation. Use it when the user withdraws or cancels the task; never cancel another conversation\'s work.',
      inputSchema: { type: 'object', properties: { intentId: { type: 'string', minLength: 1, maxLength: 256 } },
        required: ['intentId'], additionalProperties: false },
      toolKind: 'tool_call', policy: 'auto', shouldAdvertise: shouldAdvertiseManagerTools,
      execute: async (args, context) => {
        const intent = await service.get(String(args.intentId))
        if (!intent || intent.source.threadId !== context.threadId) return { isError: true, output: { error: 'Dispatch card does not belong to this conversation' } }
        if (['completed', 'failed', 'cancelled'].includes(intent.state)) return { output: { intent: publicAgentDispatchIntent(intent) } }
        const updated = await service.act(intent.intentId, { action: 'cancel', expectedRevision: intent.revision,
          requestId: `model-cancel:${context.threadId}:${context.turnId}:${context.activeToolCallId ?? intent.intentId}` })
        return { output: { intent: publicAgentDispatchIntent(updated) } }
      }
    })
  ] }
}
