import { randomUUID } from 'node:crypto'
import type { ToolHost, ToolHostContext, ToolHostResult, ToolCallLike } from '../../ports/tool-host.js'
import type { ApprovalRequest } from '../../domain/approval.js'
import { createApprovalActionEnvelope, createApprovalRequest, safeApprovalActionSummary } from '../../domain/approval.js'
import type { TurnItem } from '../../contracts/items.js'
import { makeToolResultItem } from '../../domain/item.js'
import { CapabilityRegistry } from './capability-registry.js'
import { runPostToolUseHooks, runPreToolUseHooks, type PostToolUseOutcome, type PreToolUseOutcome } from '../../hooks/hook-engine.js'
import type { ResolvedHook } from '../../hooks/hook-engine.js'
import { normalizeRateLimitedToolOutput } from './tool-rate-limit.js'
import { normalizeReadTrackerOptions, ReadTracker } from './read-tracker.js'
import { effectiveSandboxMode, externalWriteTargetsForApproval, isWorkspaceApprovalCommandTool, sandboxBlockForTool, type SandboxBlock } from './sandbox-policy.js'
import { createToolOperationIdentity, ToolOperationJournal } from '../../reliability/operation-journal.js'
import { planModeToolBlock } from './plan-mode-tool-policy.js'
import { normalizeRawToolArgumentsEnvelope } from '../../domain/tool-argument-envelope.js'
import { hookContext, hookErrorMessage, isUnknownOutcomeError, offloadLargeToolOutput } from './local-tool-host-runtime.js'
import type { LocalTool, LocalToolHostOptions } from './local-tool-host-types.js'

const KUN_ACTION_APPROVAL_GRANT_TTL_MS = 2 * 60 * 1_000

export class LocalToolHost implements ToolHost {
  readonly id = 'local'
  private registry: CapabilityRegistry
  private readonly allowList: Set<string>
  private hooks: readonly ResolvedHook[]
  private readonly readTracker: ReadTracker
  private readonly operationJournal: ToolOperationJournal
  private prepare?: (context?: ToolHostContext) => Promise<void> | void
  private generation = 0
  private readonly turnComponents = new Map<string, {
    registry: CapabilityRegistry
    hooks: readonly ResolvedHook[]
    prepare?: (context?: ToolHostContext) => Promise<void> | void
    generation: number
    touchedAt: number
  }>()

  constructor(options: LocalToolHostOptions) {
    this.registry = options.registry ?? CapabilityRegistry.fromLocalTools(options.tools ?? [])
    this.allowList = new Set(options.allowList ?? [])
    this.hooks = options.hooks ?? []
    this.readTracker = new ReadTracker(normalizeReadTrackerOptions(options.readTracker))
    this.operationJournal = options.operationJournal ?? new ToolOperationJournal()
    this.prepare = options.prepare
  }

  replaceRuntimeComponents(input: {
    registry?: CapabilityRegistry
    hooks?: readonly ResolvedHook[]
    prepare?: (context?: ToolHostContext) => Promise<void> | void
  }): void {
    if (input.registry) this.registry = input.registry
    if (input.hooks) this.hooks = input.hooks
    if (input.prepare) this.prepare = input.prepare
    this.generation += 1
    this.pruneTurnComponents()
  }

  listTools(context?: ToolHostContext) {
    const components = this.componentsFor(context)
    const prepared = components.prepare?.(context)
    if (prepared && typeof (prepared as PromiseLike<void>).then === 'function') {
      return Promise.resolve(prepared).then(() => components.registry.listTools(context))
    }
    // Evaluate before Promise.resolve so existing callers retain synchronous
    // catalog-drift validation when no lazy preparation is configured.
    return Promise.resolve(components.registry.listTools(context))
  }

  diagnostics() {
    return this.registry.diagnostics()
  }

