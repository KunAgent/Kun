import { makeToolResultItem } from '../domain/item.js'
import type {
  FastContextRunScope,
  ToolCallLike,
  ToolHost,
  ToolHostContext,
  ToolHostResult
} from '../ports/tool-host.js'
import { fastContextQueryTerms } from '../adapters/tool/fast-context-ranking.js'
import type { FastContextTask } from './fast-context-evidence.js'

const SOURCE_TOOL_NAMES = new Set(['grep', 'glob', 'read'])

const FAST_CONTEXT_TOOL_DESCRIPTIONS: Record<string, string> = {
  glob: [
    'Fast Context candidate-file discovery from a cached workspace file index.',
    'Use this first to locate narrow candidate paths; it returns at most 100 entries ranked by relevance and skips dependency, build, cache, and VCS directories.',
    'Do not use cursor pagination. Every call must include task_indexes for the task(s) it supports.'
  ].join(' '),
  grep: [
    'Fast Context bounded code search, ranked by relevance (path words, definitions, hint paths) rather than path order.',
    'Omit path to let Fast Context choose the scope (hint paths first, then the package that defines a searched identifier); pass a directory, a glob, or path "." to search exactly there.',
    'It returns at most 30 matches with at most 300 characters per match and skips dependency, build, cache, and VCS directories.',
    'In large workspaces, or after repeated timeouts, a grep without path or glob is refused with code fast_context_scope_required.',
    'Do not use cursor pagination. Every call must include task_indexes for the task(s) it supports.'
  ].join(' '),
  read: [
    'Fast Context local text inspection.',
    'Read only the necessary candidate file range; text output is capped at 200 lines, while binary and image bytes are omitted.',
    'Every call must include task_indexes for the task(s) it supports.'
  ].join(' ')
}

/**
 * Adds durable task attribution only around a Fast Context child. The model's
 * original call (including task_indexes) is persisted before this wrapper runs;
 * the underlying ordinary source tool receives the index-free arguments it
 * already understands.
 */
export function createFastContextToolHost(
  host: ToolHost,
  taskCount: number,
  options: { hintPaths?: readonly string[]; tasks?: readonly FastContextTask[] } = {}
): ToolHost {
  // One scope and one memo per retrieval child run.
  const run: FastContextRunScope = {
    hintPaths: [...(options.hintPaths ?? [])],
    queryTerms: fastContextQueryTerms((options.tasks ?? []).flatMap((task) => [task.title, task.query])),
    timedOutCommands: 0
  }
  const memo = new Map<string, Promise<ToolHostResult>>()
  return {
    id: `${host.id}:fast-context`,
    async listTools(context) {
      const tools = await host.listTools(context)
      return tools
        .filter((tool) => SOURCE_TOOL_NAMES.has(tool.name))
        .map((tool) => ({
          ...tool,
          description: FAST_CONTEXT_TOOL_DESCRIPTIONS[tool.name] ?? tool.description,
          inputSchema: withRequiredTaskIndexes(tool.inputSchema, taskCount)
        }))
    },
    async execute(call, context, onUpdate) {
      if (!SOURCE_TOOL_NAMES.has(call.toolName)) {
        return forbiddenToolResult(call, context)
      }
      const taskIndexes = call.arguments.task_indexes
      if (!areTaskIndexes(taskIndexes, taskCount)) return invalidTaskIndexesResult(call, context, taskCount)
      const { task_indexes: _taskIndexes, ...argumentsWithoutTaskIndexes } = call.arguments
      // Identical source calls in one run (common when several tasks share a
      // lookup) reuse the first successful result instead of rescanning.
      const key = `${call.toolName}\u0000${stableStringify(argumentsWithoutTaskIndexes)}`
      const prior = memo.get(key)
      if (prior) {
        const settled = await prior.catch(() => null)
        if (settled && !isErrorResult(settled)) return reuseResult(settled, call, context)
      }
      const pending = host.execute(
        { ...call, arguments: argumentsWithoutTaskIndexes },
        { ...context, fastContextRun: run },
        onUpdate
      )
      memo.set(key, pending)
      try {
        const result = await pending
        if (isErrorResult(result) && memo.get(key) === pending) memo.delete(key)
        return result
      } catch (error) {
        if (memo.get(key) === pending) memo.delete(key)
        throw error
      }
    },
    ...(host.clearReadTracker
      ? { clearReadTracker: (threadId?: string) => host.clearReadTracker?.(threadId) }
      : {})
  }
}

