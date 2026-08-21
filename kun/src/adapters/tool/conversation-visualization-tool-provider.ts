import { z } from 'zod'
import {
  ConversationVisualizationV1Schema,
  type ConversationVisualizationV1
} from '../../contracts/conversation-visualization.js'
import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost } from './local-tool-host.js'

export const CONVERSATION_VISUALIZATION_TOOL_NAME = 'show_visualization' as const
export const CONVERSATION_VISUALIZATION_PROVIDER_ID = 'conversation-visualization' as const

export type ConversationVisualizationToolConfig = {
  enabled?: boolean
}

const inputSchema = z.toJSONSchema(ConversationVisualizationV1Schema, {
  io: 'input',
  target: 'draft-07',
  reused: 'inline'
}) as Record<string, unknown>
delete inputSchema.$schema

const description = [
  'Display one structured visualization inline in the current GUI conversation.',
  'Use it only when a flow, grouped explanation, or highlighted constraint is materially clearer than prose.',
  'Do not call it as decoration for a simple answer.',
  'The visualization supplements rather than replaces the final text conclusion.'
].join(' ')

export function buildConversationVisualizationToolProvider(
  config: () => ConversationVisualizationToolConfig | undefined
): CapabilityToolProvider[] {
  const enabled = (): boolean => config()?.enabled === true
  return [{
    id: CONVERSATION_VISUALIZATION_PROVIDER_ID,
    kind: 'gui',
    enabled: true,
    available: true,
    effects: {
      network: false,
      externalWrite: false,
      processExecution: false,
      guiAutomation: false
    },
    tools: [LocalToolHost.defineTool({
      name: CONVERSATION_VISUALIZATION_TOOL_NAME,
      description,
      inputSchema,
      toolKind: 'tool_call',
      policy: 'auto',
      sideEffect: 'read-only',
      shouldAdvertise: enabled,
      execute: async (args) => {
        if (!enabled()) {
          return {
            output: {
              status: 'failed',
              error: 'show_visualization is disabled in Lab settings'
            },
            isError: true
          }
        }
        const parsed = ConversationVisualizationV1Schema.safeParse(args)
        if (!parsed.success) {
          return {
            output: {
              status: 'failed',
              error: z.prettifyError(parsed.error)
            },
            isError: true
          }
        }
        return {
          output: visualizationOutput(parsed.data)
        }
      }
    })]
  }]
}

function visualizationOutput(visualization: ConversationVisualizationV1): {
  status: 'completed'
  summary: string
  conversationVisualization: ConversationVisualizationV1
} {
  return {
    status: 'completed',
    summary: 'Displayed a conversation visualization.',
    conversationVisualization: visualization
  }
}
