/**
 * Transport-independent host for Kun tools bridged into delegated harnesses
 * (docs/ade/05 §3.2). The Agent SDK MCP adapter, the Cursor SDK custom-tools
 * adapter, and the Kun Tools MCP server all describe the same turn-scoped
 * catalog and run calls through the same boundary; only their request/result
 * wire formats differ. This module owns the shared semantics so each adapter
 * keeps only format conversion:
 *
 * - `resolveTurnScope` snapshots the turn's policy/plan/graph/surface/skill
 *   state once so prompt assembly and the tool listing stay consistent.
 * - `listTools` reproduces the native listing pipeline: plan/guiPlan context,
 *   SVG-artifact scoping, delegated-graph phase gating, room policy, client
 *   surface filtering, skill-gated advertisement, and overlap exclusion.
 * - `execute` runs every call through the real ToolHost — never a capability-
 *   registry bypass — under the scope's captured policy/route snapshot, while
 *   liveness, graph phase, plan context, skills, and canvas receipts re-resolve
 *   from the latest thread record.
 *
 * Overlap exclusion defaults to `DEFAULT_OVERLAP_TOOL_NAMES` and is suppressed
 * (empty set) for graph, room, plan, and harness-builtin-disabled scopes where
 * Kun tools are the only sanctioned path. A caller may pin a different overlap
 * set via `opts.overlap` (Cursor keeps its native read/write/bash priority).
 */
import type {
  CapabilityRegistry,
  CapabilityToolSpec
} from '../adapters/tool/capability-registry.js'
import type { SessionStore } from '../ports/session-store.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { TurnService } from '../services/turn-service.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import type {
  GuiPlanContext,
  ToolHost,
  ToolHostContext
} from '../ports/tool-host.js'
import type { UserInputGate } from '../ports/user-input-gate.js'
import type { ApprovalGate } from '../ports/approval-gate.js'
import type { ApprovalReviewPort } from '../ports/approval-review.js'
import type { SkillRuntime, SkillTurnResolution } from '../skills/skill-runtime.js'
import type { ActingTurnModelRoute, TurnClientSurface } from '../contracts/turns.js'
import {
  DEFAULT_APPROVAL_REVIEWER,
  DEFAULT_SANDBOX_MODE,
  type ApprovalPolicy,
  type ApprovalReviewer,
  type SandboxMode
} from '../contracts/policy.js'
import type { CanvasReceiptRegistry } from '../services/canvas-receipt-registry.js'
import { isPendingReceiptOutput } from '../services/canvas-receipt-registry.js'
import { isStalePlanContext } from '../loop/agent-loop.js'
import { SVG_ARTIFACT_ALLOWED_TOOL_NAMES } from '../loop/design-mode.js'
import { applyRoomToolPolicy, mergeRoomDeniedIds } from '../loop/room-turn-policy.js'
import { resolveTurnClientSurface } from '../loop/turn-context-resolver.js'
import {
  delegatedGraphAllowedToolNames,
  delegatedGraphTurnPolicy,
  intersectDelegatedToolNames,
  type DelegatedGraphTurnPolicy
} from '../runtime/delegated-graph-turn-policy.js'
import { makeDelegatedAwaitApproval } from '../ade/delegated-approval.js'
import { makeKunAwaitUserInput } from './kun-tool-user-input.js'
import {
  selectBridgeableTools,
  type BridgeableTool,
  type KunToolResult
} from '../runtime/agent-sdk/sdk-tool-bridge.js'

export type { BridgeableTool, KunToolResult }
export { waitForGate } from './kun-tool-user-input.js'

/**
 * A catalog spec coming out of the capability registry — carries the required
 * provider identity the Cursor adapter forwards back to ToolHost.execute.
 */
export type BridgedCatalogTool = Pick<
  CapabilityToolSpec,
  'name' | 'description' | 'inputSchema' | 'toolKind' | 'providerId' | 'providerKind'
>

/**
 * Resolve the plan-tool context for a turn. A non-stale GUI plan (the SDD
 * plan-mode flow) must stay visible so `create_plan` is both advertised and
 * executable; the dedicated SVG-artifact turn suppresses plan mode upstream.
 */
