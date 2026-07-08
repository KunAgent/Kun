import type {
  ToolHost,
  ToolHostContext,
  ToolHostResult,
  ToolCallLike,
  ToolExecutionUpdate
} from '../../ports/tool-host.js'
import type { ApprovalRequest } from '../../domain/approval.js'
import { createApprovalRequest } from '../../domain/approval.js'
import type { TurnItem } from '../../contracts/items.js'
import { makeToolResultItem, makeApprovalItem } from '../../domain/item.js'
import { buildBuiltinLocalTools } from './builtin-tools.js'
import type { BuiltinLocalToolsOptions } from './builtin-tool-types.js'
import { CapabilityRegistry } from './capability-registry.js'
import {
  runPostToolUseHooks,
  runPreToolUseHooks,
  type PostToolUseOutcome,
  type PreToolUseOutcome,
  type ResolvedHook
} from '../../hooks/hook-engine.js'
import {
  normalizeRateLimitedToolOutput
} from './tool-rate-limit.js'
import {
  normalizeReadTrackerOptions,
  ReadTracker,
  type ReadTrackerOptions
} from './read-tracker.js'
import { sandboxBlockForTool, type SandboxBlock } from './sandbox-policy.js'
import {
  createToolOperationIdentity,
  ToolOperationJournal
} from '../../reliability/operation-journal.js'

/**
 * A single registered tool. Tools are pure functions that observe the
 * abort signal and may be guarded by an approval policy.
 */
export type LocalTool = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  toolKind: 'tool_call' | 'command_execution' | 'file_change'
  /**
   * Tool policy. `auto` runs the tool without asking. `on-request` and
   * `suggest` always ask the user. `never` blocks the tool. `untrusted`
   * prompts unless the call is in an allow-list.
   */
  policy: 'auto' | 'on-request' | 'suggest' | 'never' | 'untrusted'
  /**
   * Optional gating predicate. When present, the tool is only listed
   * and only executed when `shouldAdvertise` returns true for the
   * active turn context. Use this for mode/plan-only tools such as
   * `create_plan`.
   */
  shouldAdvertise?: (context: ToolHostContext) => boolean
  execute: (
    args: Record<string, unknown>,
    context: ToolHostContext,
    onUpdate?: (update: ToolExecutionUpdate) => Promise<void> | void
  ) => Promise<{ output: unknown; isError?: boolean }>
}

export type LocalToolHostOptions = {
  tools?: LocalTool[]
  registry?: CapabilityRegistry
  /** Allow-list for `untrusted` policy. Tools outside the list always prompt. */
  allowList?: string[]
  /** Optional PreToolUse/PostToolUse hooks (lifecycle phases are ignored here). */
  hooks?: readonly ResolvedHook[]
  /** Runtime read-before-edit guard. Disabled by default for direct unit use. */
  readTracker?: boolean | ReadTrackerOptions
  /**
   * Turn-scoped operation journal. Defaults to an in-memory journal so fallback
   * call ids such as `call_1` are isolated by turnId/toolName/argsHash.
   */
  operationJournal?: ToolOperationJournal
}

/**
 * Default tool host. Runs tools in-process with abort-signal support
 * and approval gating through the `ToolHostContext.awaitApproval`
 * callback. The host is approval-aware at two layers:
 *
 * 1. A tool with `policy: 'never'` is rejected up front.
 * 2. A tool with `policy: 'on-request' | 'suggest' | 'untrusted'`
 *    always asks before running when the runtime approval policy
 *    permits tool execution.
 *
 * Tools that declare a `shouldAdvertise` predicate are also gated at
 * the listing layer and the execution layer. This is how `create_plan`
 * stays scoped to GUI plan/refine turns.
 */
export class LocalToolHost implements ToolHost {
  readonly id = 'local'
  private registry: CapabilityRegistry
  private readonly allowList: Set<string>
  private hooks: readonly ResolvedHook[]
  private readonly readTracker: ReadTracker
  private readonly operationJournal: ToolOperationJournal

