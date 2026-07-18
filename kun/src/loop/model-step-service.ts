import { dirname } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import type { CacheRequestSignature } from '../cache/cache-diagnostics.js'
import type { ImmutablePrefix } from '../cache/immutable-prefix.js'
import type { PipelineStage } from '../contracts/events.js'
import type { ModelCapabilityMetadata } from '../contracts/capabilities.js'
import type { TurnItem } from '../contracts/items.js'
import { makeErrorItem } from '../domain/item.js'
import { repairModelHistoryItems } from '../domain/model-history-repair.js'
import { memoryPreview } from '../shared/memory-preview.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { ModelClient, ModelToolSpec } from '../ports/model-client.js'
import type { SessionStore } from '../ports/session-store.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { GuiPlanContext } from '../ports/tool-host.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import type { TurnService } from '../services/turn-service.js'
import type { ThreadItemProjectionService } from '../services/thread-item-projection.js'
import { CREATE_PLAN_TOOL_NAME } from '../adapters/tool/create-plan-tool.js'
import {
  DESIGN_SVG_ANIMATE_TOOL_NAME,
  DESIGN_SVG_EDIT_TOOL_NAME,
  DESIGN_SVG_VALIDATE_TOOL_NAME
} from '../adapters/tool/design-svg-tool.js'
import { resolveWorkspacePath, shellRuntimeInstruction } from '../adapters/tool/builtin-tool-utils.js'
import { VERIFY_CHANGES_TOOL_NAME } from '../adapters/tool/builtin-verify-tool.js'
import { buildToolPreferenceInstruction } from '../prompt/kun-system-prompt.js'
import { effectiveHistoryAfterLatestCompaction } from './compaction-history.js'
import { resolveCoherentProviderAccount } from './compaction-summary.js'
import {
  EMPTY_POST_TOOL_FINAL_ANSWER_RECOVERY_STEP,
  emptyPostToolRecoveryInstruction,
  hasSuccessfulCreatePlanResult,
  userInputUnavailableInstruction
} from './continuation-instructions.js'
import {
  DESIGN_MODE_INSTRUCTION,
  SVG_ARTIFACT_MODE_INSTRUCTION
} from './design-mode.js'
import type { GoalTurnCoordinator } from './goal-turn-coordinator.js'
import type { HistoryCompactionService } from './history-compaction-service.js'
import { healLoadedHistoryItems } from './history-healing.js'
import type { LoopTelemetry } from './loop-telemetry.js'
import { memoryInstructions } from './memory-instructions.js'
import { modelCapabilitiesForModel } from './model-context-profile.js'
import type { ModelRoundEngine } from './model-round-engine.js'
import { modelClientDiagnostics } from './model-client-diagnostics.js'
import { composeModelRequest } from './model-request-composer.js'
import type { ModelRoutingService } from './model-routing-service.js'
import {
  PLAN_MODE_INSTRUCTION,
  resolvePlanModeToolSpecs,
  turnHasUnverifiedSourceChanges,
  verificationSuggestionInstruction
} from './plan-mode.js'
import {
  buildRuntimeContextInstruction,
  shouldInjectInitialRuntimeContext
} from './runtime-context.js'
import type { RoundOutcomeCoordinator } from './round-outcome-coordinator.js'
import { svgArtifactCompletionState } from './svg-artifact-completion.js'
import {
  rehydrateGeneratedImagesForForward,
  MAX_FORWARDED_GENERATED_IMAGES
} from './tool-result-image.js'
import {
  attachmentRequestPipelineDetails,
  imageGenerationReferenceInstructions,
  type TurnAttachmentService
} from './turn-attachment-service.js'
import type { TurnBudgetGate } from './turn-budget-gate.js'
import type { TurnContextResolver } from './turn-context-resolver.js'
import { resolveTurnModeContext } from './turn-context-resolver.js'
import type {
  ModelRoundOutcome,
  PreparedTurnContext,
  TurnExecutionFailure
} from './turn-execution-types.js'
import type { TokenEconomyConfig } from './token-economy.js'
import { normalizeTurnLimits, type TurnLimitsConfig } from './turn-limits.js'
import {
  detectVolatilePrefixContent,
  type PrefixVolatilityFinding
} from '../cache/prefix-volatility.js'
import {
  shouldVerifyImmutablePrefix,
  verifyImmutablePrefix
} from '../cache/immutable-prefix.js'
import { buildToolCatalogFingerprint } from '../cache/tool-catalog-fingerprint.js'
import { rewriteItemHistoryWithRetry } from '../services/history-commit-coordinator.js'
import { TurnToolCatalogFreezer } from './turn-tool-catalog.js'

