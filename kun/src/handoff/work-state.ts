import type { TurnItem } from '../contracts/items.js'
import type { WorkState } from './handoff-types.js'

const MAX_TRACKED_COMMANDS = 50

type ToolCallItem = Extract<TurnItem, { kind: 'tool_call' }>
type ToolResultItem = Extract<TurnItem, { kind: 'tool_result' }>

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Changed-file paths per tool family (docs/ade/08 §3.3): Kun native write/edit
 * use `path`, Claude SDK Edit/Write/MultiEdit use `file_path`, ACP diffs use
 * `path`. Unrecognized shapes contribute nothing; this never throws.
 */
function fileChangePaths(item: ToolCallItem): string[] {
  const args = item.arguments
  switch (item.toolName) {
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
      return asString(args.file_path) ? [args.file_path as string] : []
    default: {
      const path = asString(args.path) ?? asString(args.file_path)
      return path ? [path] : []
    }
  }
}

function exitCodeOf(result: ToolResultItem | undefined): number | undefined {
  const output = result?.output
  if (!output || typeof output !== 'object') return undefined
  const record = output as Record<string, unknown>
  const code = record.exitCode ?? record.exit_code
  return typeof code === 'number' && Number.isFinite(code) ? code : undefined
}

function commandOf(item: ToolCallItem): string | undefined {
  return asString(item.arguments.command) ?? asString(item.arguments.cmd)
}

/** Unfinished todos from the latest todo_write-style call (Kun + SDK names). */
function openTodosFrom(args: Record<string, unknown>): string[] | undefined {
  const name = args.todos
  if (!Array.isArray(name)) return undefined
  const open: string[] = []
  for (const entry of name) {
    if (!entry || typeof entry !== 'object') continue
    const todo = entry as Record<string, unknown>
    const content = asString(todo.content)
    if (content && todo.status !== 'completed') open.push(content)
  }
  return open
}

function planPathOf(result: ToolResultItem): string | undefined {
  if (result.isError || !result.output || typeof result.output !== 'object') {
    return undefined
  }
  const output = result.output as Record<string, unknown>
  return asString(output.relative_path) ?? asString(output.absolute_path)
}

const TODO_TOOL_NAMES = new Set(['todo_write', 'todowrite'])

/**
 * Extract the durable work-site facts from canonical items. The result covers
 * the whole supplied history — delta handoffs still show the full work site.
 */
export function extractWorkState(
  items: readonly TurnItem[],
  taskWorkspace?: { changedFiles: readonly string[] }
): WorkState {
  const files = new Set<string>()
  const commands: Array<{ command: string; exitCode?: number }> = []
  const results = new Map<string, ToolResultItem>()
  for (const item of items) {
    if (item.kind === 'tool_result') results.set(item.callId, item)
  }
  let todos: string[] = []
  let goal: string | undefined
  let plan: string | undefined
  for (const item of items) {
    if (item.kind === 'tool_call') {
      if (item.toolKind === 'file_change') {
        for (const path of fileChangePaths(item)) files.add(path)
      } else if (item.toolKind === 'command_execution') {
        const command = commandOf(item)
        if (command) {
          const exitCode = exitCodeOf(results.get(item.callId))
          commands.push(exitCode === undefined ? { command } : { command, exitCode })
        }
      }
      if (TODO_TOOL_NAMES.has(item.toolName.toLowerCase())) {
        const open = openTodosFrom(item.arguments)
        if (open !== undefined) todos = open
      }
      continue
    }
    if (item.kind === 'goal_context') {
      const text = item.text.trim()
      if (text) goal = text
      continue
    }
    if (item.kind === 'tool_result' && item.toolName === 'create_plan') {
      plan = planPathOf(item) ?? plan
    }
  }
  for (const path of taskWorkspace?.changedFiles ?? []) files.add(path)
  return {
    files: [...files].sort(),
    commands: commands.slice(-MAX_TRACKED_COMMANDS),
    todos,
    ...(goal ? { goal } : {}),
    ...(plan ? { plan } : {})
  }
}