  constructor(options: LocalToolHostOptions) {
    this.registry = options.registry ?? CapabilityRegistry.fromLocalTools(options.tools ?? [])
    this.allowList = new Set(options.allowList ?? [])
    this.hooks = options.hooks ?? []
    this.readTracker = new ReadTracker(normalizeReadTrackerOptions(options.readTracker))
    this.operationJournal = options.operationJournal ?? new ToolOperationJournal()
  }

  replaceRuntimeComponents(input: {
    registry?: CapabilityRegistry
    hooks?: readonly ResolvedHook[]
  }): void {
    if (input.registry) this.registry = input.registry
    if (input.hooks) this.hooks = input.hooks
  }

  listTools(context?: ToolHostContext) {
    return Promise.resolve(this.registry.listTools(context))
  }

  diagnostics() {
    return this.registry.diagnostics()
  }

  async execute(
    call: ToolCallLike,
    context: ToolHostContext,
    onUpdate?: (item: TurnItem) => Promise<void> | void
  ): Promise<ToolHostResult> {
    if (context.abortSignal.aborted) {
      throw new Error('tool call aborted before start')
    }
    const { tool } = this.registry.resolveTool(call.toolName, context, call.providerId)
    if (tool.policy === 'never') {
      throw new Error(`tool ${call.toolName} is disabled by policy`)
    }
    const sandboxBlock = sandboxBlockForTool(tool, context)
    if (sandboxBlock) {
      return {
        item: this.errorToolResult(context, call, tool, sandboxBlock.message, sandboxBlock.code),
        approved: false
      }
    }
    let preHooks: PreToolUseOutcome
    try {
      preHooks = await runPreToolUseHooks(this.hooks, {
        call,
        context: hookContext(context)
      })
    } catch (error) {
      return {
        item: this.errorToolResult(context, call, tool, hookErrorMessage(error), 'hook_failed'),
        approved: false
      }
    }
    if (preHooks.denied) {
      return {
        item: this.errorToolResult(context, preHooks.call, tool, preHooks.denied, 'hook_denied'),
        approved: false
      }
    }
    const activeCall = preHooks.call
    const readValidation = this.readTracker.validateBeforeTool({ context, call: activeCall })
    if (!readValidation.ok) {
      return {
        item: this.errorToolResult(context, activeCall, tool, readValidation.message, 'read_before_edit_required'),
        approved: false
      }
    }
    const runtimeBlock = this.runtimePolicyBlock(tool, activeCall, context)
    if (runtimeBlock) {
      return {
        item: this.errorToolResult(
          context,
          activeCall,
          tool,
          runtimeBlock.message,
          runtimeBlock.code
        ),
        approved: false
      }
    }
    const needsApproval = !preHooks.autoApproved && this.requiresApproval(tool, activeCall, context)
    if (needsApproval) {
      const approvalId = `appr_${activeCall.callId}`
      const approval: ApprovalRequest = createApprovalRequest({
        id: approvalId,
        threadId: context.threadId,
        turnId: context.turnId,
        toolName: activeCall.toolName,
        summary: this.buildApprovalSummary(activeCall)
      })
      const decision = await context.awaitApproval(approval)
      if (decision !== 'allow') {
        const item = makeApprovalItem({
          id: `item_${approvalId}`,
          turnId: context.turnId,
          threadId: context.threadId,
          approvalId,
          toolName: activeCall.toolName,
          summary: approval.summary
        })
        return { item, approved: false }
      }
    }
    if (context.abortSignal.aborted) {
      throw new Error('tool call aborted while waiting for approval')
    }
    const operationIdentity = createToolOperationIdentity({
      threadId: context.threadId,
      turnId: context.turnId,
      callId: activeCall.callId,
      toolName: activeCall.toolName,
      args: activeCall.arguments
    })
    const replayed = this.operationJournal.getCompleted(operationIdentity)
    if (replayed) {
      return {
        item: this.completedToolResult(context, activeCall, tool, replayed.output, replayed.isError),
        approved: !needsApproval
      }
    }
    this.operationJournal.begin(operationIdentity)
    let result: Awaited<ReturnType<LocalTool['execute']>>
    try {
      result = await tool.execute(activeCall.arguments, context, async (update) => {
        if (!onUpdate) return
        const partialItem = makeToolResultItem({
          id: `item_${activeCall.callId}`,
          turnId: context.turnId,
          threadId: context.threadId,
          callId: activeCall.callId,
          toolName: activeCall.toolName,
          toolKind: activeCall.toolKind ?? tool.toolKind,
          output: update.output,
          isError: update.isError,
          status: 'running'
        })
        await onUpdate(partialItem)
      })
    } catch (error) {
      // A tool blowing up (an MCP server returning a protocol error, a
      // provider bug) is feedback for the model, not a reason to kill the
      // whole turn. Only abort keeps propagating.
      if (context.abortSignal.aborted) {
        this.operationJournal.unknown(operationIdentity, 'tool call aborted during execution')
        throw error
      }
      this.operationJournal.fail(operationIdentity, error)
      const message = error instanceof Error ? error.message : String(error)
      return {
        item: this.errorToolResult(context, activeCall, tool, message, 'tool_execution_failed'),
        approved: true
      }
    }
    let hookedResult: PostToolUseOutcome
    try {
      hookedResult = await runPostToolUseHooks(this.hooks, {
        call: activeCall,
        context: hookContext(context),
        result
      })
    } catch (error) {
      this.operationJournal.fail(operationIdentity, error)
      return {
        item: this.errorToolResult(context, activeCall, tool, hookErrorMessage(error), 'hook_failed'),
        approved: true
      }
    }
    const rateLimited = normalizeRateLimitedToolOutput(hookedResult.output)
    let output = rateLimited.rateLimited ? rateLimited.output : hookedResult.output
    const isError = hookedResult.isError || rateLimited.isError
    this.readTracker.observeToolResult({
      context,
      call: activeCall,
      output,
      isError
    })
    if (!isError) output = await offloadLargeToolOutput(output, activeCall.toolName, context)
    this.operationJournal.complete(operationIdentity, { output, isError })
    const item = this.completedToolResult(context, activeCall, tool, output, isError)
    return { item, approved: !needsApproval }
  }

