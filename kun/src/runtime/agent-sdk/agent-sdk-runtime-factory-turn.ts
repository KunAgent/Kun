/**
 * Binds the decoupled {@link AgentSdkRuntime} to kun's real runtime services.
 * This is the only place that touches the SDK package and kun's concrete stores,
 * keeping the orchestration (and its tests) free of both.
 */
import { historyReferenceInstructions } from '../../prompt/history-reference-context.js'
import {
  AgentSdkCredentialUnavailableError,
  AgentSdkGatewayUnavailableError,
  agentSdkCapabilities,
  type SdkRuntimeDeps,
  type SdkTurnContext
} from './agent-sdk-runtime.js'
import { normalizeClaudeOAuthToken, resolveSdkModel, type SdkGatewayEnv } from './sdk-options-builder.js'
import { parseGatewayModelId } from '../../harness/gateway-model-id.js'
import { resolveAgentSdkGatewayEnv } from './agent-sdk-gateway.js'
import { subscriptionBillingKind } from '../../shared/subscription-billing.js'
import type { TurnService } from '../../services/turn-service.js'
import { DEFAULT_APPROVAL_REVIEWER } from '../../contracts/policy.js'
import { resolveMemoryTurnContext } from '../../memory/memory-turn-context.js'
import { memoryInjectionMetadata } from '../../loop/model-step-preparation-memory.js'
import { recordRetrieved } from '../../memory/memory-retrieval-feedback.js'
import {
  PLAN_MODE_INSTRUCTION,
  todoContinuationInstruction
} from '../../loop/agent-loop.js'
import {
  filterGoalContextsForGoalKey,
  goalContextKey
} from '../../loop/continuation-instructions.js'
import {
  DESIGN_MODE_INSTRUCTION,
  SVG_ARTIFACT_MODE_INSTRUCTION
} from '../../loop/design-mode.js'
import type { ActingTurnModelRoute } from '../../contracts/turns.js'
import { goalContextTexts } from '../../contracts/items.js'
import {
  buildHistoryTranscript,
  DEFAULT_SDK_HISTORY_TRANSCRIPT_MAX_BYTES
} from './sdk-context-assembler.js'
import { resolveTurnHandoff, type TurnHandoff } from '../../handoff/turn-handoff.js'
import { userMessageTextWithComposerContexts } from '../../domain/composer-context.js'
import { mkdir } from 'node:fs/promises'
import { buildAdditionalWorkspacesInstruction, buildClientSurfaceInstruction } from '../../prompt/kun-prompt-context.js'
import { projectTurnDynamicContext } from '../../prompt/turn-persona-context.js'
import {
  delegatedCapabilityFingerprint,
  delegatedCredentialIdentity,
  delegatedRouteKey,
  priorItemsForDelegatedTurn,
  type DelegatedSessionPreparation
} from '../delegated-session-binding.js'

const CLAUDE_KUN_TOOL_INSTRUCTION = [
  'Kun-managed capabilities are available through the mcp__kun__ tools.',
  'Use these tools for Kun capabilities such as MCP, extensions, skills, memory, media, GUI input, and delegation.',
  'Their execution remains governed by Kun ToolHost approval and sandbox policy.'
].join(' ')

import type { AgentSdkRuntimeFactoryDeps } from './agent-sdk-runtime-factory-contracts.js'
import type { AgentSdkFactoryContext } from './agent-sdk-runtime-factory-context.js'

