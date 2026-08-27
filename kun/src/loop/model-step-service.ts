import { dirname } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import type { CacheRequestSignature } from '../cache/cache-diagnostics.js'
import type { ImmutablePrefix } from '../cache/immutable-prefix.js'
import type { PipelineStage } from '../contracts/events.js'
import type { ModelCapabilityMetadata } from '../contracts/capabilities.js'
import type { TurnItem } from '../contracts/items.js'
import type { ActingTurnModelRoute } from '../contracts/turns.js'
import { makeErrorItem } from '../domain/item.js'
import { repairModelHistoryItemsForModel } from '../domain/model-history-repair.js'
import { memoryPreview } from '../shared/memory-preview.js'
import type { IdGenerator } from '../ports/id-generator.js'
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
import { GRAPH_DEFINE_PLAN_TOOL_NAME } from '../adapters/tool/graph-define-plan-tool.js'
import { GRAPH_LEAD_MODE_INSTRUCTION } from '../prompt/graph-lead-mode.js'
import { buildToolPreferenceInstruction } from '../prompt/kun-system-prompt.js'
import {
  buildClientSurfaceInstruction,
  buildKunTurnContextInstructions,
  buildThreadProfileInstruction,
  type KunTurnContextAuthority,
  type KunTurnContextBlock
} from '../prompt/kun-prompt-context.js'
import { effectiveHistoryAfterLatestCompaction } from './compaction-history.js'
import { resolveCoherentProviderAccount } from './compaction-summary.js'
import {
  EMPTY_POST_TOOL_FINAL_ANSWER_RECOVERY_STEP,
  emptyPostToolRecoveryInstruction,
  filterGoalContextsForActiveGoal,
  hasSuccessfulCreatePlanResult,
  POST_TOOL_FAILURE_FINAL_ANSWER_RECOVERY_STEP,
  postToolFailureRecoveryInstruction,
  TOOL_SUPPRESSION_FINAL_ANSWER_RECOVERY_STEP,
  toolSuppressionRecoveryInstruction,
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
import { recoverModelContextOverflow } from './model-context-overflow-recovery.js'
import { composeModelRequest, effectiveOutputBudgetTokens } from './model-request-composer.js'
import { estimateModelRequestInputTokenBreakdown } from './model-request-estimator.js'
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
import {
  GRAPH_CREATE_RUN_TOOL_NAME,
  type RoundOutcomeCoordinator
} from './round-outcome-coordinator.js'
import { svgArtifactCompletionState } from './svg-artifact-completion.js'
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
import { buildPromptCachePartition } from '../cache/prompt-cache-partition.js'
import { rewriteItemHistoryWithRetry } from '../services/history-commit-coordinator.js'
import { TurnToolCatalogFreezer } from './turn-tool-catalog.js'
import { ModelStepPreparationService } from './model-step-preparation-service.js'
import type { ModelStepServiceDeps } from './model-step-service-types.js'
import { isPoolAliasActingRoute, sameActingModelRoute } from './model-step-preparation-helpers.js'
import { composeForwardedModelRequest } from './forwarded-model-request.js'
export type { ModelStepServiceDeps } from './model-step-service-types.js'
export { buildExtensionProfileInstruction } from './model-step-preparation-helpers.js'


export class ModelStepService extends ModelStepPreparationService {
  private readonly workspaceCheckpointGates = new Map<string, Promise<void>>()

  constructor(deps: ModelStepServiceDeps) {
    super(deps)
  }

  async run(
    threadId: string,
    turnId: string,
    signal: AbortSignal,
    stepIndex = 0,
    maxToolCallsPerStep = normalizeTurnLimits(this.deps.turnLimits).maxToolCallsPerStep,
    contextOverflowRetryAttempt = 0
  ): Promise<ModelRoundOutcome> {
    const preparation = await this.prepareModelStep(
      threadId,
      turnId,
      signal,
      stepIndex
    )
    if (typeof preparation === 'string') return preparation
    const {
      thread,
      turn,
      dedicatedSvgTurn,
      planTurnSuppressesGoalContext,
      items,
      routeAccountId,
      modelRoute,
      actingModelRoute,
      historyRoutesByTurnId,
      routeSelectionDeferred,
      providerId,
      accountId,
      model,
      modelCapabilities,
      serviceTier,
      prepared,
      attachments,
      toolContext,
      skillResolution,
      toolProviderMetadata,
      streamToolMetadata,
      toolProviderKinds,
      toolKinds,
      hardRequiredToolName,
      softRequiredToolName,
      forceToolSuppressionFinalAnswerRecovery,
      fastContextFinalSynthesis,
      requestToolSpecs,
      promptCachePhase,
      svgCompletion,
      contextInstructions,
      redactedRequestValues,
      skillContextInstructions,
      modeInstruction
    } = preparation
    const clientDiagnostics = modelClientDiagnostics(this.deps.model, providerId)
    const threadProfileInstruction = buildThreadProfileInstruction(thread.systemPrompt)
    const promptCachePartition = buildPromptCachePartition({
      model,
      providerId,
      endpointFormat: modelCapabilities.endpointFormat ?? clientDiagnostics.endpointFormat,
      responsesMode: modelCapabilities.responsesMode,
      phase: promptCachePhase,
      immutablePrefixFingerprint: this.deps.prefix.fingerprint,
      ...(threadProfileInstruction ? { threadProfileInstruction } : {}),
      tools: requestToolSpecs
    })
    // Automatic compaction must see every non-history part of the request that
    // will actually be sent. Building the same request with empty history gives
    // us an authoritative overhead estimate for system/thread prompts, dynamic
    // context, skills, tools, and attachments without mixing in cumulative
    // provider usage.
    const requestOverheadTokens = composeModelRequest({
      threadId,
      turnId,
      model,
      ...(providerId ? { providerId } : {}),
      ...(accountId ? { accountId } : {}),
      ...(modelRoute.reasoningEffort ? { reasoningEffort: modelRoute.reasoningEffort } : {}),
      ...(serviceTier ? { serviceTier } : {}),
      promptCachePartition: promptCachePartition.hash,
      immutablePrefix: this.deps.prefix,
      ...(thread.systemPrompt !== undefined ? { threadSystemPrompt: thread.systemPrompt } : {}),
      ...(modeInstruction ? { modeInstruction } : {}),
      contextInstructions,
      redactedRequestValues,
      history: [],
      historyRoutesByTurnId,
      attachments,
      tools: requestToolSpecs,
      ...(hardRequiredToolName ? { requiredToolName: hardRequiredToolName } : {}),
      ...(this.deps.tokenEconomy ? { tokenEconomy: this.deps.tokenEconomy } : {}),
      signal
    }).sentInputTokens
    // Share one capacity model between the compaction preflight and the
    // send-time guard. `maxOutputTokens` is a capability ceiling, so first
    // derive the bounded ordinary reservation independently from the current
    // input. Final request construction may only lower this preferred value
    // when the rebuilt request leaves less room under the hard cap.
    const declaredOutputBudgetTokens = modelCapabilities.maxOutputTokens
    const requestHardCapTokens = modelCapabilities.contextWindowTokens
      ? Math.floor(modelCapabilities.contextWindowTokens * 0.85)
      : this.deps.compactor.hardCap(model, providerId)
    const preferredOutputBudgetTokens =
      modelCapabilities.endpointFormat === 'messages' && declaredOutputBudgetTokens === undefined
        ? 0
        : effectiveOutputBudgetTokens({
            inputTokens: 0,
            contextCapTokens: requestHardCapTokens,
            ...(declaredOutputBudgetTokens !== undefined
              ? { declaredMaxOutputTokens: declaredOutputBudgetTokens }
              : {})
          })
    const effectiveBudget = (inputTokens: number): number =>
      preferredOutputBudgetTokens === 0
        ? 0
        : effectiveOutputBudgetTokens({
            inputTokens,
            contextCapTokens: requestHardCapTokens,
            declaredMaxOutputTokens: preferredOutputBudgetTokens,
            fallbackTokens: preferredOutputBudgetTokens
          })
    let outputBudgetTokens = preferredOutputBudgetTokens
    // History compaction retries from the latest canonical snapshot to avoid
    // losing concurrent writes. That snapshot deliberately retains internal
    // goal records, including records for goals that later ended or changed.
    // Always restore the model-facing projection after a compaction result so
    // a CAS retry cannot resurrect an obsolete system instruction.
    const projectCompactedGoalHistory = async (candidate: TurnItem[]): Promise<TurnItem[]> =>
      filterGoalContextsForActiveGoal(
        candidate,
        planTurnSuppressesGoalContext
          ? undefined
          : (await this.deps.threadStore.get(threadId))?.goal
      )
    const firstCompaction = await this.deps.historyCompaction.compactIfNeeded({
      items,
      model,
      ...(providerId ? { providerId } : {}),
      ...(accountId ? { accountId } : {}),
      ...(serviceTier ? { serviceTier } : {}),
      signal,
      threadId,
      turnId,
      clientSurface: prepared.clientSurface,
      toolSpecs: requestToolSpecs,
      requestOverheadTokens,
      outputBudgetTokens,
      requestHardCapTokens,
      reserveModelRequest: () => this.deps.budgetGate.reserveAdditionalModelRequest(threadId, turnId)
    })
    if (signal.aborted) return 'aborted'
    const postCompactionBudgetGate = await this.deps.budgetGate.recheckReservedMainModelRequest(
      threadId,
      turnId
    )
    if (postCompactionBudgetGate === 'blocked') {
      this.deps.goalTurns.suppressResume(turnId)
      if (this.deps.roundOutcome.toolSuppressionRecoverySteps(turnId) > 0) {
        return this.deps.roundOutcome.failToolSuppressionRecovery(threadId, turnId)
      }
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
    let history = await projectCompactedGoalHistory(firstCompaction.history)
    let fallbackCompactionAttempted = false
    let fallbackCompactionApplied = false
    let replacedTokens = firstCompaction.replacedTokens
    let composedRequest = await composeForwardedModelRequest({
      history,
      threadId,
      thread,
      turnId,
      model,
      modelCapabilities,
      providerId,
      accountId,
      reasoningEffort: modelRoute.reasoningEffort,
      serviceTier,
      modeInstruction,
      contextInstructions,
      redactedRequestValues,
      historyRoutesByTurnId,
      requestToolSpecs,
      attachments,
      hardRequiredToolName,
      promptCachePartition: promptCachePartition.hash,
      immutablePrefix: this.deps.prefix,
      tokenEconomy: this.deps.tokenEconomy,
      turnAttachments: this.deps.turnAttachments,
      signal
    })
    if (signal.aborted) return 'aborted'
    let inputTokens = composedRequest.sentInputTokens
    outputBudgetTokens = effectiveBudget(inputTokens)
    composedRequest = {
      ...composedRequest,
      request: outputBudgetTokens > 0
        ? { ...composedRequest.request, maxTokens: outputBudgetTokens }
        : composedRequest.request
    }
    // Send-boundary fallback: the final request is rebuilt with transient
    // image/browser-use rehydration, token economy, and history hygiene, so it
    // can legitimately be larger than the compaction preflight estimated. When
    // the exact `input + output` still breaks the cap, compact once more with
    // the exact input as the floor and the deterministic heuristic summary
    // (never a second model call), rebuild, and only then fail if it still
    // does not fit. No loops, no recursion, no upstream dispatch before this
    // guard passes.
    if (inputTokens + outputBudgetTokens > requestHardCapTokens) {
      fallbackCompactionAttempted = true
      const fallbackCompaction = await this.deps.historyCompaction.compactIfNeeded({
        items: history,
        model,
        ...(providerId ? { providerId } : {}),
        ...(accountId ? { accountId } : {}),
        ...(serviceTier ? { serviceTier } : {}),
        signal,
        threadId,
        turnId,
        clientSurface: prepared.clientSurface,
        toolSpecs: requestToolSpecs,
        requestOverheadTokens,
        requestInputTokens: inputTokens,
        outputBudgetTokens,
        requestHardCapTokens,
        allowModelSummary: false,
        reserveModelRequest: () => this.deps.budgetGate.reserveAdditionalModelRequest(threadId, turnId)
      })
      if (signal.aborted) return 'aborted'
      history = await projectCompactedGoalHistory(fallbackCompaction.history)
      fallbackCompactionApplied = fallbackCompaction.compacted
      replacedTokens += fallbackCompaction.replacedTokens
      composedRequest = await composeForwardedModelRequest({
        history,
        threadId,
        thread,
        turnId,
        model,
        modelCapabilities,
        providerId,
        accountId,
        reasoningEffort: modelRoute.reasoningEffort,
        serviceTier,
        modeInstruction,
        contextInstructions,
        redactedRequestValues,
        historyRoutesByTurnId,
        requestToolSpecs,
        attachments,
        hardRequiredToolName,
        promptCachePartition: promptCachePartition.hash,
        immutablePrefix: this.deps.prefix,
        tokenEconomy: this.deps.tokenEconomy,
        turnAttachments: this.deps.turnAttachments,
        signal
      })
      if (signal.aborted) return 'aborted'
      inputTokens = composedRequest.sentInputTokens
      outputBudgetTokens = effectiveBudget(inputTokens)
      composedRequest = {
        ...composedRequest,
        request: outputBudgetTokens > 0
          ? { ...composedRequest.request, maxTokens: outputBudgetTokens }
          : composedRequest.request
      }
    }
    if (inputTokens + outputBudgetTokens > requestHardCapTokens) {
      const overBy = inputTokens + outputBudgetTokens - requestHardCapTokens
      const reason = outputBudgetTokens > requestHardCapTokens
        ? 'output_budget_exceeds_cap'
        : !fallbackCompactionAttempted
          ? 'request_too_large'
          : fallbackCompactionApplied
            ? 'still_exceeds_after_compaction'
            : 'no_compactable_history'
      const action = reason === 'output_budget_exceeds_cap'
        ? 'Reduce the model\'s max output tokens in provider settings, or switch to a model with a larger context window.'
        : 'Compact the conversation manually with /compact, reduce the current message or attachments, or lower the model output budget.'
      const message =
        `request exceeds the ${requestHardCapTokens}-token context cap ` +
        `(${inputTokens} input + ${outputBudgetTokens} output budget; over by ${overBy}); ` +
        `${reason}. ${action}`
      const details = {
        inputTokens,
        outputBudgetTokens,
        requestHardCapTokens,
        softThresholdTokens: this.deps.compactor.thresholds(model, providerId).softThreshold,
        hardThresholdTokens: this.deps.compactor.thresholds(model, providerId).hardThreshold,
        fallbackCompactionAttempted,
        fallbackCompactionApplied,
        replacedTokens,
        reason
      }
      this.deps.rememberFailure(turnId, {
        error: message,
        code: 'context_window_exceeded',
        severity: 'warning',
        details
      })
      await this.deps.events.record({
        kind: 'error',
        threadId,
        turnId,
        message,
        code: 'context_window_exceeded',
        severity: 'warning',
        details
      })
      return 'failed'
    }
    await this.deps.recordPipelineStage(threadId, turnId, 'input_compressed', {
      historyItems: composedRequest.request.history.length,
      requestOverheadTokens,
      outputBudgetTokens,
      requestHardCapTokens,
      fallbackCompactionAttempted,
      fallbackCompactionApplied
    })
    const { request, rawInputTokens, sentInputTokens, tokenEconomy } = composedRequest
    const requestContext = estimateModelRequestInputTokenBreakdown(request, {
      skillContextInstructions
    })
    // Tool results become input to the *next* request. Reserve the configured
    // output budget now so built-in source tools can return the largest honest
    // page that has a realistic chance of fitting instead of relying on the
    // send-time history cleaner to silently rewrite it.
    const sourceResultBudgetTokens = Math.max(0, requestHardCapTokens - inputTokens - outputBudgetTokens)
    const contextThresholds = this.deps.compactor.thresholds(model, providerId)
    const contextWindowTokens = modelCapabilities.contextWindowTokens ??
      Math.max(contextThresholds.softThreshold, contextThresholds.hardThreshold)
    await this.deps.events.record({
      kind: 'context_snapshot',
      threadId,
      turnId,
      model: request.model,
      ...(request.providerId ? { providerId: request.providerId } : {}),
      stepIndex,
      contextWindowTokens,
      softThresholdTokens: contextThresholds.softThreshold,
      hardThresholdTokens: contextThresholds.hardThreshold,
      estimatedInputTokens: requestContext.total,
      breakdown: {
        tools: requestContext.tools,
        system: requestContext.system,
        skills: requestContext.skills,
        messages: requestContext.messages,
        other: requestContext.other
      },
      toolCount: request.tools.length,
      activeSkillIds: skillResolution.activeSkillIds,
      contextManagement: 'kun-managed',
      nativeHistory: 'none'
    })
    if (tokenEconomy.enabled) {
      await this.deps.recordTokenEconomySavings({
        threadId,
        turnId,
        model,
        rawInputTokens,
        sentInputTokens
      })
    }
    const replayedMessageAttachments = Object.values(request.messageAttachments ?? {})
    const replayedAttachmentCount = replayedMessageAttachments.reduce(
      (count, entry) => count + entry.images.length + entry.textFallbacks.length + entry.documents.length,
      0
    )
    const unavailableAttachmentCount = replayedMessageAttachments.reduce(
      (count, entry) => count + entry.unavailable.length,
      0
    )
    const cacheSignature: CacheRequestSignature = {
      model: request.model,
      providerId: request.providerId?.trim() || clientDiagnostics.provider || 'default',
      endpointFormat: promptCachePartition.protocolVariant,
      prefixFingerprint: promptCachePartition.stableInstructionFingerprint,
      toolCatalogFingerprint: promptCachePartition.toolCatalogFingerprint,
      partitionHash: promptCachePartition.hash,
      partitionPhase: promptCachePartition.phase,
      unavailableAttachmentCount,
      activeSkillIds: skillResolution.activeSkillIds
    }
    const modelContextCount = request.history.filter((item) => item.kind === 'model_context').length
    let effectiveActingModelRoute: ActingTurnModelRoute = actingModelRoute
    let streamRouteResolved = false
    const streamed = await this.deps.modelRoundEngine.run({
      threadId,
      turnId,
      signal,
      request,
      maxToolCallsPerStep,
      // A retrieval model can occasionally emit one extra parallel call.
      // Preserve the bounded accepted batch instead of failing the whole child.
      ...(toolContext.fastContext
        ? { toolCallOverflowBehavior: 'truncate' as const }
        : {}),
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
        promptCachePartition: promptCachePartition.hash,
        promptCachePhase: promptCachePartition.phase,
        modelContextCount,
        replayedAttachmentMessageCount: replayedMessageAttachments.length,
        replayedAttachmentCount,
        unavailableAttachmentCount,
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
      onRouteSelected: async (route) => {
        const resolved: ActingTurnModelRoute = {
          model: route.modelId,
          providerId: route.providerId,
          ...(routeAccountId ? { accountId: routeAccountId } : {})
        }
        if (!routeSelectionDeferred && !sameActingModelRoute(actingModelRoute, resolved)) {
          // A frozen local-gateway alias can still resolve mid-stream to one
          // of its pool targets (for example when a wrapper hid
          // selectsRouteTargetDuringStream). Accept the late resolution and
          // pin the concrete target instead of failing the whole turn.
          if (!isPoolAliasActingRoute(actingModelRoute, route)) {
            throw new Error(
              'model route changed after the acting route was frozen: ' +
              `${actingModelRoute.providerId ?? 'default'}/${actingModelRoute.model} -> ` +
              `${resolved.providerId ?? 'default'}/${resolved.model}`
            )
          }
        }
        if (routeSelectionDeferred || !sameActingModelRoute(actingModelRoute, resolved)) {
          effectiveActingModelRoute = resolved
          streamRouteResolved = true
          await this.deps.turns.updateTurnMetadata(threadId, turnId, {
            actingModelRoute: resolved
          })
        }
      },
      writeGeneratedImage: async ({ imageBase64 }) => {
        await this.ensureWorkspaceCheckpoint(
          threadId,
          turnId,
          turn.workspaceCheckpointRequestId,
          signal
        )
        const imgDir = '.kun/images'
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
    if (streamed.kind === 'context_overflow') {
      return recoverModelContextOverflow({
        deps: this.deps, streamed, history, model, providerId, accountId, serviceTier,
        signal, threadId, turnId, clientSurface: prepared.clientSurface,
        toolSpecs: requestToolSpecs, requestOverheadTokens, requestInputTokens: inputTokens,
        outputBudgetTokens, requestHardCapTokens, retryAttempt: contextOverflowRetryAttempt,
        retry: () => this.run(
          threadId, turnId, signal, stepIndex, maxToolCallsPerStep,
          contextOverflowRetryAttempt + 1
        )
      })
    }
    if (routeSelectionDeferred && streamed.kind === 'tool_calls' && !streamRouteResolved) {
      const message = 'route pool emitted tool calls without resolving a concrete model target'
      this.deps.rememberFailure(turnId, {
        error: message,
        code: 'model_route_unresolved',
        severity: 'error'
      })
      await this.deps.events.record({
        kind: 'error',
        threadId,
        turnId,
        message,
        code: 'model_route_unresolved',
        severity: 'error'
      })
      return 'failed'
    }
    const effectivePrepared: PreparedTurnContext =
      effectiveActingModelRoute === actingModelRoute
        ? prepared
        : { ...prepared, actingModelRoute: effectiveActingModelRoute }
    return this.deps.roundOutcome.resolve({
      threadId,
      turnId,
      streamed,
      ...(request.requiredToolName ? { requiredToolName: request.requiredToolName } : {}),
      ...(softRequiredToolName && !forceToolSuppressionFinalAnswerRecovery
        ? { softRequiredToolName }
        : {}),
      ...(forceToolSuppressionFinalAnswerRecovery || fastContextFinalSynthesis
        ? { toolCallsDisabled: true }
        : {}),
      turn,
      prepared: effectivePrepared,
      ...(effectiveActingModelRoute.providerId
        ? { modelProviderId: effectiveActingModelRoute.providerId }
        : {}),
      modelReasoningEffort: modelRoute.reasoningEffort ?? turn.reasoningEffort ?? 'auto',
      sourceResultBudgetTokens,
      toolProviderMetadata,
      toolKinds,
      toolProviderKinds,
      svgCompletion
    })
  }

  private async ensureWorkspaceCheckpoint(
    threadId: string,
    turnId: string,
    checkpointRequestId: string | undefined,
    signal: AbortSignal
  ): Promise<void> {
    if (!checkpointRequestId || !this.deps.awaitWorkspaceCheckpoint) return
    const key = `${turnId}:${checkpointRequestId}`
    let gate = this.workspaceCheckpointGates.get(key)
    if (!gate) {
      gate = (async () => {
        const checkpointId = await this.deps.awaitWorkspaceCheckpoint!(checkpointRequestId, signal)
        if (!checkpointId) return
        await this.deps.turns.updateTurnMetadata(threadId, turnId, {
          workspaceCheckpointId: checkpointId
        })
        await this.deps.turns.updateItem(threadId, `item_${turnId}_user`, {
          workspaceCheckpointId: checkpointId
        })
      })()
      this.workspaceCheckpointGates.set(key, gate)
    }
    await gate
  }
}