  clearReadTracker(threadId?: string): void {
    this.readTracker.clear(threadId)
  }

  private runtimePolicyBlock(
    tool: LocalTool,
    call: ToolCallLike,
    context: ToolHostContext
  ): SandboxBlock | { code: 'approval_policy_blocked'; message: string } | null {
    const sandboxBlock = sandboxBlockForTool(
      { name: call.toolName, toolKind: call.toolKind ?? tool.toolKind },
      context
    )
    if (sandboxBlock) return sandboxBlock
    if (this.isInteractiveGuiGateTool(call.toolName)) return null
    if (context.approvalPolicy !== 'never') return null
    if (tool.policy === 'never') return null
    return {
      code: 'approval_policy_blocked',
      message: `tool ${call.toolName} is disabled by runtime approval policy`
    }
  }

  private requiresApproval(tool: LocalTool, call: ToolCallLike, context: ToolHostContext): boolean {
    if (this.isInteractiveGuiGateTool(call.toolName)) return false
    if (tool.policy === 'never' || context.approvalPolicy === 'never') return false
    switch (context.approvalPolicy) {
      case 'always':
        return true
      case 'auto':
        return false
      case 'on-request':
      case 'suggest':
        return tool.policy !== 'auto'
      case 'untrusted':
        if (tool.policy === 'auto') return !this.allowList.has(call.toolName)
        return true
    }
  }

  private isInteractiveGuiGateTool(toolName: string): boolean {
    return toolName === 'user_input' || toolName === 'request_user_input'
  }

  private buildApprovalSummary(call: ToolCallLike): string {
    const args = Object.entries(call.arguments)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(', ')
    return `Run ${call.toolName}(${args})`
  }