export type ModelStepServiceDeps = {
  threadStore: ThreadStore
  sessionStore: SessionStore
  turns: Pick<TurnService, 'getTurn' | 'applyItem' | 'updateTurnMetadata'>
  events: Pick<RuntimeEventRecorder, 'record'>
  model: ModelClient
  compactor: import('./context-compactor.js').ContextCompactor
  prefix: ImmutablePrefix
  ids: Pick<IdGenerator, 'next'>
  nowIso: () => string
  modelCapabilities?: (model: string) => ModelCapabilityMetadata
  activePlanContext?: GuiPlanContext
  tokenEconomy?: TokenEconomyConfig
  toolArgumentRepair?: { maxStringBytes?: number }
  turnLimits?: TurnLimitsConfig
  modelRouting: ModelRoutingService
  budgetGate: TurnBudgetGate
  goalTurns: Pick<GoalTurnCoordinator, 'suppressResume'>
  threadItems: Pick<ThreadItemProjectionService, 'syncFromSession'>
  turnContextResolver: TurnContextResolver
  telemetry: Pick<LoopTelemetry, 'recordToolCatalogFingerprint'>
  historyCompaction: HistoryCompactionService
  turnAttachments: TurnAttachmentService
  modelRoundEngine: ModelRoundEngine
  roundOutcome: RoundOutcomeCoordinator
  recordPipelineStage: (
    threadId: string,
    turnId: string,
    stage: PipelineStage,
    details?: Record<string, unknown>
  ) => Promise<void>
  recordToolCatalogDrift: (input: {
    threadId: string
    turnId: string
    fingerprint: string
    toolCount: number
    toolNames: string[]
    changeKind: 'additive' | 'breaking'
    message: string
  }) => Promise<void>
  recordTokenEconomySavings: (input: {
    threadId: string
    turnId: string
    model: string
    rawInputTokens: number
    sentInputTokens: number
  }) => Promise<void>
  rememberFailure: (turnId: string, failure: TurnExecutionFailure) => void
}

export class ModelStepService {
  private readonly turnToolCatalogs = new TurnToolCatalogFreezer()

  constructor(private readonly deps: ModelStepServiceDeps) {}

