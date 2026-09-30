import type { ToolHostContext } from '../../ports/tool-host.js'
import type { WorkerCallbackService } from '../../services/worker-callback-service.js'
import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost } from './local-tool-host.js'

/**
 * Worker callback tools (05 §2). Advertised only on worker threads — the
 * service independently re-verifies `executionUnit` so a direct invocation
 * on a non-worker thread still fails closed.
 */
export function createWorkerCallbackToolProvider(
  service: WorkerCallbackService
): CapabilityToolProvider {
  const workerOnly = (context: ToolHostContext): boolean =>
    context.executionUnitKind === 'worker'
  return {
    id: 'worker-callbacks',
    kind: 'delegation',
    enabled: true,
    available: true,
    tools: [
      LocalToolHost.defineTool({
        name: 'report_progress',
        description:
          'Post a one-line status update for the manager and the mission board. ' +
          'Write the first sentence as what was just done. Rate-limited to once every 10 seconds; ' +
          'a rate_limited result is not an error — keep working.',
        inputSchema: {
          type: 'object',
          properties: {
            summary: { type: 'string', maxLength: 280 },
            phase: {
              type: 'string',
              enum: ['investigating', 'implementing', 'verifying', 'blocked']
            }
          },
          required: ['summary'],
          additionalProperties: false
        },
        toolKind: 'tool_call',
        policy: 'auto',
        sideEffect: 'read-only',
        shouldAdvertise: workerOnly,
        execute: async (args, context) => {
          const result = await service.reportProgress(context.threadId, args)
          return { output: result }
        }
      }),
      LocalToolHost.defineTool({
        name: 'ask_manager',
        description:
          'Ask the manager a blocking question. The call returns when the manager (or an ' +
          'escalated user) answers, the timeout elapses, or the turn is cancelled. On timeout ' +
          'continue under the most conservative assumption and note it in your result.',
        inputSchema: {
          type: 'object',
          properties: {
            question: { type: 'string', maxLength: 8_000 },
            options: {
              type: 'array',
              items: { type: 'string', maxLength: 512 },
              maxItems: 16,
              description: 'When provided, the manager/user picks exactly one.'
            },
            timeoutSeconds: { type: 'integer', minimum: 1, maximum: 3_600 }
          },
          required: ['question'],
          additionalProperties: false
        },
        toolKind: 'tool_call',
        policy: 'auto',
        shouldAdvertise: workerOnly,
        execute: async (args, context) => {
          const result = await service.askManager(context.threadId, args, context.abortSignal)
          return { output: result }
        }
      }),
      LocalToolHost.defineTool({
        name: 'read_manager_context',
        description:
          'Read visible user/assistant messages from your own manager thread. Use only when ' +
          'the task depends on relative context ("this problem", "the earlier plan"); ' +
          'self-contained tasks do not need it.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', maxLength: 1_024 },
            cursor: { type: 'string', maxLength: 1_024 },
            limit: { type: 'integer', minimum: 1, maximum: 50 }
          },
          additionalProperties: false
        },
        toolKind: 'tool_call',
        policy: 'auto',
        sideEffect: 'read-only',
        shouldAdvertise: workerOnly,
        execute: async (args, context) => {
          const result = await service.readManagerContext(context.threadId, args)
          return { output: result }
        }
      }),
      LocalToolHost.defineTool({
        name: 'submit_result',
        description:
          'Attach a structured final report to the current dispatch. Optional: completion is ' +
          'judged by the host, not by calling this. Use it to summarize what was done, what ' +
          'was found, and what remains.',
        inputSchema: {
          type: 'object',
          properties: {
            summary: { type: 'string', maxLength: 4_000 },
            outcome: { type: 'string', enum: ['succeeded', 'partial', 'failed'] },
            filesChanged: {
              type: 'array',
              items: { type: 'string' },
              maxItems: 256,
              description: 'Reference only; the host reconciles against the actual diff.'
            },
            checks: {
              type: 'array',
              maxItems: 64,
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', maxLength: 128 },
                  status: { type: 'string', enum: ['passed', 'failed', 'skipped'] },
                  detail: { type: 'string', maxLength: 2_000 }
                },
                required: ['name', 'status'],
                additionalProperties: false
              }
            },
            risks: { type: 'array', items: { type: 'string' }, maxItems: 32 }
          },
          required: ['summary', 'outcome'],
          additionalProperties: false
        },
        toolKind: 'tool_call',
        policy: 'auto',
        shouldAdvertise: workerOnly,
        execute: async (args, context) => {
          const result = await service.submitResult(context.threadId, args)
          return { output: result }
        }
      })
    ]
  }
}