  private completedToolResult(
    context: ToolHostContext,
    call: ToolCallLike,
    tool: LocalTool,
    output: unknown,
    isError?: boolean
  ): TurnItem {
    return makeToolResultItem({
      id: `item_${call.callId}`,
      turnId: context.turnId,
      threadId: context.threadId,
      callId: call.callId,
      toolName: call.toolName,
      toolKind: call.toolKind ?? tool.toolKind,
      output,
      isError
    })
  }

  private errorToolResult(
    context: ToolHostContext,
    call: ToolCallLike,
    tool: LocalTool,
    message: string,
    code: string
  ): TurnItem {
    return makeToolResultItem({
      id: `item_${call.callId}`,
      turnId: context.turnId,
      threadId: context.threadId,
      callId: call.callId,
      toolName: call.toolName,
      toolKind: call.toolKind ?? tool.toolKind,
      output: { code, error: message },
      isError: true
    })
  }

  /** Tool builder helper for tests and feature scripts. */
  static defineTool(
    tool: Omit<LocalTool, 'policy' | 'toolKind'> & {
      policy?: LocalTool['policy']
      toolKind?: LocalTool['toolKind']
    }
  ): LocalTool {
    return {
      policy: tool.policy ?? 'on-request',
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      toolKind: tool.toolKind ?? 'tool_call',
      execute: tool.execute,
      ...(tool.shouldAdvertise ? { shouldAdvertise: tool.shouldAdvertise } : {})
    }
  }
}

const ARTIFACT_OUTPUT_THRESHOLD_BYTES = 128 * 1024

async function offloadLargeToolOutput(
  output: unknown,
  toolName: string,
  context: ToolHostContext
): Promise<unknown> {
  if (!context.artifactStore) return output
  let content: string
  try {
    content = typeof output === 'string' ? output : JSON.stringify(output)
  } catch {
    return output
  }
  if (Buffer.byteLength(content, 'utf8') <= ARTIFACT_OUTPUT_THRESHOLD_BYTES) return output
  try {
    const stored = await context.artifactStore.put({ content, source: 'tool', origin: toolName })
    return {
      artifactId: stored.meta.id,
      byteSize: stored.meta.byteSize,
      lineCount: stored.meta.lineCount,
      truncated: stored.summary.truncated,
      preview: stored.summary.inline
    }
  } catch {
    return output
  }
}

function hookContext(
  context: ToolHostContext
): Pick<ToolHostContext, 'threadId' | 'turnId' | 'workspace' | 'threadMode' | 'approvalPolicy' | 'sandboxMode'> {
  return {
    threadId: context.threadId,
    turnId: context.turnId,
    workspace: context.workspace,
    approvalPolicy: context.approvalPolicy,
    ...(context.sandboxMode ? { sandboxMode: context.sandboxMode } : {}),
    ...(context.threadMode ? { threadMode: context.threadMode } : {})
  }
}

function hookErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return `tool hook failed: ${message}`
}

/**
 * Tiny default tool used by smoke tests: echoes its argument so the
 * rest of the loop has a tool to call when the GUI hasn't provided any.
 */
export const echoTool: LocalTool = LocalToolHost.defineTool({
  name: 'echo',
  description: 'Echo the input argument back to the model.',
  toolKind: 'tool_call',
  inputSchema: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text']
  },
  policy: 'auto',
  execute: async (args) => ({ output: { echoed: args.text ?? '' } })
})