  async run(
    threadId: string,
    turnId: string,
    signal: AbortSignal,
    stepIndex = 0,
    maxToolCallsPerStep = normalizeTurnLimits(this.deps.turnLimits).maxToolCallsPerStep
  ): Promise<ModelRoundOutcome> {
    if (shouldVerifyImmutablePrefix()) {
      verifyImmutablePrefix(this.deps.prefix)
    }
    const [thread, turn] = await Promise.all([
      this.deps.threadStore.get(threadId),
      this.deps.turns.getTurn(threadId, turnId)
    ])
    // A delete/interrupt can win while a model step is waiting for its prior
    // I/O. Do not fall back to empty workspace/default settings: that would
    // let a stale continuation issue a new request or dispatch a tool after
    // its owning thread/turn no longer exists.
    if (signal.aborted || !thread || !turn) return 'aborted'
    const modeContext = resolveTurnModeContext({
      turn,
      workspace: thread.workspace,
      threadMode: thread.mode,
      ...(this.deps.activePlanContext ? { fallbackPlanContext: this.deps.activePlanContext } : {})
    })
    const { dedicatedSvgTurn, activePlanContext } = modeContext
    await this.deps.recordPipelineStage(threadId, turnId, 'input_received', { stepIndex })
    const budgetGate = await this.deps.budgetGate.check(thread, threadId, turnId)
    if (budgetGate === 'blocked') {
      // A cost-budget stop is a deliberate cap, not an interrupted goal turn:
      // suppress goal auto-resume so it isn't relaunched straight back into
      // the same exhausted budget.
      this.deps.goalTurns.suppressResume(turnId)
      if (dedicatedSvgTurn) {
        const persistedCompletion = svgArtifactCompletionState(
          await this.deps.sessionStore.loadItems(threadId),
          turnId
        )
        if (persistedCompletion.validationAfterMutation) return 'stop'
        this.deps.rememberFailure(turnId, {
          error: 'Dedicated SVG artifact turn could not satisfy its completion gate before the budget was exhausted.',
          code: 'svg_completion_budget_blocked',
          severity: 'error'
        })
        return 'failed'
      }
      return 'stop'
    }
    const loadedItems = await this.deps.sessionStore.loadItems(threadId)
    // Heal (and possibly rewrite) on-disk history once per turn: within a
    // turn the loop only appends well-formed items, and healing's deep
    // change detection costs two full-history stringifies per call.
    let historyItems: TurnItem[] = loadedItems
    if (stepIndex === 0) {
      const healing = await rewriteItemHistoryWithRetry({
        sessionStore: this.deps.sessionStore,
        threadId,
        maxAttempts: 2,
        build: (snapshot) => {
          const healed = healLoadedHistoryItems(snapshot.items)
          return { changed: healed.changed, items: healed.items, value: undefined }
        }
      })
      if (healing.status === 'applied') {
        await this.deps.threadItems.syncFromSession(threadId)
        historyItems = healing.items
      } else if (healing.status === 'unchanged') {
        historyItems = healing.items
      } else {
        // A later step will retry persistence. Use a locally healed view now
        // rather than letting one malformed legacy record poison this request.
        historyItems = healLoadedHistoryItems(
          await this.deps.sessionStore.loadItems(threadId)
        ).items
      }
    }
    await this.deps.recordPipelineStage(
      threadId,
      turnId,
      'input_cached',
      prefixVolatilityStageDetails(detectVolatilePrefixContent(this.deps.prefix))
    )
    if (stepIndex > 0) {
      const toolResultCount = historyItems.filter(
        (item) => item.turnId === turnId && item.kind === 'tool_result'
      ).length
      await this.deps.events.record({
        kind: 'tool_result_upload_wait',
        threadId,
        turnId,
        status: 'waiting',
        toolResultCount
      })
    }
    const items = repairModelHistoryItems(
      effectiveHistoryAfterLatestCompaction(historyItems)
    )
    const { providerId, accountId } = resolveCoherentProviderAccount({
      turnProviderId: turn.providerId,
      turnAccountId: turn.accountId,
      threadProviderId: thread.providerId,
      threadAccountId: thread.accountId
    })
    const modelRoute = await this.deps.modelRouting.resolve({
      threadId,
      turnId,
      latestRequest: turn?.prompt ?? '',
      items,
      signal,
      ...(providerId ? { providerId } : {}),
      ...(accountId ? { accountId } : {}),
      reasoningEffort: turn?.reasoningEffort,
      candidates: [turn?.model, thread?.model, this.deps.model.model]
    })
    await this.deps.recordPipelineStage(threadId, turnId, 'input_routed', {
      model: modelRoute.model,
      ...(modelRoute.reasoningEffort ? { reasoningEffort: modelRoute.reasoningEffort } : {})
    })
    const model = modelRoute.model
    const modelCapabilities = this.deps.modelCapabilities?.(model) ?? modelCapabilitiesForModel(model)
    const prepared = await this.deps.turnContextResolver.resolve({
      threadId,
      turnId,
      thread,
      turn,
      history: historyItems,
      model,
      modelCapabilities,
      signal,
      mode: modeContext,
      goalNoToolRecoverySteps: this.deps.roundOutcome.goalNoToolRecoverySteps(turnId)
    })
    const {
      mode: effectiveMode,
      approvalPolicy,
      sandboxMode,
      attachments,
      skillResolution,
      instructionResolution,
      memories,
      activeGoalInstruction,
      goalRecoveryInstruction,
      activeTodoInstruction,
      planTurnActive,
      allowedToolNames,
      userInputDisabled,
      toolDiscoveryContext: toolContext,
      tools: liveTools
    } = prepared
    const frozenToolCatalog = this.turnToolCatalogs.resolve(
      threadId,
      turnId,
      [...liveTools],
      toolCatalogPolicyScope(prepared)
    )
    const tools = frozenToolCatalog.tools
    if (dedicatedSvgTurn) {
      const toolNames = new Set(tools.map((tool) => tool.name))
      const hasMutationTool = toolNames.has(DESIGN_SVG_EDIT_TOOL_NAME) || toolNames.has(DESIGN_SVG_ANIMATE_TOOL_NAME)
      const hasValidationTool = toolNames.has(DESIGN_SVG_VALIDATE_TOOL_NAME)
      const completionAlreadySatisfied = svgArtifactCompletionState(historyItems, turnId).validationAfterMutation
      if (!completionAlreadySatisfied && (approvalPolicy === 'never' || !hasMutationTool || !hasValidationTool)) {
        const message = approvalPolicy === 'never'
          ? 'Dedicated SVG artifact turns require tool execution, but the current approval policy disables tools.'
          : 'Dedicated SVG artifact tools are unavailable under the current plan, skill, or sandbox policy.'
        this.deps.rememberFailure(turnId, { error: message, code: 'svg_tools_unavailable', severity: 'error' })
        await this.deps.events.record({
          kind: 'error', threadId, turnId, message, code: 'svg_tools_unavailable', severity: 'error'
        })
        await this.deps.turns.applyItem(threadId, makeErrorItem({
          id: this.deps.ids.next('item_error'), turnId, threadId, message,
          code: 'svg_tools_unavailable', severity: 'error'
        }))
        return 'failed'
      }
    }
    const toolSpecs: ModelToolSpec[] = [...tools]
    const toolProviderMetadata = new Map(
      tools.map((tool) => [tool.name, { providerId: tool.providerId, providerKind: tool.providerKind }])
    )
    const streamToolMetadata = new Map(
      tools.map((tool) => [tool.name, { providerId: tool.providerId, toolKind: tool.toolKind }])
    )
    const toolProviderKinds = new Map(
      tools.map((tool) => [tool.name, tool.providerKind])
    )
    const toolCatalog = buildToolCatalogFingerprint(toolSpecs)
    const previousTurnDrift = this.deps.telemetry.recordToolCatalogFingerprint({
      threadId,
      workspace: thread?.workspace ?? '',
      mode: effectiveMode ?? 'agent',
      model: modelCapabilities.id,
      activeSkillIds: skillResolution.activeSkillIds,
      allowedToolNames,
      userInputDisabled,
      guiDesignCanvas: turn?.guiDesignCanvas === true,
      guiDesignMode: turn?.guiDesignMode === true,
      guiDesignArtifact: turn?.guiDesignArtifact,
      fingerprint: toolCatalog.fingerprint,
      toolNames: toolCatalog.toolNames,
      toolHashes: toolCatalog.toolHashes
    })
    const toolCatalogDrift = frozenToolCatalog.pendingDrift.kind !== 'none'
      ? frozenToolCatalog.pendingDrift
      : previousTurnDrift
    const diagnosticCatalog = frozenToolCatalog.pendingCatalog ?? toolCatalog
    const toolCatalogDriftMessage = toolCatalogDrift.kind !== 'none'
      ? buildToolCatalogDriftMessage(
          diagnosticCatalog,
          toolCatalogDrift.kind,
          frozenToolCatalog.pendingCatalog ? 'deferred' : 'applied'
        )
      : undefined
    if (toolCatalogDrift.kind !== 'none' && toolCatalogDriftMessage) {
      await this.deps.recordToolCatalogDrift({
        threadId,
        turnId,
        fingerprint: diagnosticCatalog.fingerprint,
        toolCount: diagnosticCatalog.toolCount,
        toolNames: diagnosticCatalog.toolNames,
        changeKind: toolCatalogDrift.kind,
        message: toolCatalogDriftMessage
      })
    }
    if (turn) {
      await this.deps.turns.updateTurnMetadata(threadId, turnId, {
        activeSkillIds: skillResolution.activeSkillIds,
        skillInjectionBytes: skillResolution.injectedBytes,
        injectedMemoryIds: memories.map((memory) => memory.id),
        injectedMemorySummaries: memories.map((memory) => ({
          id: memory.id,
          content: memoryPreview(memory.content)
        })),
        injectedInstructionSources: instructionResolution.sources,
        instructionInjectionBytes: instructionResolution.injectedBytes,
        toolCatalogFingerprint: toolCatalog.fingerprint,
        toolCatalogToolCount: toolCatalog.toolCount,
        toolCatalogDrift: toolCatalogDrift.kind !== 'none'
      })
    }
    const toolKinds = new Map(toolSpecs.map((tool) => [tool.name, tool.toolKind]))
    const createPlanSatisfied = planTurnActive
      ? hasSuccessfulCreatePlanResult(historyItems, turnId)
      : false
    const svgCompletion = turn?.guiDesignArtifact?.kind === 'svg'
      ? svgArtifactCompletionState(historyItems, turnId)
      : null
    const requiredToolName =
      planTurnActive &&
      !createPlanSatisfied &&
      toolSpecs.some((tool) => tool.name === CREATE_PLAN_TOOL_NAME)
        ? CREATE_PLAN_TOOL_NAME
        : svgCompletion?.mutationSucceeded &&
            !svgCompletion.validationAfterMutation &&
            toolSpecs.some((tool) => tool.name === DESIGN_SVG_VALIDATE_TOOL_NAME)
          ? DESIGN_SVG_VALIDATE_TOOL_NAME
          : undefined
    const suggestVerification =
      !planTurnActive &&
      toolSpecs.some((tool) => tool.name === VERIFY_CHANGES_TOOL_NAME) &&
      turnHasUnverifiedSourceChanges(historyItems, turnId)
    const effectiveToolSpecs = resolvePlanModeToolSpecs(toolSpecs, {
      planTurnActive,
      createPlanSatisfied,
      stepIndex
    })
    const emptyPostToolRecoveryStep = this.deps.roundOutcome.emptyPostToolRecoverySteps(turnId)
    const forceFinalAnswerRecovery =
      emptyPostToolRecoveryStep >= EMPTY_POST_TOOL_FINAL_ANSWER_RECOVERY_STEP
    const requestToolSpecs = forceFinalAnswerRecovery ? [] : effectiveToolSpecs
    const history = await this.deps.historyCompaction.compactIfNeeded({
      items,
      model,
      ...(providerId ? { providerId } : {}),
      ...(accountId ? { accountId } : {}),
      signal,
      threadId,
      turnId,
      toolSpecs: requestToolSpecs,
      reserveModelRequest: () => this.deps.budgetGate.reserveAdditionalModelRequest(threadId, turnId)
    })
    if (signal.aborted) return 'aborted'
    const postCompactionBudgetGate = await this.deps.budgetGate.recheckReservedMainModelRequest(
      threadId,
      turnId
    )
    if (postCompactionBudgetGate === 'blocked') {
      this.deps.goalTurns.suppressResume(turnId)
      if (dedicatedSvgTurn) {
        const persistedCompletion = svgArtifactCompletionState(
          await this.deps.sessionStore.loadItems(threadId),
          turnId
        )
        if (persistedCompletion.validationAfterMutation) return 'stop'
        this.deps.rememberFailure(turnId, {
          error: 'Dedicated SVG artifact turn could not satisfy its completion gate before the budget was exhausted.',
          code: 'svg_completion_budget_blocked',
          severity: 'error'
        })
        return 'failed'
      }
      return 'stop'
    }
    await this.deps.recordPipelineStage(threadId, turnId, 'input_compressed', {
      historyItems: history.length
    })
    // Forward the just-generated image(s) back to a vision-capable model so it can
    // self-review and regenerate if the result is off. Bytes come from the
    // already-persisted attachment/file; the persisted tool output keeps NO base64
    // (only this transient request copy carries it).
    const forwardHistory = await rehydrateGeneratedImagesForForward(
      history,
      (output) => this.deps.turnAttachments.resolveGeneratedImageForForward(output, threadId, thread?.workspace),
      MAX_FORWARDED_GENERATED_IMAGES
    )
    const runtimeContextInstruction = shouldInjectInitialRuntimeContext({
      stepIndex,
      turnId,
      historyItems
    })
      ? buildRuntimeContextInstruction({
          workspace: thread?.workspace,
          nowIso: this.deps.nowIso()
        })
      : null
    const toolPreferenceInstruction = buildToolPreferenceInstruction(requestToolSpecs)
    const contextInstructions = [
      ...(runtimeContextInstruction ? [runtimeContextInstruction] : []),
      ...(thread.extensionProfile?.instructionOverlay?.trim()
        ? [buildExtensionProfileInstruction(
            thread.ownerExtensionId ?? 'unknown',
            thread.extensionProfile.id,
            thread.extensionProfile.instructionOverlay
          )]
        : []),
      ...(instructionResolution.instruction ? [instructionResolution.instruction] : []),
      ...(activeGoalInstruction ? [activeGoalInstruction] : []),
      ...(goalRecoveryInstruction && this.deps.roundOutcome.goalNoToolRecoverySteps(turnId) > 0
        ? [goalRecoveryInstruction]
        : []),
      ...(activeTodoInstruction ? [activeTodoInstruction] : []),
      ...(emptyPostToolRecoveryStep > 0
        ? [emptyPostToolRecoveryInstruction(emptyPostToolRecoveryStep)]
        : []),
      ...imageGenerationReferenceInstructions({
        imageAttachments: attachments.imageAttachments,
        textFallbacks: attachments.textFallbacks,
        workspace: thread?.workspace ?? '',
        tools: requestToolSpecs
      }),
      ...memoryInstructions(memories),
      ...(skillResolution.catalogInstruction ? [skillResolution.catalogInstruction] : []),
      ...skillResolution.instructions,
      ...(userInputDisabled ? [userInputUnavailableInstruction()] : []),
      ...(toolPreferenceInstruction ? [toolPreferenceInstruction] : []),
      ...(requestToolSpecs.some((tool) => tool.name === 'bash') ? [shellRuntimeInstruction()] : []),
      ...(!forceFinalAnswerRecovery && suggestVerification ? [verificationSuggestionInstruction()] : []),
      ...(toolCatalogDriftMessage ? [toolCatalogDriftMessage] : [])
    ]
    await this.deps.recordPipelineStage(threadId, turnId, 'input_remembered', {
      memoryCount: memories.length,
      contextInstructionCount: contextInstructions.length
    })
    const modeInstruction = [
      ...(planTurnActive ? [PLAN_MODE_INSTRUCTION] : []),
      ...(turn.guiDesignArtifact?.kind === 'svg'
        ? [SVG_ARTIFACT_MODE_INSTRUCTION]
        : turn.guiDesignMode
          ? [DESIGN_MODE_INSTRUCTION]
          : [])
    ].join('\n\n')
    const composedRequest = composeModelRequest({
      threadId,
      turnId,
      model,
      ...(providerId ? { providerId } : {}),
      ...(accountId ? { accountId } : {}),
      ...(modelRoute.reasoningEffort ? { reasoningEffort: modelRoute.reasoningEffort } : {}),
      immutablePrefix: this.deps.prefix,
      ...(thread.systemPrompt !== undefined ? { threadSystemPrompt: thread.systemPrompt } : {}),
      ...(modeInstruction ? { modeInstruction } : {}),
      contextInstructions,
      history: forwardHistory,
      attachments,
      tools: requestToolSpecs,
      ...(!forceFinalAnswerRecovery && requiredToolName ? { requiredToolName } : {}),
      ...(this.deps.tokenEconomy ? { tokenEconomy: this.deps.tokenEconomy } : {}),
      signal
    })
    const { request, rawInputTokens, sentInputTokens, tokenEconomy } = composedRequest
    const inputTokens = sentInputTokens
    const outputTokens = modelCapabilities.maxOutputTokens ?? 0
    // A configured model context window is authoritative. ContextCompactor's
    // test/embedding thresholds can intentionally be much smaller than a real
    // model window to exercise compaction, so use its cap only when capability
    // metadata is unavailable.
    const hardCap = modelCapabilities.contextWindowTokens
      ? Math.floor(modelCapabilities.contextWindowTokens * 0.85)
      : this.deps.compactor.hardCap(model)
    if (inputTokens + outputTokens > hardCap) {
      await this.deps.events.record({
        kind: 'error',
        threadId,
        turnId,
        message: `request exceeds the ${hardCap}-token context cap (${inputTokens} input + ${outputTokens} output budget)`,
        code: 'context_window_exceeded',
        severity: 'warning'
      })
      return 'failed'
    }
    if (tokenEconomy.enabled) {
      await this.deps.recordTokenEconomySavings({
        threadId,
        turnId,
        model,
        rawInputTokens,
        sentInputTokens
      })
    }
    const clientDiagnostics = modelClientDiagnostics(this.deps.model, request.providerId)
    const cacheSignature: CacheRequestSignature = {
      model: request.model,
      providerId: request.providerId?.trim() || clientDiagnostics.provider || 'default',
      endpointFormat: clientDiagnostics.endpointFormat || 'unknown',
      prefixFingerprint: this.deps.prefix.fingerprint,
      toolCatalogFingerprint: toolCatalog.fingerprint,
      activeSkillIds: skillResolution.activeSkillIds
    }
    const streamed = await this.deps.modelRoundEngine.run({
      threadId,
      turnId,
      signal,
      request,
      maxToolCallsPerStep,
      streamToolMetadata,
      ...(this.deps.toolArgumentRepair?.maxStringBytes !== undefined
        ? { maxToolArgumentStringBytes: this.deps.toolArgumentRepair.maxStringBytes }
        : {}),
      cacheSignature,
      preSendDetails: {
        model: request.model,
        ...clientDiagnostics,
        historyItems: request.history.length,
        toolCount: request.tools.length,
        ...(request.requiredToolName ? { requiredToolName: request.requiredToolName } : {}),
        ...attachmentRequestPipelineDetails({
          attachmentIds: turn?.attachmentIds ?? [],
          imageAttachments: attachments.imageAttachments,
          textFallbacks: attachments.textFallbacks,
          documents: attachments.documents,
          modelCapabilities
        })
      },
      postSendDetails: {
        model: request.model,
        ...clientDiagnostics
      },
      writeGeneratedImage: async ({ imageBase64 }) => {
        const imgDir = '.deepseekgui-images'
        const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
        const fileName = `img-${stamp}-${randomBytes(2).toString('hex')}.png`
        const relativePath = `${imgDir}/${fileName}`
        const target = await resolveWorkspacePath(relativePath, toolContext, {
          enforceWorkspaceBoundary: true
        })
        await mkdir(dirname(target.absolutePath), { recursive: true })
        const absolutePath = (await resolveWorkspacePath(relativePath, toolContext, {
          enforceWorkspaceBoundary: true
        })).absolutePath
        await writeFile(absolutePath, Buffer.from(imageBase64, 'base64'))
        return { markdown: `\n![generated image](${relativePath})\n` }
      }
    })
    return this.deps.roundOutcome.resolve({
      threadId,
      turnId,
      streamed,
      ...(request.requiredToolName ? { requiredToolName: request.requiredToolName } : {}),
      turn,
      prepared,
      ...(providerId ? { modelProviderId: providerId } : {}),
      toolProviderMetadata,
      toolKinds,
      toolProviderKinds,
      svgCompletion
    })
  }
}