function isErrorResult(result: ToolHostResult): boolean {
  return result.item.kind === 'tool_result' && result.item.isError === true
}

function reuseResult(prior: ToolHostResult, call: ToolCallLike, context: ToolHostContext): ToolHostResult {
  const item = prior.item
  if (item.kind !== 'tool_result') return prior
  const output = item.output && typeof item.output === 'object' && !Array.isArray(item.output)
    ? { ...(item.output as Record<string, unknown>), reused_result: true }
    : item.output
  return {
    item: makeToolResultItem({
      id: `item_${call.callId}`,
      threadId: context.threadId,
      turnId: context.turnId,
      callId: call.callId,
      toolName: call.toolName,
      toolKind: call.toolKind ?? 'tool_call',
      output
    }),
    approved: prior.approved
  }
}

/** Key-order-independent JSON for memo keys. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function forbiddenToolResult(call: ToolCallLike, context: ToolHostContext): ToolHostResult {
  return {
    item: makeToolResultItem({
      id: `item_${call.callId}`,
      threadId: context.threadId,
      turnId: context.turnId,
      callId: call.callId,
      toolName: call.toolName,
      toolKind: call.toolKind ?? 'tool_call',
      output: {
        code: 'fast_context_tool_not_allowed',
        error: 'Fast Context permits only grep, glob, and read.',
        fast_context: true
      },
      isError: true
    }),
    approved: false
  }
}

function withRequiredTaskIndexes(inputSchema: Record<string, unknown>, taskCount: number): Record<string, unknown> {
  const properties = record(inputSchema.properties)
  const required = Array.isArray(inputSchema.required)
    ? inputSchema.required.filter((entry): entry is string => typeof entry === 'string')
    : []
  return {
    ...inputSchema,
    properties: {
      ...properties,
      task_indexes: {
        type: 'array',
        minItems: 1,
        maxItems: taskCount,
        uniqueItems: true,
        items: { type: 'integer', minimum: 1, maximum: taskCount },
        description: `Required Fast Context task indexes from 1 to ${taskCount}; include every task this source call supports.`
      }
    },
    required: [...new Set([...required, 'task_indexes'])]
  }
}

function invalidTaskIndexesResult(
  call: ToolCallLike,
  context: ToolHostContext,
  taskCount: number
): ToolHostResult {
  return {
    item: makeToolResultItem({
      id: `item_${call.callId}`,
      threadId: context.threadId,
      turnId: context.turnId,
      callId: call.callId,
      toolName: call.toolName,
      toolKind: call.toolKind ?? 'tool_call',
      output: {
        code: 'fast_context_task_indexes_required',
        error: `Fast Context source calls require a non-empty unique task_indexes array with integers from 1 to ${taskCount}.`,
        // The invalid call is already persisted as the tool_call. Do not echo
        // an unvalidated (potentially huge or nested) argument into a second
        // durable tool_result and bypass the Fast Context output budget.
        task_indexes_provided: Object.prototype.hasOwnProperty.call(call.arguments, 'task_indexes'),
        fast_context: true
      },
      isError: true
    }),
    approved: false
  }
}

function areTaskIndexes(value: unknown, taskCount: number): value is number[] {
  return Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= taskCount &&
    value.every((entry) => typeof entry === 'number' && Number.isInteger(entry) && entry >= 1 && entry <= taskCount) &&
    new Set(value).size === value.length
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
