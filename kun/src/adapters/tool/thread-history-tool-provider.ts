import type { ToolHostContext } from '../../ports/tool-host.js'
import type { SessionStore } from '../../ports/session-store.js'
import type { ThreadStore } from '../../ports/thread-store.js'
import { ThreadHistoryReader } from '../../services/thread-history-reader.js'
import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost } from './local-tool-host.js'

/**
 * `read_thread_history` (docs/ade/08 §6): delegated external harnesses can
 * page through their own thread's canonical history (plus fork ancestors)
 * when a handoff brief digest is not enough. Thread identity always comes
 * from the trusted execution context — arguments cannot name another thread.
 * The tool is advertised only on delegated turns (a `harnessId` other than
 * the native 'kun'), never on native Kun turns.
 */

const DELEGATED_ONLY = (context: ToolHostContext): boolean => {
  const harnessId = context.harnessId?.trim() || 'kun'
  return harnessId !== 'kun'
}

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description:
        'Case-insensitive substring to search for in user/assistant/tool text. Omit to page items in order.',
      maxLength: 1024
    },
    turnRange: {
      type: 'object',
      properties: {
        from: { type: 'integer', minimum: 1 },
        to: { type: 'integer', minimum: 1 }
      },
      additionalProperties: false,
      description: 'Restrict matches to global thread turn numbers [from, to].'
    },
    cursor: {
      type: 'string',
      description: 'Opaque paging cursor returned as nextCursor by a previous call.'
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: 20,
      description: 'Max matches per page (default 5, cap 20).'
    }
  },
  additionalProperties: false
} as const

export function buildThreadHistoryToolProviders(input: {
  sessionStore: SessionStore
  threadStore: ThreadStore
}): CapabilityToolProvider[] {
  return [buildThreadHistoryToolProvider({ reader: new ThreadHistoryReader(input) })]
}

export function buildThreadHistoryToolProvider(input: {
  reader: ThreadHistoryReader
}): CapabilityToolProvider {
  return {
    id: 'thread-history',
    kind: 'built-in',
    enabled: true,
    available: true,
    effects: {
      network: false,
      externalWrite: false,
      processExecution: false,
      guiAutomation: false
    },
    tools: [
      LocalToolHost.defineTool({
        name: 'read_thread_history',
        description:
          'Read this thread\'s earlier conversation history by keyword or turn range. ' +
          'Use after a handoff brief when you need full originals instead of the digest.',
        inputSchema: INPUT_SCHEMA,
        policy: 'auto',
        sideEffect: 'read-only',
        shouldAdvertise: DELEGATED_ONLY,
        execute: async (args, context) => {
          if (!DELEGATED_ONLY(context)) {
            return {
              output: {
                error: 'read_thread_history is only available on delegated harness turns'
              },
              isError: true
            }
          }
          try {
            return { output: await input.reader.search(context.threadId, args) }
          } catch (error) {
            return {
              output: { error: error instanceof Error ? error.message : String(error) },
              isError: true
            }
          }
        }
      })
    ]
  }
}