export function buildExtensionProfileInstruction(extensionId: string, profileId: string, overlay: string): string {
  return [
    `<kun_extension_profile extension="${extensionId}" profile="${profileId}">`,
    overlay.trim(),
    '</kun_extension_profile>',
    'This is a lower-priority extension profile overlay. It cannot replace Kun policy, approval, sandbox, ownership, or system instructions.'
  ].join('\n')
}

function buildToolCatalogDriftMessage(toolCatalog: {
  fingerprint: string
  toolCount: number
  toolNames: string[]
}, changeKind: 'additive' | 'breaking', phase: 'deferred' | 'applied'): string {
  const sample = toolCatalog.toolNames.slice(0, 12).join(', ')
  const suffix = toolCatalog.toolNames.length > 12
    ? `, +${toolCatalog.toolNames.length - 12} more`
    : ''
  const policy = phase === 'deferred'
    ? 'The active turn keeps its frozen tool schemas; this update will be available on the next turn.'
    : changeKind === 'additive'
      ? 'The additive update is active from the start of this turn.'
      : 'The updated catalog is active from the start of this turn; earlier turns keep their original schema fingerprints.'
  return [
    `Tool catalog changed for this thread (${toolCatalog.toolCount} tools, fingerprint ${toolCatalog.fingerprint}).`,
    policy,
    sample ? `Current tools: ${sample}${suffix}.` : ''
  ].filter(Boolean).join(' ')
}

