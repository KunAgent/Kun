import {
  contextWindowToolSpecByName,
  CONTEXT_WINDOW_TOOL_NAMES,
  type ContextWindowToolName
} from '../../contracts/context-windows.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import type { ContextWindowService } from '../../services/context-window-service.js'
import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost } from './local-tool-host.js'
import type { LocalTool } from './local-tool-host-types.js'

/**
 * Source of the accepted turn mode, resolved per call from the trusted
 * execution context (thread/turn). The registry answers from the frozen
 * per-turn snapshot (falling back to the thread's last accepted mode and
 * then live config), so a hot settings toggle never strips or grants these
 * tools mid-turn.
 */
export type ContextWindowModeSource = (
  context: ToolHostContext
) => 'summary' | 'windows'

export type NewContextTransition = (
  context: ToolHostContext,
  args: Record<string, unknown>
) => Promise<{ output: unknown; isError?: boolean }>

const READ_ONLY_TOOLS = new Set<ContextWindowToolName>([
  'history_list_windows',
  'history_list_items',
  'history_read_item',
  'history_search_contents',
  'notes_list_files_by_prefix',
  'notes_read_file',
  'notes_search_contents'
])

function modeDisabledOutput(toolName: string): { output: unknown; isError: boolean } {
  return {
    output: {
      error: `tool ${toolName} requires the window-mode context strategy enabled for this turn`
    },
    isError: true
  }
}

function failureOutput(error: unknown): { output: unknown; isError: boolean } {
  return {
    output: { error: error instanceof Error ? error.message : String(error) },
    isError: true
  }
}

/**
 * The nine bounded history/notes tools plus the `new_context` shell. Every
 * tool derives thread identity from the trusted execution context; arguments
 * cannot name another thread and note paths stay inside the thread-private
 * logical namespace. Schemas are advertised only while the accepted mode is
 * 'windows'; the registry additionally rejects direct invocation by name
 * when the predicate is false.
 */
export function buildContextWindowToolProviders(input: {
  service: ContextWindowService
  mode: ContextWindowModeSource
  /** Task 4.2 wires the real transition; the shell errors until then. */
  newContextTransition?: NewContextTransition
}): CapabilityToolProvider[] {
  const gated = (context: ToolHostContext) => input.mode(context) === 'windows'

  const run = async (
    toolName: Exclude<ContextWindowToolName, 'new_context'>,
    args: Record<string, unknown>,
    context: ToolHostContext
  ) => {
    if (!gated(context)) return modeDisabledOutput(toolName)
    try {
      switch (toolName) {
        case 'history_list_windows':
          return { output: await input.service.listWindows(context.threadId, args) }
        case 'history_list_items':
          return { output: await input.service.listItems(context.threadId, args) }
        case 'history_read_item':
          return { output: await input.service.readItem(context.threadId, args) }
        case 'history_search_contents':
          return { output: await input.service.searchContents(context.threadId, args) }
        case 'notes_list_files_by_prefix':
          return { output: await input.service.notes.listFilesByPrefix(context.threadId, args) }
        case 'notes_read_file':
          return { output: await input.service.notes.readFile(context.threadId, args) }
        case 'notes_search_contents':
          return { output: await input.service.notes.searchContents(context.threadId, args) }
        case 'notes_append_to_file':
          return { output: await input.service.notes.appendToFile(context.threadId, args) }
        case 'notes_write_file':
          return { output: await input.service.notes.writeFile(context.threadId, args) }
      }
    } catch (error) {
      return failureOutput(error)
    }
  }

  const tools: LocalTool[] = CONTEXT_WINDOW_TOOL_NAMES
    .filter((name) => name !== 'new_context')
    .map((name) => LocalToolHost.defineTool({
      name,
      description: contextWindowToolSpecByName[name].description,
      inputSchema: contextWindowToolSpecByName[name].inputSchema,
      policy: 'auto',
      sideEffect: READ_ONLY_TOOLS.has(name) ? 'read-only' : 'unknown',
      shouldAdvertise: gated,
      execute: (args, context) => run(name, args, context)
    }))

  tools.push(LocalToolHost.defineTool({
    name: 'new_context',
    description: contextWindowToolSpecByName.new_context.description,
    inputSchema: contextWindowToolSpecByName.new_context.inputSchema,
    policy: 'auto',
    sideEffect: 'unknown',
    shouldAdvertise: gated,
    execute: async (args, context) => {
      if (!gated(context)) return modeDisabledOutput('new_context')
      if (input.newContextTransition) return input.newContextTransition(context, args)
      return {
        output: { error: 'new_context transitions are not available in this runtime build yet' },
        isError: true
      }
    }
  }))

  return [{
    id: 'context-windows',
    kind: 'built-in',
    enabled: true,
    available: true,
    effects: {
      network: false,
      externalWrite: false,
      processExecution: false,
      guiAutomation: false
    },
    tools
  }]
}