function createUserInputTool(name: string): LocalTool {
  const optionSchema = {
    anyOf: [
      { type: 'string' },
      {
        type: 'object',
        properties: {
          label: { type: 'string' },
          description: { type: 'string' }
        },
        required: ['label']
      }
    ]
  }
  return LocalToolHost.defineTool({
    name,
    description: 'Ask the GUI user a structured question and wait for the answer.',
    toolKind: 'tool_call',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        question: { type: 'string' },
        message: { type: 'string' },
        options: {
          type: 'array',
          description: 'Optional answer choices for a single question. Use strings or {label, description} objects.',
          items: optionSchema
        },
        questions: {
          type: 'array',
          description: 'One to three structured questions. Each question may include answer options.',
          items: {
            type: 'object',
            properties: {
              header: { type: 'string' },
              id: { type: 'string' },
              question: { type: 'string' },
              options: {
                type: 'array',
                items: optionSchema
              }
            },
            required: ['question']
          }
        }
      },
      required: []
    },
    policy: 'auto',
    execute: async (args, context) => {
      if (!context.awaitUserInput) {
        return {
          output: { error: 'GUI user input is not available in this runtime context' },
          isError: true
        }
      }
      const inputId = `in_${Math.random().toString(36).slice(2, 10)}`
      const itemId = `item_${inputId}`
      const prompt = String(args.prompt ?? args.question ?? args.message ?? 'Input requested')
      const questions = normalizeUserInputQuestions(args, inputId, prompt)
      const resolution = await context.awaitUserInput({ id: inputId, itemId, prompt, questions })
      return {
        output: resolution,
        isError: resolution.status === 'cancelled'
      }
    }
  })
}

export const userInputTool: LocalTool = createUserInputTool('user_input')
export const requestUserInputTool: LocalTool = createUserInputTool('request_user_input')

export const defaultLocalTools: LocalTool[] = [
  ...buildBuiltinLocalTools(),
  echoTool,
  userInputTool,
  requestUserInputTool
]

function normalizeUserInputQuestions(
  args: Record<string, unknown>,
  fallbackId: string,
  fallbackPrompt: string
): Array<{
  header: string
  id: string
  question: string
  options: Array<{ label: string; description: string }>
}> {
  const rawQuestions = Array.isArray(args.questions) ? args.questions : null
  if (rawQuestions && rawQuestions.length > 0) {
    const questions = rawQuestions
      .map((question, index) => normalizeUserInputQuestion(question, index, fallbackId))
      .filter((question) => question !== null)
    if (questions.length > 0) return questions
  }
  const options = Array.isArray(args.options)
    ? args.options
        .map((option) => normalizeUserInputOption(option))
        .filter((option) => option !== null)
    : []
  return [
    {
      header: 'Input',
      id: String(args.id ?? fallbackId),
      question: fallbackPrompt,
      options
    }
  ]
}

function normalizeUserInputQuestion(
  value: unknown,
  index: number,
  fallbackId: string
): {
  header: string
  id: string
  question: string
  options: Array<{ label: string; description: string }>
} | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const question = typeof raw.question === 'string' && raw.question.trim()
    ? raw.question.trim()
    : null
  if (!question) return null
  const options = Array.isArray(raw.options)
    ? raw.options
        .map((option) => normalizeUserInputOption(option))
        .filter((option) => option !== null)
    : []
  return {
    header: typeof raw.header === 'string' && raw.header.trim() ? raw.header.trim() : `Question ${index + 1}`,
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `${fallbackId}_${index + 1}`,
    question,
    options
  }
}

function normalizeUserInputOption(
  value: unknown
): { label: string; description: string } | null {
  if (typeof value === 'string' && value.trim()) {
    return {
      label: value.trim(),
      description: ''
    }
  }
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : null
  if (!label) return null
  return {
    label,
    description: typeof raw.description === 'string' ? raw.description : ''
  }
}

import { createCreatePlanTool, type CreatePlanAdapterOptions } from './create-plan-tool.js'

/**
 * Build the default tool list including the `create_plan` tool. The
 * `create_plan` tool is gated to plan/refine turns via its
 * `shouldAdvertise` predicate, so it is safe to ship with the
 * default set: non-plan turns never see it in the model tool list.
 */
export function buildDefaultLocalTools(
  planOptions: CreatePlanAdapterOptions = {},
  builtinOptions: BuiltinLocalToolsOptions = {}
): LocalTool[] {
  const baseTools = Object.keys(builtinOptions).length
    ? [...buildBuiltinLocalTools(builtinOptions), echoTool, userInputTool, requestUserInputTool]
    : defaultLocalTools
  return [...baseTools, createCreatePlanTool(planOptions)]
}
