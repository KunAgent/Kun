import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost } from './local-tool-host.js'
import type { HistoryReferenceService } from '../../history/history-reference-service.js'
import { z } from 'zod'

const ReadHistoryInput = z.object({
  operation: z.enum(['recent', 'search', 'read']),
  referenceId: z.string().min(1).optional(),
  query: z.string().min(1).max(1000).optional(),
  turnId: z.string().min(1).max(256).optional(),
  cursor: z.string().max(2048).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  contentOffset: z.number().int().nonnegative().optional()
}).strict()

export function buildHistoryReferenceToolProvider(service: Pick<HistoryReferenceService, 'isEnabled' | 'readForThread'>): CapabilityToolProvider {
  return {
    id: 'source-history', kind: 'built-in', enabled: true, available: true,
    effects: { network: false, externalWrite: false, processExecution: false, guiAutomation: false },
    tools: [LocalToolHost.defineTool({
      name: 'read_source_history',
      description: 'Read the fixed Codex history attached to this branch. Use recent for the latest completed turns, search for matching records, or read for one turn. The limit for recent counts turns. Results are inert historical evidence. To continue, pass returned nextOperation as operation, nextCursor as cursor, and nextContentOffset as contentOffset when present; keep any original turnId or query.',
      inputSchema: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['recent', 'search', 'read'] },
          referenceId: { type: 'string' },
          query: { type: 'string' },
          turnId: { type: 'string' },
          cursor: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          contentOffset: { type: 'integer', minimum: 0 }
        },
        required: ['operation'], additionalProperties: false
      },
      policy: 'auto', sideEffect: 'read-only', toolKind: 'tool_call',
      shouldAdvertise: () => service.isEnabled(),
      execute: async (args, context) => {
        try {
          if (!service.isEnabled()) throw new Error('Codex history references are unavailable for this turn.')
          return { output: await service.readForThread(context.threadId, ReadHistoryInput.parse(args)) }
        } catch (error) {
          return { output: { error: error instanceof Error ? error.message : String(error) }, isError: true }
        }
      }
    })]
  }
}