export function resolveTurnPlanContext(
  thread: ThreadRecord,
  turnId: string
): { planMode: boolean; guiPlan?: GuiPlanContext } {
  const turn = thread.turns.find((entry) => entry.id === turnId)
  const candidate = turn?.guiPlan ? ({ ...turn.guiPlan, turnId } as GuiPlanContext) : undefined
  const guiPlan = candidate && !isStalePlanContext(candidate, thread.workspace) ? candidate : undefined
  const planMode = (turn?.mode ?? thread.mode) === 'plan' || Boolean(guiPlan)
  return { planMode, ...(guiPlan ? { guiPlan } : {}) }
}

/** Static capability envelope applied to every context the host builds. */
export type KunToolContextBoundary = Pick<
  ToolHostContext,
  | 'allowedModelProviderIds'
  | 'allowedModelIds'
  | 'allowedProviderIds'
  | 'allowedToolNames'
  | 'allowedSkillIds'
  | 'allowedReadPaths'
  | 'allowHostReads'
  | 'allowedWritePaths'
  | 'allowedArtifactIds'
  | 'pptWorkflowScope'
  | 'blockedProviderIds'
  | 'blockedToolNames'
  | 'blockedSkillIds'
>

export type KunToolBridgeHostDeps = {
  threadStore: ThreadStore
  sessionStore: SessionStore
  registry: CapabilityRegistry
  toolHost?: ToolHost
  turns: Pick<TurnService, 'applyItem' | 'updateItem'>
  events: RuntimeEventRecorder
  ids: { next(prefix: string): string }
  receipts?: CanvasReceiptRegistry
  userInputGate?: UserInputGate
  approvalGate?: ApprovalGate
  approvalReview?: ApprovalReviewPort
  skillRuntime?: SkillRuntime
  toolContextBoundary?: KunToolContextBoundary
  defaultApprovalPolicy: ApprovalPolicy
  defaultSandboxMode?: SandboxMode
  defaultApprovalReviewer?: ApprovalReviewer
  /**
   * When false, the harness's own native tools are disabled for this scope
   * (delegated children / managed workflows). Combined with a scoped
   * `pptWorkflowScope`, overlap suppression applies to listing as well.
   */
  allowHarnessBuiltins?: boolean
  /** Read-only delegated scopes clamp policy/sandbox regardless of turn state. */
  enforceReadOnly?: boolean
  /** Fallback call-id prefix when the transport did not supply one. */
  callIdPrefix?: string
  nowIso?: () => string
}

/** One consistent snapshot of the turn state listing and prompts share. */
export type KunToolBridgeTurnScope = {
  thread: ThreadRecord
  turn: ThreadRecord['turns'][number]
  plan: { planMode: boolean; guiPlan?: GuiPlanContext }
  graphPolicy: DelegatedGraphTurnPolicy | null
  /** SVG-artifact turn whose tool catalog narrows to the SVG-allowed set. */
  dedicatedSvgTurn: boolean
  clientSurface: TurnClientSurface
  approvalPolicy: ApprovalPolicy
  sandboxMode: SandboxMode
  approvalReviewer: ApprovalReviewer
  actingModelRoute: ActingTurnModelRoute | undefined
  skillResolution: SkillTurnResolution | undefined
  /** Resolved-for-execution skill ids (the listing-time resolution). */
  activeSkillIds: readonly string[]
  /** Active ∪ workspace-visible ids used for catalog advertisement. */
  listingSkillIds: readonly string[]
}

export interface KunToolBridgeHost {
  resolveTurnScope(
    threadId: string,
    turnId: string,
    opts?: {
      /** Raw user text used for skill resolution; defaults to `turn.prompt`. */
      skillPrompt?: string
      /** Caller-resolved route (listing may precede turn metadata persistence). */
      actingModelRoute?: ActingTurnModelRoute
    }
  ): Promise<KunToolBridgeTurnScope | null>

  listTools(
    threadId: string,
    turnId: string,
    opts?: {
      overlap?: ReadonlySet<string>
      /** Reuse a previously resolved scope instead of re-resolving. */
      scope?: KunToolBridgeTurnScope
      skillPrompt?: string
      actingModelRoute?: ActingTurnModelRoute
    }
  ): Promise<BridgedCatalogTool[]>

