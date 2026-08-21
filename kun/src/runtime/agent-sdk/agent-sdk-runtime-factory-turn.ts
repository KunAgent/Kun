/**
 * Binds the decoupled {@link AgentSdkRuntime} to kun's real runtime services.
 * This is the only place that touches the SDK package and kun's concrete stores,
 * keeping the orchestration (and its tests) free of both.
 */
import {
  AgentSdkCredentialUnavailableError,
  AgentSdkRuntime,
  agentSdkCapabilities,
  type SdkRuntimeDeps,
  type SdkTurnContext
} from './agent-sdk-runtime.js'
import type { SdkStreamResourceLimits } from './sdk-event-mapper.js'
import {
  normalizeClaudeOAuthToken,
  resolveSdkModel,
  type ToolApprovalDecision
} from './sdk-options-builder.js'
import {
  selectBridgeableTools,
  type BridgeableTool,
  type KunToolResult
} from './sdk-tool-bridge.js'
import type { SdkApi } from './sdk-protocol.js'
import { subscriptionBillingKind } from '../../shared/subscription-billing.js'
import type { RuntimeEventRecorder } from '../../services/runtime-event-recorder.js'
import type { LlmDebugSink } from '../../services/llm-debug-recorder.js'
import type { TurnService } from '../../services/turn-service.js'
import type { TurnRunOutcome } from '../../loop/turn-execution-types.js'
import type { SessionStore } from '../../ports/session-store.js'
import type { ThreadStore } from '../../ports/thread-store.js'
import type { CapabilityRegistry } from '../../adapters/tool/capability-registry.js'
import type { ToolHost, ToolHostContext } from '../../ports/tool-host.js'
import {
  DEFAULT_APPROVAL_REVIEWER,
  DEFAULT_SANDBOX_MODE,
  type ApprovalPolicy,
  type ApprovalReviewer,
  type SandboxMode
} from '../../contracts/policy.js'
import type { ServeProviderConfig } from '../../config/kun-config.js'
import type { AttachmentStore } from '../../attachments/attachment-store.js'
import type { SkillRuntime } from '../../skills/skill-runtime.js'
import type { InstructionRuntime } from '../../instructions/instruction-runtime.js'
import type { MemoryStore } from '../../memory/memory-store.js'
import {
  PLAN_MODE_INSTRUCTION,
  todoContinuationInstruction,
  memoryInstructions,
  isStalePlanContext
} from '../../loop/agent-loop.js'
import {
  filterGoalContextsForGoalKey,
  goalContextKey
} from '../../loop/continuation-instructions.js'
import {
  DESIGN_MODE_INSTRUCTION,
  SVG_ARTIFACT_ALLOWED_TOOL_NAMES,
  SVG_ARTIFACT_MODE_INSTRUCTION
} from '../../loop/design-mode.js'
import type { GuiDesignArtifactContext, GuiPlanContext } from '../../ports/tool-host.js'
import type { ThreadRecord } from '../../contracts/threads.js'
import type {
  UserInputGate,
  UserInputRequest,
  UserInputResolution
} from '../../ports/user-input-gate.js'
import { goalContextTexts, type TurnItem } from '../../contracts/items.js'
import type { ApprovalGate } from '../../ports/approval-gate.js'
import {
  createApprovalActionEnvelope,
  createApprovalRequest,
  safeApprovalActionSummary,
  type ApprovalRequest,
  type ApprovalResolution
} from '../../domain/approval.js'
import type { ApprovalReviewPort } from '../../ports/approval-review.js'
import type { ActingTurnModelRoute } from '../../contracts/turns.js'
import { makeUserInputItem } from '../../domain/item.js'
import { awaitAbortableGate } from '../../services/interactive-gate.js'
import {
  buildHistoryTranscript,
  DEFAULT_SDK_HISTORY_TRANSCRIPT_MAX_BYTES
} from './sdk-context-assembler.js'
import { shellSpawnEnv } from '../../adapters/tool/builtin-tool-utils.js'
import type { TurnLimitsConfig } from '../../loop/turn-limits.js'
import { userMessageTextWithComposerContexts } from '../../domain/composer-context.js'
import { mkdir } from 'node:fs/promises'
import { resolveTurnClientSurface } from '../../loop/turn-context-resolver.js'
import { buildClientSurfaceInstruction } from '../../prompt/kun-prompt-context.js'
import { projectTurnDynamicContext } from '../../prompt/turn-persona-context.js'
import {
  delegatedCapabilityFingerprint,
  delegatedCredentialIdentity,
  priorItemsForDelegatedTurn,
  type DelegatedSessionCoordinator,
  type DelegatedSessionPreparation
} from '../delegated-session-binding.js'
import {
  delegatedGraphCompletionCheck,
  delegatedGraphAllowedToolNames,
  delegatedGraphTurnPolicy,
  intersectDelegatedToolNames,
  parkDelegatedGraphTurnAfterRecovery
} from '../delegated-graph-turn-policy.js'