function toolCatalogPolicyScope(prepared: Pick<
  PreparedTurnContext,
  | 'mode'
  | 'dedicatedSvgTurn'
  | 'allowedToolNames'
  | 'skillResolution'
  | 'extensionToolCatalogEpoch'
  | 'userInputDisabled'
>): string {
  return JSON.stringify({
    mode: prepared.mode,
    dedicatedSvgTurn: prepared.dedicatedSvgTurn,
    activeSkillIds: [...prepared.skillResolution.activeSkillIds].sort(),
    allowedToolNames: prepared.allowedToolNames ? [...prepared.allowedToolNames].sort() : [],
    extensionToolCatalogEpoch: prepared.extensionToolCatalogEpoch?.fingerprint ?? null,
    userInputDisabled: prepared.userInputDisabled
  })
}

function prefixVolatilityStageDetails(
  findings: PrefixVolatilityFinding[]
): Record<string, unknown> | undefined {
  if (findings.length === 0) return undefined
  const kinds = [...new Set(findings.map((finding) => finding.kind))].sort()
  const fields = [...new Set(findings.map((finding) => finding.field))].sort()
  return {
    prefixVolatileTokenCount: findings.length,
    prefixVolatileTokenKinds: kinds,
    prefixVolatileFields: fields,
    noRegexDetector: true
  }
}