export function createAgentSdkTurnRuntimeDeps(
  deps: AgentSdkRuntimeFactoryDeps,
  context: AgentSdkFactoryContext
): Pick<SdkRuntimeDeps, 'handlesProvider' | 'loadTurnContext'> {
  const { sessionIdsByTurn, sessionPreparationsByTurn, sessionGoalContextKeysByTurn, handoffBriefDigestsByTurn, skillTurnKey, nowIso, toolBridge, resolveImages } = context
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
      // `kun-gateway` turns address the routed provider through the loopback
      // gateway as `kun/<provider>/<model>`; the grant only authorizes those
      // routes (docs/ade/04 §5.5). Provider credentials never enter the env.
      const gatewayMode = turn.credentialMode === 'kun-gateway'
      const rawModel = turn?.model || thread.model
      const gatewayAddress = gatewayMode ? parseGatewayModelId(rawModel) : null
      const gatewayProviderId = gatewayMode
        ? gatewayAddress?.providerId ?? explicitRouteProviderId ??
          await deps.resolveDefaultProviderId?.().catch(() => undefined)
        : undefined
      const gatewayModelId = gatewayAddress?.model ?? rawModel
      let gatewayEnv: SdkGatewayEnv | undefined
      if (gatewayMode) {
        if (!gatewayProviderId || !gatewayModelId) {
          throw new AgentSdkGatewayUnavailableError(
            'the turn has no provider/model route to address through the gateway'
          )
        }
        const harnessId = turn.harnessId ?? 'claude-code'
        gatewayEnv = resolveAgentSdkGatewayEnv({
          deps: {
            tokens: deps.harnessTokens,
            baseUrl: deps.harnessGatewayBaseUrl,
            roles: deps.roles,
            gateway: () => deps.harnessCatalog?.get(harnessId)?.gateway
          },
          threadId,
          harnessId,
          providerId: gatewayProviderId,
          model: gatewayModelId
        })
      }
      const selectedModel = gatewayMode
        ? gatewayModelId
        : resolveSdkModel(turn?.model || thread.model, deps.defaultModel)
      const actingModelRoute: ActingTurnModelRoute = turn.actingModelRoute ?? {
        model: selectedModel ?? 'claude-default',
        ...(gatewayProviderId
          ? { providerId: gatewayProviderId }
          : actingProviderId
            ? { providerId: actingProviderId }
            : {}),
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
      // Gateway turns skip this entirely — the gateway token is the credential.
      let token: string | undefined
      if (!gatewayEnv) {
        const credentialSourceId = explicitRouteProviderId
          ? providerCfg?.credentialSourceId
          : deps.defaultCredentialSourceId
        let rawToken = explicitRouteProviderId ? providerCfg?.apiKey : deps.defaultToken
        if (credentialSourceId) {
          const resolved = await deps.resolveCredentialSource?.(credentialSourceId).catch(() => null)
          rawToken = resolved?.apiKey ?? ''
          if (!rawToken.trim()) throw new AgentSdkCredentialUnavailableError()
        }
        token = normalizeClaudeOAuthToken(rawToken)
      }
      // Resolve the shared turn scope (skills, plan, graph, surface) before
      // listing bridgeable tools so the SDK sees the same per-turn catalog as
      // the native Kun loop.
      const scope = await toolBridge.resolveTurnScope(threadId, turnId, {
        skillPrompt: userText,
        actingModelRoute
      })
      if (!scope) return null
      const { plan, graphPolicy, skillResolution, clientSurface, activeSkillIds } = scope
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
      // The bridged catalog comes from the shared tool bridge host: same
      // capability snapshot, plan context, client surface, and overlap policy
      // as the native loop (docs/ade/05 §3.2).
      const bridgedTools = await toolBridge.listTools(threadId, turnId, { scope })

      // A plan turn suppresses goal/todo continuation and injects the plan-mode
      // instruction telling the model to call create_plan (now advertised above).
      const planMode = plan.planMode

      const instructionResolution = deps.instructionRuntime
        ? await deps.instructionRuntime.resolveTurn({ workspace: thread.workspace })
        : undefined

      // Directives are injected on every turn — including empty-prompt
      // continuations — while reference memories stay relevance-gated. Rooms
      // keep the memory-free boundary.
      const memoryContext = await resolveMemoryTurnContext(
        thread.roomContext ? undefined : deps.memoryStore,
        { query: userText, workspace: thread.workspace }
      )
      const directiveBlocks = memoryContext.directiveBlocks
      const memoryBlocks = memoryContext.referenceBlocks
      const memoryIds = memoryContext.memories.map((memory) => memory.id)

      const todoInstruction = planMode ? null : todoContinuationInstruction(thread.todos)
      if (instructionResolution || memoryContext.memories.length > 0 || memoryContext.directives.length > 0) {
        await deps.turns.updateTurnMetadata(threadId, turnId, {
          ...memoryInjectionMetadata({
            memories: memoryContext.memories,
            directives: memoryContext.directives
          }),
          ...(instructionResolution ? {
            injectedInstructionSources: instructionResolution.sources,
            instructionInjectionBytes: instructionResolution.injectedBytes
          } : {})
        })
      }

      const additionalWorkspacesInstruction = buildAdditionalWorkspacesInstruction(thread.additionalWorkspaces)
      // P1-25: planning-phase harness menu as dynamic context (not the
      // stable delegated-session prefix).
      const graphHarnessInstruction =
        graphPolicy?.phase === 'planning'
          ? await deps.graphHarnessSummary?.().catch(() => undefined)
          : undefined
      const contextInstructions = managedPptScope ? [
        ...turnDynamicContext.instructions
      ] : [
        ...historyReferenceInstructions(thread),
        buildClientSurfaceInstruction(clientSurface),
        ...(additionalWorkspacesInstruction ? [additionalWorkspacesInstruction] : []),
        ...(graphPolicy ? [graphPolicy.instruction] : []),
        ...(graphHarnessInstruction ? [graphHarnessInstruction] : []),
        ...(planMode ? [PLAN_MODE_INSTRUCTION] : []),
        ...(turn?.guiDesignArtifact?.kind === 'svg'
          ? [SVG_ARTIFACT_MODE_INSTRUCTION]
          : turn?.guiDesignMode
            ? [DESIGN_MODE_INSTRUCTION]
            : []),
        ...(instructionResolution?.instruction ? [instructionResolution.instruction] : []),
        ...(todoInstruction ? [todoInstruction] : []),
        ...directiveBlocks,
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
              // Gateway turns bind sessions to the route, not a provider
              // credential — the grant token never enters the identity.
              credentialSourceId: gatewayEnv ? 'kun-gateway' : providerCfg?.credentialSourceId,
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
                graphPolicy || thread.roomContext || planMode || turn?.guiDesignArtifact?.kind === 'svg'
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
        if (token || gatewayEnv) {
          claudeConfigDir = deps.sessionCoordinator.store.providerStateDir(
            'agent-sdk',
            threadId,
            delegatedRouteKey(preparation.route)
          )
          await mkdir(claudeConfigDir, { recursive: true, mode: 0o700 })
        }
        sessionPreparationsByTurn.set(skillTurnKey(threadId, turnId), preparation)
        sessionGoalContextKeysByTurn.set(skillTurnKey(threadId, turnId), goalContextKeyForHistory)
      }

      // The deterministic handoff brief (docs/ade/08 §4) replaces the portable
      // transcript whenever the session is new/rebased or a parked session is
      // restored with a delta. Compatible native resumes send neither. The
      // closure is re-invoked after a rejected native resume to produce the
      // fresh-session full brief for the portable retry.
      const resolveHandoff = (
        prep: DelegatedSessionPreparation | undefined
      ): TurnHandoff | undefined => {
        const resolved = resolveTurnHandoff({
          enabled: Boolean(deps.sessionCoordinator) &&
            !managedPptScope &&
            deps.deterministicHandoff !== false,
          preparation: prep,
          items,
          currentTurnId: turnId,
          ownerThreadId: threadId,
          workspacePath: thread.workspace,
          taskWorkspaces: deps.taskWorkspaces
        })
        if (resolved) {
          handoffBriefDigestsByTurn.set(
            skillTurnKey(threadId, turnId),
            resolved.brief.digest
          )
        }
        return resolved
      }
      const turnHandoff = resolveHandoff(preparation)

      // This is the portable rebase handoff. Compatible consecutive turns use
      // the official SDK resume id and do not send this transcript again.
      const historyTranscript =
        managedPptScope || turnHandoff
          ? ''
          : buildHistoryTranscript(
              items,
              turnId,
              deps.historyTranscriptMaxBytes ?? DEFAULT_SDK_HISTORY_TRANSCRIPT_MAX_BYTES
            )

      void recordRetrieved({
        feedback: deps.memoryFeedback,
        selectedIds: memoryIds,
        threadId,
        turnId,
        occurredAt: turn.createdAt
      })
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
          graphPolicy || thread.roomContext || planMode || turn?.guiDesignArtifact?.kind === 'svg'
            ? false
            : deps.allowSdkBuiltins ?? true,
        ...(graphPolicy || thread.roomContext || managedPptScope ? { bridgeKunBuiltinOverlaps: true } : {}),
        ...(graphPolicy ? { graphPhase: graphPolicy.phase } : {}),
        ...(turn?.guiDesignArtifact?.kind === 'svg' ? { requireSvgCompletion: true } : {}),
        // Claude Code only accepts Anthropic models; coerce a thread's non-Claude
        // model (e.g. an old deepseek thread now routed to the subscription) to
        // the runtime default so the turn doesn't fail "model may not exist".
        // Gateway turns send the `kun/<provider>/<model>` address instead.
        model: gatewayEnv?.model ?? model,
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
        ...(gatewayEnv ? { gateway: gatewayEnv } : {}),
        ...(images.length ? { images } : {}),
        bridgeableTools: bridgedTools,
        ...([...goalContextTexts(items), ...turnDynamicContext.privateValues, ...(gatewayEnv ? [gatewayEnv.token] : [])].length
          ? {
              redactedRequestValues: [
                ...goalContextTexts(items),
                ...turnDynamicContext.privateValues,
                ...(gatewayEnv ? [gatewayEnv.token] : [])
              ]
            }
          : {}),
        resolveHandoff,
        ...(turnHandoff
          ? { handoffBrief: turnHandoff.brief.text, handoffEvent: turnHandoff.event }
          : historyTranscript
            ? { historyTranscript }
            : {}),
        ...(contextInstructions.length ? { contextInstructions } : {}),
        ...(activeSkillIds.length ? { activeSkillIds: [...activeSkillIds] } : {})
      }
    },
  }
}