  async execute(
    call: ToolCallLike,
    context: ToolHostContext,
    onUpdate?: (item: TurnItem) => Promise<void> | void
  ): Promise<ToolHostResult> {
    const components = this.componentsFor(context)
    await components.prepare?.(context)
    if (context.abortSignal.aborted) {
      throw new Error('tool call aborted before start')
    }
    const { tool, provider } = components.registry.resolveTool(
      call.toolName,
      context,
      call.providerId
    )
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
      preHooks = await runPreToolUseHooks(components.hooks, {
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
    const transportArguments = normalizeRawToolArgumentsEnvelope(preHooks.call.arguments)
    const normalizedArguments = tool.normalizeArguments
      ? tool.normalizeArguments(transportArguments)
      : transportArguments
    const activeCall = normalizedArguments === preHooks.call.arguments
      ? preHooks.call
      : { ...preHooks.call, arguments: normalizedArguments }
    const planModeBlock = await planModeToolBlock(tool, activeCall, context)
    if (planModeBlock) {
      return {
        item: this.errorToolResult(
          context,
          activeCall,
          tool,
          planModeBlock.message,
          planModeBlock.code
        ),
        approved: false
      }
    }
    const readValidation = this.readTracker.validateBeforeTool({ context, call: activeCall })
    if (!readValidation.ok) {
      return {
        item: this.errorToolResult(
          context,
          activeCall,
          tool,
          readValidation.message,
          'read_before_edit_required',
          {
            guidance: readValidation.guidance,
            next_action: readValidation.nextAction,
            retry_tool: activeCall.toolName
          }
        ),
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
    let externalWriteTargets: Awaited<ReturnType<typeof externalWriteTargetsForApproval>>
    try {
      externalWriteTargets = await externalWriteTargetsForApproval(tool, activeCall, context)
    } catch (error) {
      return {
        item: this.errorToolResult(
          context,
          activeCall,
          tool,
          error instanceof Error ? error.message : String(error),
          'sandbox_write_blocked'
        ),
        approved: false
      }
    }
    const externalPathApproval = externalWriteTargets.length > 0
    const workspaceCommandApproval =
      effectiveSandboxMode(context) === 'workspace-write' &&
      isWorkspaceApprovalCommandTool({
        name: activeCall.toolName,
        toolKind: activeCall.toolKind ?? tool.toolKind
      })
    let explicitApprovalRequired: boolean
    try {
      explicitApprovalRequired = typeof tool.requiresExplicitApproval === 'function'
        ? tool.requiresExplicitApproval(activeCall, context)
        : tool.requiresExplicitApproval === true
    } catch (error) {
      return {
        item: this.errorToolResult(
          context,
          activeCall,
          tool,
          error instanceof Error ? error.message : String(error),
          'approval_classification_failed'
        ),
        approved: false
      }
    }
    // A configured hook may auto-approve ordinary tool calls, but it must not
    // bypass an explicit user decision for an external side effect or an
    // unrestricted host command exposed by workspace-write.
    const fullAccess =
      context.approvalPolicy === 'auto' &&
      effectiveSandboxMode(context) === 'danger-full-access'
    const needsApproval = (
      tool.requiresApprovalInFullAccess === true && explicitApprovalRequired
    ) || (!fullAccess && (
      externalPathApproval ||
      workspaceCommandApproval ||
      explicitApprovalRequired ||
      (!preHooks.autoApproved && this.requiresApproval(tool, activeCall, context))
    ))
    let kunActionApprovalGrant: ToolHostContext['kunActionApprovalGrant']
    if (needsApproval) {
      const approvalId = `appr_${randomUUID().replaceAll('-', '')}`
      const approvalReason = externalPathApproval
        ? 'exact external workspace file write requires approval'
        : workspaceCommandApproval
          ? 'host command execution from the workspace sandbox requires approval'
          : explicitApprovalRequired
            ? 'external side effect requires explicit approval'
            : 'runtime tool policy requires approval'
      const action = createApprovalActionEnvelope({
        toolName: activeCall.toolName,
        providerId: provider.id,
        providerKind: provider.kind,
        toolKind: activeCall.toolKind ?? tool.toolKind,
        effects: tool.effects ?? provider.effects,
        arguments: activeCall.arguments,
        workspace: context.workspace,
        cwd: typeof activeCall.arguments.cwd === 'string'
          ? activeCall.arguments.cwd
          : context.workspace,
        exactFileTargets: externalWriteTargets.map((target) => target.path),
        reason: approvalReason
      })
      const approval: ApprovalRequest = createApprovalRequest({
        id: approvalId,
        threadId: context.threadId,
        turnId: context.turnId,
        toolName: activeCall.toolName,
        summary: safeApprovalActionSummary(action),
        action
      })
      const resolution = await context.awaitApproval(approval)
      const decision = typeof resolution === 'string' ? resolution : resolution.decision
      if (decision !== 'allow') {
        const reason = typeof resolution === 'string' ? undefined : resolution.reason
        const reviewer = typeof resolution === 'string'
          ? context.approvalReviewer ?? 'user'
          : resolution.reviewer ?? context.approvalReviewer ?? 'user'
        const reviewDetails = typeof resolution === 'string'
          ? {}
          : {
              ...(resolution.reviewId ? { reviewId: resolution.reviewId } : {}),
              ...(resolution.riskLevel ? { riskLevel: resolution.riskLevel } : {}),
              ...(resolution.reviewStatus ? { reviewStatus: resolution.reviewStatus } : {})
            }
        const actor = reviewer === 'agent' ? 'Agent reviewer' : 'User'
        return {
          item: makeToolResultItem({
            id: `item_${activeCall.callId}`,
            turnId: context.turnId,
            threadId: context.threadId,
            callId: activeCall.callId,
            toolName: activeCall.toolName,
            toolKind: activeCall.toolKind ?? tool.toolKind,
            output: {
              code: 'approval_denied',
              error: reason
                ? `${actor} denied approval for ${activeCall.toolName}: ${reason}`
                : `${actor} denied approval for ${activeCall.toolName}`,
              approvalId,
              reviewer,
              ...(reason ? { reason } : {}),
              ...reviewDetails
            },
            isError: true
          }),
          approved: false
        }
      }
      const reviewer = typeof resolution === 'string'
        ? context.approvalReviewer ?? 'user'
        : resolution.reviewer ?? context.approvalReviewer ?? 'user'
      const issuedAt = new Date()
      kunActionApprovalGrant = Object.freeze({
        id: approvalId,
        source: reviewer,
        toolName: activeCall.toolName,
        callId: activeCall.callId,
        argumentsHash: ToolOperationJournal.argsHash(activeCall.arguments),
        issuedAt: issuedAt.toISOString(),
        expiresAt: new Date(
          issuedAt.getTime() + KUN_ACTION_APPROVAL_GRANT_TTL_MS
        ).toISOString()
      })
    } else if (fullAccess && explicitApprovalRequired) {
      const issuedAt = new Date()
      kunActionApprovalGrant = Object.freeze({
        id: `grant_${randomUUID().replaceAll('-', '')}`,
        source: 'full-access',
        toolName: activeCall.toolName,
        callId: activeCall.callId,
        argumentsHash: ToolOperationJournal.argsHash(activeCall.arguments),
        issuedAt: issuedAt.toISOString(),
        expiresAt: new Date(
          issuedAt.getTime() + KUN_ACTION_APPROVAL_GRANT_TTL_MS
        ).toISOString()
      })
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
    const priorOperation = this.operationJournal.get(operationIdentity)
    if (priorOperation?.status === 'unknown') {
      return {
        item: this.errorToolResult(
          context,
          activeCall,
          tool,
          `Tool side-effect outcome is unknown and will not be retried automatically: ${priorOperation.reason}`,
          'tool_outcome_unknown'
        ),
        approved: !needsApproval
      }
    }
    if (priorOperation?.status === 'started') {
      return {
        item: this.errorToolResult(
          context,
          activeCall,
          tool,
          'An invocation with the same operation identity is still in progress.',
          'tool_invocation_in_progress'
        ),
        approved: !needsApproval
      }
    }
    const replayed = this.operationJournal.getCompleted(operationIdentity)
    if (replayed) {
      return {
        item: this.completedToolResult(context, activeCall, tool, replayed.output, replayed.isError),
        approved: !needsApproval
      }
    }
    this.operationJournal.begin(operationIdentity)
    // Grants are minted by this host after an approval and must never be
    // accepted from a reused/caller-supplied context.
    const ungrantedContext = { ...context }
    delete ungrantedContext.approvedExternalWriteTargets
    delete ungrantedContext.kunActionApprovalGrant
    delete ungrantedContext.activeToolCallId
    const approvedExternalWriteTargets = Object.freeze(
      externalWriteTargets.map((target) => Object.freeze({ ...target }))
    )
    const executionContext = {
      ...ungrantedContext,
      activeToolCallId: activeCall.callId,
      ...(externalPathApproval ? { approvedExternalWriteTargets } : {}),
      ...(kunActionApprovalGrant ? { kunActionApprovalGrant } : {})
    }
    let result: Awaited<ReturnType<LocalTool['execute']>>
    try {
      result = await tool.execute(activeCall.arguments, executionContext, async (update) => {
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
      if (isUnknownOutcomeError(error)) {
        this.operationJournal.unknown(operationIdentity, error instanceof Error ? error.message : String(error))
      } else {
        this.operationJournal.fail(operationIdentity, error)
      }
      const message = error instanceof Error ? error.message : String(error)
      return {
        item: this.errorToolResult(context, activeCall, tool, message, 'tool_execution_failed'),
        approved: true
      }
    }
    let hookedResult: PostToolUseOutcome
    try {
      hookedResult = await runPostToolUseHooks(components.hooks, {
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

  private componentsFor(context?: ToolHostContext): {
    registry: CapabilityRegistry
    hooks: readonly ResolvedHook[]
    prepare?: (context?: ToolHostContext) => Promise<void> | void
    generation: number
    touchedAt: number
  } {
    const turnId = context?.turnId
    const now = Date.now()
    if (!turnId) {
      return {
        registry: this.registry,
        hooks: this.hooks,
        ...(this.prepare ? { prepare: this.prepare } : {}),
        generation: this.generation,
        touchedAt: now
      }
    }
    const existing = this.turnComponents.get(turnId)
    if (existing) {
      existing.touchedAt = now
      return existing
    }
    const pinned = {
      registry: this.registry,
      hooks: this.hooks,
      ...(this.prepare ? { prepare: this.prepare } : {}),
      generation: this.generation,
      touchedAt: now
    }
    this.turnComponents.set(turnId, pinned)
    this.pruneTurnComponents(now)
    return pinned
  }

  private pruneTurnComponents(now = Date.now()): void {
    const staleBefore = now - 6 * 60 * 60 * 1_000
    for (const [turnId, components] of this.turnComponents) {
      if (components.touchedAt < staleBefore) this.turnComponents.delete(turnId)
    }
    if (this.turnComponents.size <= 4_000) return
    const oldest = [...this.turnComponents.entries()]
      .sort((left, right) => left[1].touchedAt - right[1].touchedAt)
      .slice(0, this.turnComponents.size - 2_000)
    for (const [turnId] of oldest) this.turnComponents.delete(turnId)
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
    code: string,
    details: Record<string, unknown> = {}
  ): TurnItem {
    return makeToolResultItem({
      id: `item_${call.callId}`,
      turnId: context.turnId,
      threadId: context.threadId,
      callId: call.callId,
      toolName: call.toolName,
      toolKind: call.toolKind ?? tool.toolKind,
      output: { ...details, code, error: message },
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
      ...(tool.sideEffect ? { sideEffect: tool.sideEffect } : {}),
      ...(tool.effects ? { effects: { ...tool.effects } } : {}),
      execute: tool.execute,
      ...(tool.modelAdvertised === false ? { modelAdvertised: false } : {}),
      ...(tool.shouldAdvertise ? { shouldAdvertise: tool.shouldAdvertise } : {}),
      ...(tool.normalizeArguments ? { normalizeArguments: tool.normalizeArguments } : {}),
      ...(tool.requiresExplicitApproval
        ? { requiresExplicitApproval: tool.requiresExplicitApproval }
        : {}),
      ...(tool.requiresApprovalInFullAccess
        ? { requiresApprovalInFullAccess: true }
        : {}),
      ...(tool.externalWritePathArguments?.length
        ? { externalWritePathArguments: [...tool.externalWritePathArguments] }
        : {})
    }
  }
}