  execute(
    threadId: string,
    turnId: string,
    call: {
      toolName: string
      args: Record<string, unknown>
      callId?: string
      /** Kun catalog identity forwarded to ToolHost.execute (Cursor passes it). */
      providerId?: string
      toolKind?: 'tool_call' | 'command_execution' | 'file_change'
      signal: AbortSignal
    }
  ): Promise<KunToolResult>

  /** Drop the turn's cached skill resolution when the turn finishes. */
  releaseTurn(threadId: string, turnId: string): void
}

export function createKunToolBridgeHost(deps: KunToolBridgeHostDeps): KunToolBridgeHost {
  // Skill activation is turn-scoped. Keep the exact listing-time result so
  // bridged execution sees the same skill-gated tools after a structured-input
  // pause/resume.
  const activeSkillIdsByTurn = new Map<string, readonly string[]>()
  const skillPromptByTurn = new Map<string, string>()
  // The turn's resolved policy/model-route snapshot is captured once at scope
  // resolution: a settings or thread edit mid-turn must not re-target an
  // in-flight bridged call. Listing can also run before the lifecycle persists
  // actingModelRoute onto the turn record, so execute prefers this cache.
  const scopeByTurn = new Map<string, KunToolBridgeTurnScope>()
  const skillTurnKey = (threadId: string, turnId: string): string =>
    `${threadId} ${turnId}`
  const nowIso = (): string => (deps.nowIso ? deps.nowIso() : new Date().toISOString())
  const callIdPrefix = deps.callIdPrefix ?? 'call'

  const resolveActiveSkillIds = async (
    thread: ThreadRecord,
    turn: ThreadRecord['turns'][number]
  ): Promise<readonly string[]> => {
    const key = skillTurnKey(thread.id, turn.id)
    if (!deps.skillRuntime || thread.roomContext?.skillsEnabled === false) {
      return activeSkillIdsByTurn.get(key) ?? []
    }
    const blockedSkillIds = mergeRoomDeniedIds(
      deps.toolContextBoundary?.blockedSkillIds,
      thread.roomContext?.blockedSkillIds
    )
    const resolution = await deps.skillRuntime.resolveTurn({
      prompt: skillPromptByTurn.get(key) ?? turn.prompt ?? '',
      workspace: thread.workspace,
      threadId: thread.id,
      turnId: turn.id,
      ...(deps.toolContextBoundary?.allowedSkillIds
        ? { allowedSkillIds: deps.toolContextBoundary.allowedSkillIds }
        : {}),
      ...(blockedSkillIds.length ? { blockedSkillIds } : {})
    })
    activeSkillIdsByTurn.set(key, resolution.activeSkillIds)
    return resolution.activeSkillIds
  }

  const makeAwaitUserInput = (
    threadId: string,
    turnId: string,
    signal: AbortSignal
  ): ToolHostContext['awaitUserInput'] =>
    makeKunAwaitUserInput({ ...deps, nowIso }, threadId, turnId, signal)

  const makeAwaitApproval = (
    scope: Pick<
      KunToolBridgeTurnScope,
      'approvalPolicy' | 'sandboxMode' | 'approvalReviewer' | 'actingModelRoute' | 'turn'
    >,
    signal: AbortSignal
  ): ToolHostContext['awaitApproval'] =>
    makeDelegatedAwaitApproval(
      {
        approvalGate: deps.approvalGate,
        approvalReview: deps.approvalReview,
        events: deps.events
      },
      {
        approvalPolicy: scope.approvalPolicy,
        sandboxMode: scope.sandboxMode,
        approvalReviewer: scope.approvalReviewer,
        actingModelRoute: scope.actingModelRoute!,
        intent: scope.turn.prompt,
        signal
      }
    )

  /**
   * Assemble the ToolHostContext a listing or execution crosses. Listing
   * contexts stay deny-closed: no tool may execute through them, but the
   * `user_input` capability presence advertises the structured input surface.
   */
  const buildToolContext = (
    scope: KunToolBridgeTurnScope,
    opts: {
      signal: AbortSignal
      listing?: boolean
      activeSkillIds: readonly string[]
      allowedToolNames?: readonly string[]
    }
  ): ToolHostContext => {
    const { thread, turn } = scope
    const allowedToolNames = intersectDelegatedToolNames(
      deps.toolContextBoundary?.allowedToolNames,
      intersectDelegatedToolNames(
        scope.dedicatedSvgTurn ? SVG_ARTIFACT_ALLOWED_TOOL_NAMES : undefined,
        opts.allowedToolNames
      )
    )
    const context: ToolHostContext = {
      threadId: thread.id,
      turnId: turn.id,
      workspace: thread.workspace,
      ...(thread.additionalWorkspaces?.length
        ? { additionalWorkspaces: thread.additionalWorkspaces }
        : {}),
      approvalPolicy: scope.approvalPolicy,
      approvalReviewer: scope.approvalReviewer,
      sandboxMode: scope.sandboxMode,
      ...(scope.actingModelRoute ? { actingModelRoute: scope.actingModelRoute } : {}),
      clientSurface: scope.clientSurface,
      approvalIntent: turn.prompt,
      abortSignal: opts.signal,
      ...deps.toolContextBoundary,
      ...(turn.orchestration ? { orchestration: turn.orchestration } : {}),
      ...(turn.harnessId ? { harnessId: turn.harnessId } : {}),
      ...(thread.workspaceMode ? { workspaceMode: thread.workspaceMode } : {}),
      ...(thread.executionUnit?.kind
        ? { executionUnitKind: thread.executionUnit.kind }
        : {}),
      ...(scope.plan.planMode ? { threadMode: 'plan' as const } : {}),
      ...(scope.plan.guiPlan ? { guiPlan: scope.plan.guiPlan } : {}),
      ...(turn.guiDesignCanvas ? { guiDesignCanvas: true } : {}),
      ...(turn.guiExcalidrawCanvas ? { guiExcalidrawCanvas: true } : {}),
      ...(turn.guiDesignMode ? { guiDesignMode: true } : {}),
      ...(turn.guiDesignArtifact ? { guiDesignArtifact: turn.guiDesignArtifact } : {}),
      ...(thread.toolCatalogEpoch
        ? { extensionToolCatalogEpoch: thread.toolCatalogEpoch }
        : {}),
      activeSkillIds: opts.activeSkillIds,
      ...(allowedToolNames ? { allowedToolNames } : {}),
      ...(turn.disableUserInput !== true
        ? {
            awaitUserInput: makeAwaitUserInput(
              thread.id,
              turn.id,
              opts.listing ? new AbortController().signal : opts.signal
            )
          }
        : {}),
      awaitApproval: opts.listing
        ? async () => 'deny'
        : makeAwaitApproval(scope, opts.signal)
    }
    return thread.roomContext ? applyRoomToolPolicy(context, thread) : context
  }

  const resolvePolicy = (
    thread: ThreadRecord,
    turn: ThreadRecord['turns'][number]
  ): Pick<
    KunToolBridgeTurnScope,
    'approvalPolicy' | 'sandboxMode' | 'approvalReviewer'
  > => ({
    approvalPolicy:
      deps.enforceReadOnly === true
        ? 'never'
        : turn.approvalPolicy ?? thread.approvalPolicy ?? deps.defaultApprovalPolicy,
    sandboxMode:
      deps.enforceReadOnly === true
        ? 'read-only'
        : turn.sandboxMode ??
          thread.sandboxMode ??
          deps.defaultSandboxMode ??
          DEFAULT_SANDBOX_MODE,
    approvalReviewer:
      turn.approvalReviewer ??
      thread.approvalReviewer ??
      deps.defaultApprovalReviewer ??
      DEFAULT_APPROVAL_REVIEWER
  })

  const resolveTurnScope: KunToolBridgeHost['resolveTurnScope'] = async (
    threadId,
    turnId,
    opts
  ) => {
    const thread = await deps.threadStore.get(threadId)
    const turn = thread?.turns.find((candidate) => candidate.id === turnId)
    if (!thread || !turn) return null
    const graphPolicy = delegatedGraphTurnPolicy(turn)
    const dedicatedSvgTurn = turn.guiDesignArtifact?.kind === 'svg' && !graphPolicy
    // A dedicated SVG-artifact turn is design work, not plan work — suppress
    // plan mode so create_plan stays out of the catalog.
    const plan = turn.guiDesignArtifact?.kind === 'svg'
      ? { planMode: false as const }
      : resolveTurnPlanContext(thread, turnId)
    const clientSurface = resolveTurnClientSurface(turn)
    const roomSkillsDisabled = thread.roomContext?.skillsEnabled === false
    const blockedSkillIds = mergeRoomDeniedIds(
      deps.toolContextBoundary?.blockedSkillIds,
      thread.roomContext?.blockedSkillIds
    )
    const allowedSkillIds = roomSkillsDisabled
      ? []
      : deps.toolContextBoundary?.allowedSkillIds
    const prompt = opts?.skillPrompt ?? turn.prompt ?? ''
    skillPromptByTurn.set(skillTurnKey(threadId, turnId), prompt)
    const skillResolution = !roomSkillsDisabled && deps.skillRuntime
      ? await deps.skillRuntime.resolveTurn({
          prompt,
          workspace: thread.workspace,
          threadId,
          turnId,
          ...(allowedSkillIds ? { allowedSkillIds } : {}),
          ...(blockedSkillIds.length ? { blockedSkillIds } : {})
        })
      : undefined
    const activeSkillIds = skillResolution?.activeSkillIds ?? []
    activeSkillIdsByTurn.set(skillTurnKey(threadId, turnId), activeSkillIds)
    // Pre-bridge schemas gated by skills visible in this workspace; execute
    // re-resolves the real active ids for every call, so schema visibility is
    // not execution authority.
    const availableSkillIds =
      !roomSkillsDisabled &&
      typeof deps.skillRuntime?.availableSkillIdsForWorkspace === 'function'
        ? await deps.skillRuntime.availableSkillIdsForWorkspace(
            thread.workspace,
            blockedSkillIds,
            allowedSkillIds
          )
        : activeSkillIds
    const scope: KunToolBridgeTurnScope = {
      thread,
      turn,
      plan,
      graphPolicy,
      dedicatedSvgTurn,
      clientSurface,
      ...resolvePolicy(thread, turn),
      actingModelRoute: opts?.actingModelRoute ?? turn.actingModelRoute,
      skillResolution,
      activeSkillIds,
      listingSkillIds: [...new Set([...activeSkillIds, ...availableSkillIds])]
    }
    scopeByTurn.set(skillTurnKey(threadId, turnId), scope)
    return scope
  }

  const listTools: KunToolBridgeHost['listTools'] = async (threadId, turnId, opts) => {
    const scope = opts?.scope ?? (await resolveTurnScope(threadId, turnId, opts))
    if (!scope) return []
    const listingSignal = new AbortController().signal
    const discoveryContext = buildToolContext(scope, {
      signal: listingSignal,
      listing: true,
      activeSkillIds: scope.listingSkillIds
    })
    if (deps.toolHost) {
      // Activate turn-scoped extension contributions before taking the
      // canonical registry snapshot the bridge advertises.
      await deps.toolHost.listTools(discoveryContext)
    }
    const graphAllowedToolNames = scope.graphPolicy
      ? delegatedGraphAllowedToolNames(
          deps.registry.listTools(discoveryContext),
          scope.graphPolicy.phase
        )
      : undefined
    const listingContext = buildToolContext(scope, {
      signal: listingSignal,
      listing: true,
      activeSkillIds: scope.listingSkillIds,
      ...(graphAllowedToolNames ? { allowedToolNames: graphAllowedToolNames } : {})
    })
    const catalog: BridgedCatalogTool[] = deps.registry
      .listTools(listingContext)
      .map((spec) => ({
        name: spec.name,
        description: spec.description,
        inputSchema: spec.inputSchema,
        providerId: spec.providerId,
        providerKind: spec.providerKind,
        toolKind: spec.toolKind
      }))
    const managedScope =
      deps.allowHarnessBuiltins === false &&
      deps.toolContextBoundary?.pptWorkflowScope !== undefined
    const suppressOverlap =
      Boolean(scope.graphPolicy) ||
      Boolean(scope.thread.roomContext) ||
      scope.plan.planMode ||
      managedScope
    return selectBridgeableTools(catalog, {
      overlap: opts?.overlap ?? (suppressOverlap ? new Set() : undefined)
    })
  }

  const execute: KunToolBridgeHost['execute'] = async (threadId, turnId, call) => {
    const thread = await deps.threadStore.get(threadId)
    const turn = thread?.turns.find((candidate) => candidate.id === turnId)
    if (!thread || !turn) {
      return { output: 'turn is no longer active; tool execution was cancelled', isError: true }
    }
    if (!deps.toolHost) {
      return { output: 'Kun tool host is unavailable; tool execution was denied', isError: true }
    }
    const graphPolicy = delegatedGraphTurnPolicy(turn)
    const dedicatedSvgTurn = turn.guiDesignArtifact?.kind === 'svg' && !graphPolicy
    // Re-resolve plan context so create_plan can write to its reserved path.
    const plan = turn.guiDesignArtifact?.kind === 'svg'
      ? { planMode: false as const }
      : resolveTurnPlanContext(thread, turnId)
    // The scope resolved at listing time carries the captured policy and
    // acting route; a later thread mutation must not re-target this turn's
    // in-flight calls. Turns that never listed (e.g. Kun Tools MCP direct
    // calls) fall back to live policy resolution.
    const captured = scopeByTurn.get(skillTurnKey(threadId, turnId))
    const actingModelRoute = captured?.actingModelRoute ?? turn.actingModelRoute
    if (!actingModelRoute) {
      return { output: 'Acting model route is unavailable; tool execution was denied', isError: true }
    }
    const scope: KunToolBridgeTurnScope = {
      thread,
      turn,
      plan,
      graphPolicy,
      dedicatedSvgTurn,
      clientSurface: resolveTurnClientSurface(turn),
      ...(captured
        ? {
            approvalPolicy: captured.approvalPolicy,
            sandboxMode: captured.sandboxMode,
            approvalReviewer: captured.approvalReviewer
          }
        : resolvePolicy(thread, turn)),
      actingModelRoute,
      skillResolution: undefined,
      activeSkillIds: await resolveActiveSkillIds(thread, turn),
      listingSkillIds: []
    }
    const discoveryContext = buildToolContext(scope, {
      signal: call.signal,
      activeSkillIds: scope.activeSkillIds
    })
    const graphAllowedToolNames = graphPolicy
      ? delegatedGraphAllowedToolNames(
          deps.registry.listTools(discoveryContext),
          graphPolicy.phase
        )
      : undefined
    const ctx = buildToolContext(scope, {
      signal: call.signal,
      activeSkillIds: scope.activeSkillIds,
      ...(graphAllowedToolNames ? { allowedToolNames: graphAllowedToolNames } : {})
    })
    try {
      // Bridged calls must cross the same ToolHost boundary as native turns.
      // Calling CapabilityRegistry.tool.execute directly would skip policy,
      // sandbox, approval, hooks, read-before-edit, and the operation journal.
      const toolCall = {
        callId: call.callId?.trim() || deps.ids.next(callIdPrefix),
        toolName: call.toolName,
        ...(call.providerId ? { providerId: call.providerId } : {}),
        ...(call.toolKind ? { toolKind: call.toolKind } : {}),
        arguments: call.args
      }
      const result = await deps.toolHost.execute(toolCall, ctx)
      if (result.item.kind !== 'tool_result') {
        return {
          output: `Kun tool ${call.toolName} returned an invalid result item`,
          isError: true
        }
      }
      if (isPendingReceiptOutput(result.item.output)) {
        if (!deps.receipts || !call.callId) {
          return {
            output:
              'Canvas receipt service or call identity is unavailable; application was not verified.',
            isError: true
          }
        }
        const item = { ...result.item, id: `item_toolresult_${turnId}_${call.callId}` }
        let finalized: KunToolResult | undefined
        deps.receipts.register({
          receiptKey: result.item.output.receiptKey,
          threadId,
          turnId,
          call: toolCall,
          itemId: item.id,
          acceptedOutput: result.item.output,
          onFinalized: (settled) => {
            finalized = { output: settled.output, isError: settled.isError }
          }
        })
        await deps.turns.applyItem(threadId, item)
        await deps.receipts.awaitReceipt(result.item.output.receiptKey, 30_000)
        if (finalized) return finalized
        return { output: 'Renderer receipt timed out; the canvas was not verified.', isError: true }
      }
      return { output: result.item.output, isError: result.item.isError }
    } catch (err) {
      return { output: err instanceof Error ? err.message : String(err), isError: true }
    }
  }

  const releaseTurn: KunToolBridgeHost['releaseTurn'] = (threadId, turnId) => {
    const key = skillTurnKey(threadId, turnId)
    activeSkillIdsByTurn.delete(key)
    skillPromptByTurn.delete(key)
    scopeByTurn.delete(key)
  }

  return { resolveTurnScope, listTools, execute, releaseTurn }
}