const CLAUDE_KUN_TOOL_INSTRUCTION = [
  'Kun-managed capabilities are available through the mcp__kun__ tools.',
  'Use these tools for Kun capabilities such as MCP, extensions, skills, memory, media, GUI input, and delegation.',
  'Their execution remains governed by Kun ToolHost approval and sandbox policy.'
].join(' ')

const SDK_ON_REQUEST_AUTO_ALLOWED_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'TodoWrite'
])
import type { AgentSdkRuntimeFactoryDeps } from './agent-sdk-runtime-factory-contracts.js'
import { resolveTurnPlanContext } from './agent-sdk-runtime-factory-plan.js'
import type { AgentSdkFactoryContext } from './agent-sdk-runtime-factory-context.js'

export function createAgentSdkTurnRuntimeDeps(
  deps: AgentSdkRuntimeFactoryDeps,
  context: AgentSdkFactoryContext
): Pick<SdkRuntimeDeps, 'handlesProvider' | 'loadTurnContext'> {
  const { sessionIdsByTurn, sessionPreparationsByTurn, sessionGoalContextKeysByTurn, activeSkillIdsByTurn, skillPromptByTurn, skillTurnKey, resolveActiveSkillIds, nowIso, makeAwaitUserInput, makeAwaitApproval, toolContext, resolveImages } = context
  return {
    handlesProvider: (providerId) => {
      if (providerId && deps.agentSdkProviderIds.has(providerId)) return true
      if (!deps.defaultIsAgentSdk) return false
      // The runtime default is agent-sdk: claim turns that don't target a
      // specific HTTP provider (absent providerId, or one with no http config).
      return !providerId || !deps.providerConfigs[providerId]
    },

    async loadTurnContext(threadId, turnId, signal): Promise<SdkTurnContext | null> {
      if (signal?.aborted) return null
      const thread = await deps.threadStore.get(threadId)
      if (!thread) return null
      const turn = thread.turns.find((candidate) => candidate.id === turnId)
      if (!turn) return null
      let items = await deps.sessionStore.loadItems(threadId)
      const userItem = [...items]
        .reverse()
        .find((item) => item.turnId === turnId && item.kind === 'user_message')
      const userText =
        userItem && 'text' in userItem ? String((userItem as { text?: unknown }).text ?? '') : ''
      const managedPptScope = deps.allowSdkBuiltins === false &&
        deps.toolContextBoundary?.pptWorkflowScope !== undefined
      const modelUserText = managedPptScope || userItem?.kind !== 'user_message'
        ? userText
        : userMessageTextWithComposerContexts(userItem)
      const attachmentIds =
        (userItem as { attachmentIds?: string[] } | undefined)?.attachmentIds ?? []
      const images = await resolveImages(threadId, thread.workspace, attachmentIds)
      if (!userText.trim() && images.length === 0) return null

      const requestedProviderId = turn?.providerId?.trim()
      const requestedRouteProviderId = requestedProviderId || thread.providerId?.trim()
      const explicitRouteProviderId =
        requestedRouteProviderId && requestedRouteProviderId !== 'default'
          ? requestedRouteProviderId
          : undefined
      const actingProviderId =
        explicitRouteProviderId || (deps.defaultIsAgentSdk ? 'default' : undefined)
      const requestedAccountId = turn.accountId?.trim() || (
        !requestedProviderId || requestedProviderId === thread.providerId?.trim()
          ? thread.accountId?.trim()
          : undefined
      )
      const selectedModel = resolveSdkModel(turn?.model || thread.model, deps.defaultModel)
      const actingModelRoute: ActingTurnModelRoute = turn.actingModelRoute ?? {
        model: selectedModel ?? 'claude-default',
        ...(actingProviderId ? { providerId: actingProviderId } : {}),
        ...(requestedAccountId ? { accountId: requestedAccountId } : {})
      }
      if (!turn.actingModelRoute) {
        await deps.turns.updateTurnMetadata(threadId, turnId, { actingModelRoute })
      }
      const providerId = actingModelRoute.providerId
      const accountId = actingModelRoute.accountId
      const providerCfg = explicitRouteProviderId
        ? deps.providerConfigs[explicitRouteProviderId]
        : undefined
      const billingKind = subscriptionBillingKind({
        authType: providerCfg?.authType,
        presetSource: providerCfg?.presetSource,
        providerId: actingProviderId,
        baseUrl: providerCfg?.baseUrl
      })
      const model = actingModelRoute.model
      const approvalPolicy =
        turn.approvalPolicy ?? thread.approvalPolicy ?? deps.defaultApprovalPolicy
      const sandboxMode =
        turn.sandboxMode ?? thread.sandboxMode ?? deps.defaultSandboxMode
      const approvalReviewer =
        turn.approvalReviewer ??
        thread.approvalReviewer ??
        deps.defaultApprovalReviewer ??
        DEFAULT_APPROVAL_REVIEWER
      // An explicit Claude provider owns its credential boundary. Empty means
      // ambient Claude Code login only when it has no managed credential
      // source. Managed sources are re-read for every turn so a fence written
      // by another Runtime fails closed before the SDK can use cached material.
      const credentialSourceId = explicitRouteProviderId
        ? providerCfg?.credentialSourceId
        : deps.defaultCredentialSourceId
      let rawToken = explicitRouteProviderId ? providerCfg?.apiKey : deps.defaultToken
      if (credentialSourceId) {
        const resolved = await deps.resolveCredentialSource?.(credentialSourceId).catch(() => null)
        rawToken = resolved?.apiKey ?? ''
        if (!rawToken.trim()) throw new AgentSdkCredentialUnavailableError()
      }
      const token = normalizeClaudeOAuthToken(rawToken)
      // Resolve skills before listing bridgeable tools so the SDK sees the
      // same per-turn catalog as the native Kun loop.
      const skillResolution = deps.skillRuntime
        ? await deps.skillRuntime.resolveTurn({
            prompt: userText,
            workspace: thread.workspace,
            threadId,
            turnId,
            ...(deps.toolContextBoundary?.allowedSkillIds
              ? { allowedSkillIds: deps.toolContextBoundary.allowedSkillIds }
              : {}),
            ...(deps.toolContextBoundary?.blockedSkillIds
              ? { blockedSkillIds: deps.toolContextBoundary.blockedSkillIds }
              : {})
          })
        : undefined
      const activeSkillIds = skillResolution?.activeSkillIds ?? []
      const turnKey = skillTurnKey(threadId, turnId)
      activeSkillIdsByTurn.set(turnKey, activeSkillIds)
      skillPromptByTurn.set(turnKey, userText)
      // Plan turns expose create_plan (and narrow kun tools to the plan-allowed
      // set); resolve before listing tools so the bridge sees create_plan.
      // awaitUserInput presence is what advertises `user_input` (the signal here
      // is only for advertisement; the real per-call signal is set on execution).
      const dedicatedSvgTurn = turn.guiDesignArtifact?.kind === 'svg'
      const clientSurface = resolveTurnClientSurface(turn)
      const awaitUserInput = turn.disableUserInput === true
        ? undefined
        : makeAwaitUserInput(threadId, turnId, new AbortController().signal)
      const plan = dedicatedSvgTurn
        ? { planMode: false as const }
        : resolveTurnPlanContext(thread, turnId)
      if (!plan.planMode && thread.goal?.status === 'active') {
        await deps.turns.ensureGoalContext(threadId, turnId, signal)
        // Goal context is persisted by TurnService outside the public thread
        // projection. Reload canonical history before the SDK transcript and
        // delegated-session digest are assembled.
        items = await deps.sessionStore.loadItems(threadId)
      }
      if (signal?.aborted) return null
      const goalForHistory = plan.planMode
        ? undefined
        : (await deps.threadStore.get(threadId))?.goal
      const goalContextKeyForHistory = goalContextKey(goalForHistory)
      items = filterGoalContextsForGoalKey(items, goalContextKeyForHistory)
      const turnDynamicContext = projectTurnDynamicContext({
        turnId,
        persona: turn.persona,
        items
      })
      items = [...turnDynamicContext.historyItems]
      const graphPolicy = delegatedGraphTurnPolicy(turn)
      // An Agent SDK query pins its in-process MCP schemas at startup and
      // cannot add tools after `load_skill` returns. Pre-bridge schemas gated
      // by skills visible in this workspace; executeKunTool still re-resolves
      // the real active ids for every call, so schema visibility is not
      // execution authority.
      const availableSkillIds = typeof deps.skillRuntime?.availableSkillIdsForWorkspace === 'function'
        ? await deps.skillRuntime.availableSkillIdsForWorkspace(
            thread.workspace,
            deps.toolContextBoundary?.blockedSkillIds,
            deps.toolContextBoundary?.allowedSkillIds
          )
        : activeSkillIds
      const listingOptions = {
        additionalWorkspaces: thread.additionalWorkspaces,
        ...plan,
        ...(turn?.guiDesignCanvas ? { guiDesignCanvas: true } : {}),
        ...(turn?.guiDesignMode ? { guiDesignMode: true } : {}),
        ...(turn?.guiDesignArtifact ? { guiDesignArtifact: turn.guiDesignArtifact } : {}),
        activeSkillIds: [...new Set([...activeSkillIds, ...availableSkillIds])],
        clientSurface,
        sandboxMode,
        approvalPolicy,
        approvalReviewer,
        actingModelRoute,
        ...(turn.orchestration ? { orchestration: turn.orchestration } : {}),
        ...(awaitUserInput ? { awaitUserInput } : {})
      }
      const discoveryContext = toolContext(threadId, turnId, thread.workspace, {
        ...listingOptions,
        ...(!graphPolicy && turn.guiDesignArtifact?.kind === 'svg'
          ? { allowedToolNames: SVG_ARTIFACT_ALLOWED_TOOL_NAMES }
          : {})
      })
      if (deps.toolHost) {
        // Activate turn-scoped extension contributions before taking the
        // canonical registry snapshot used by the SDK MCP bridge.
        await deps.toolHost.listTools(discoveryContext)
      }
      const graphAllowedToolNames = graphPolicy
        ? delegatedGraphAllowedToolNames(
            deps.registry.listTools(discoveryContext),
            graphPolicy.phase
          )
        : undefined
      const bridgeListingContext = toolContext(threadId, turnId, thread.workspace, {
        ...listingOptions,
        ...(intersectDelegatedToolNames(
          !graphPolicy && turn.guiDesignArtifact?.kind === 'svg'
            ? SVG_ARTIFACT_ALLOWED_TOOL_NAMES
            : undefined,
          graphAllowedToolNames
        )
          ? {
              allowedToolNames: intersectDelegatedToolNames(
                !graphPolicy && turn.guiDesignArtifact?.kind === 'svg'
                  ? SVG_ARTIFACT_ALLOWED_TOOL_NAMES
                  : undefined,
                graphAllowedToolNames
              )
            }
          : {})
      })
      const bridgeableTools: BridgeableTool[] = deps.registry.listTools(bridgeListingContext).map((spec) => ({
        name: spec.name,
        description: spec.description,
        inputSchema: spec.inputSchema,
        providerId: spec.providerId,
        providerKind: spec.providerKind
      }))
      const bridgedTools = selectBridgeableTools(
        bridgeableTools,
        graphPolicy || plan.planMode || managedPptScope ? { overlap: new Set() } : undefined
      )

      // This is the portable rebase handoff. Compatible consecutive turns use
      // the official SDK resume id and do not send this transcript again.
      const historyTranscript = managedPptScope
        ? ''
        : buildHistoryTranscript(
            items,
            turnId,
            deps.historyTranscriptMaxBytes ?? DEFAULT_SDK_HISTORY_TRANSCRIPT_MAX_BYTES
          )

      // A plan turn suppresses goal/todo continuation and injects the plan-mode
      // instruction telling the model to call create_plan (now advertised above).
      const planMode = plan.planMode

      const instructionResolution = deps.instructionRuntime
        ? await deps.instructionRuntime.resolveTurn({ workspace: thread.workspace })
        : undefined

      let memoryBlocks: string[] = []
      if (deps.memoryStore && userText.trim()) {
        const memories = await deps.memoryStore.retrieve({
          query: userText,
          workspace: thread.workspace,
          limit: 8
        })
        deps.memoryStore.setLastInjected(memories.map((memory) => memory.id))
        memoryBlocks = memoryInstructions(memories)
      }

      const todoInstruction = planMode ? null : todoContinuationInstruction(thread.todos)
      if (instructionResolution) {
        await deps.turns.updateTurnMetadata(threadId, turnId, {
          injectedInstructionSources: instructionResolution.sources,
          instructionInjectionBytes: instructionResolution.injectedBytes
        })
      }

      const contextInstructions = managedPptScope ? [
        ...turnDynamicContext.instructions
      ] : [
        buildClientSurfaceInstruction(clientSurface),
        ...(thread.additionalWorkspaces?.length
          ? [`Additional workspace roots explicitly added by the user:\n${thread.additionalWorkspaces.map((path) => `- ${JSON.stringify(path)}`).join('\n')}`]
          : []),
        ...(graphPolicy ? [graphPolicy.instruction] : []),
        ...(planMode ? [PLAN_MODE_INSTRUCTION] : []),
        ...(turn?.guiDesignArtifact?.kind === 'svg'
          ? [SVG_ARTIFACT_MODE_INSTRUCTION]
          : turn?.guiDesignMode
            ? [DESIGN_MODE_INSTRUCTION]
            : []),
        ...(instructionResolution?.instruction ? [instructionResolution.instruction] : []),
        ...(todoInstruction ? [todoInstruction] : []),
        ...memoryBlocks,
        ...turnDynamicContext.instructions,
        ...(skillResolution?.catalogInstruction ? [skillResolution.catalogInstruction] : []),
        ...(skillResolution?.instructions ?? []),
        ...(bridgedTools.length ? [CLAUDE_KUN_TOOL_INSTRUCTION] : [])
      ]

      let preparation: DelegatedSessionPreparation | undefined
      let claudeConfigDir: string | undefined
      if (deps.sessionCoordinator) {
        preparation = await deps.sessionCoordinator.prepare({
          threadId,
          route: {
            providerKind: 'agent-sdk',
            providerId: providerId || 'default',
            credentialIdentity: delegatedCredentialIdentity({
              providerId: providerId || 'default',
              accountId,
              credentialSourceId: providerCfg?.credentialSourceId,
              credentialSecret: token
            }),
            workspace: thread.workspace,
            model: model ?? 'claude-default',
            capabilityFingerprint: delegatedCapabilityFingerprint({
              systemPrompt: deps.prefix.systemPrompt,
              threadPersona: thread.systemPrompt?.trim() || '',
              approvalPolicy,
              sandboxMode,
              approvalReviewer,
              planMode,
              allowSdkBuiltins:
                graphPolicy || planMode || turn?.guiDesignArtifact?.kind === 'svg'
                  ? false
                  : deps.allowSdkBuiltins ?? true,
              capabilities: agentSdkCapabilities(),
              tools: bridgedTools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema,
                providerId: tool.providerId,
                providerKind: tool.providerKind
              }))
            }),
            continuationMode: 'native'
          },
          priorItems: priorItemsForDelegatedTurn(items, turnId)
        })
        if (token) {
          claudeConfigDir = deps.sessionCoordinator.store.providerStateDir('agent-sdk', threadId)
          await mkdir(claudeConfigDir, { recursive: true, mode: 0o700 })
        }
        sessionPreparationsByTurn.set(skillTurnKey(threadId, turnId), preparation)
        sessionGoalContextKeysByTurn.set(skillTurnKey(threadId, turnId), goalContextKeyForHistory)
      }

      return {
        workspace: thread.workspace,
        additionalWorkspaces: thread.additionalWorkspaces,
        userText: modelUserText,
        ...(managedPptScope && turnDynamicContext.instructions.length === 0
          ? { preserveExactUserPrompt: true }
          : {}),
        threadPersona: thread.systemPrompt?.trim() || undefined,
        approvalPolicy,
        sandboxMode,
        approvalReviewer,
        actingModelRoute,
        planMode,
        allowSdkBuiltins:
          graphPolicy || planMode || turn?.guiDesignArtifact?.kind === 'svg'
            ? false
            : deps.allowSdkBuiltins ?? true,
        ...(graphPolicy || managedPptScope ? { bridgeKunBuiltinOverlaps: true } : {}),
        ...(graphPolicy ? { graphPhase: graphPolicy.phase } : {}),
        ...(turn?.guiDesignArtifact?.kind === 'svg' ? { requireSvgCompletion: true } : {}),
        // Claude Code only accepts Anthropic models; coerce a thread's non-Claude
        // model (e.g. an old deepseek thread now routed to the subscription) to
        // the runtime default so the turn doesn't fail "model may not exist".
        model,
        ...(billingKind ? { billingKind } : {}),
        ...(turn?.reasoningEffort ? { reasoningEffort: turn.reasoningEffort } : {}),
        ...(preparation?.nativeSessionId && turnDynamicContext.instructions.length === 0
          ? { resumeSessionId: preparation.nativeSessionId }
          : {}),
        ...(claudeConfigDir ? { claudeConfigDir } : {}),
        ...(preparation ? { sessionPreparation: preparation } : {}),
        ...(turnDynamicContext.instructions.length
          ? { disableNativeContinuation: true }
          : {}),
        ...(deps.contextProfile
          ? { contextProfile: deps.contextProfile(model ?? 'claude-default') }
          : {}),
        oauthToken: token || undefined,
        ...(images.length ? { images } : {}),
        bridgeableTools,
        ...([...goalContextTexts(items), ...turnDynamicContext.privateValues].length
          ? {
              redactedRequestValues: [
                ...goalContextTexts(items),
                ...turnDynamicContext.privateValues
              ]
            }
          : {}),
        ...(historyTranscript ? { historyTranscript } : {}),
        ...(contextInstructions.length ? { contextInstructions } : {}),
        ...(activeSkillIds.length ? { activeSkillIds: [...activeSkillIds] } : {})
      }
    },
  }
}
