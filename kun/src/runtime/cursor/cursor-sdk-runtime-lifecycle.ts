import { cursorTurnFailure } from './cursor-turn-failure.js'
import type { Run, SDKAgent, SDKUserMessage } from '@cursor/sdk'
import { goalContextTexts } from '../../contracts/items.js'
import { userMessageTextWithComposerContexts } from '../../domain/composer-context.js'
import { resolveTurnClientSurface } from '../../loop/turn-context-resolver.js'
import { normalizeTurnLimits } from '../../loop/turn-limits.js'
import type { TurnRunOutcome } from '../../loop/turn-execution-types.js'
import { buildClientSurfaceInstruction } from '../../prompt/kun-prompt-context.js'
import { projectTurnDynamicContext } from '../../prompt/turn-persona-context.js'
import { buildHistoryTranscript, composeSdkPromptText, DEFAULT_SDK_HISTORY_TRANSCRIPT_MAX_BYTES } from '../agent-sdk/sdk-context-assembler.js'
import { filterGoalContextsForGoalKey, goalContextKey } from '../../loop/continuation-instructions.js'
import { delegatedCapabilityFingerprint, delegatedCredentialIdentity, delegatedRouteKey, priorItemsForDelegatedTurn, type DelegatedSessionPreparation } from '../delegated-session-binding.js'
import { recordHandoffInjected, resolveTurnHandoff, type TurnHandoff } from '../../handoff/turn-handoff.js'
import { delegatedGraphCompletionCheck, delegatedGraphRecoveryInstruction, parkDelegatedGraphTurnAfterRecovery } from '../delegated-graph-turn-policy.js'
import { CursorSdkEventMapper } from './cursor-sdk-event-mapper.js'
import {
  CURSOR_AUTH_RECOVERY_PROMPT,
  CursorTurnInterruptedError,
  cursorAgentExecutionOptions,
  cursorSdkErrorCode,
  resolveCursorSdkImages,
  resolveCursorTurnCredentials,
  sanitizeCursorSdkError,
  type CursorKunTurnContext,
  type CursorSdkApi,
  type CursorSdkRuntimeDeps
} from './cursor-sdk-runtime-support.js'
import {
  captureCursorMessage,
  cursorRunError,
  cursorSdkCapabilities,
  estimateDelegatedTokens,
  finishCursorTrace,
  finishCursorTraceChunks,
  startCursorTrace,
  type CursorTrace
} from './cursor-sdk-runtime-trace.js'
import { consumeCursorMessage, emitCursorDraft } from './cursor-sdk-runtime-events.js'
import { capabilitiesV2FromLegacy } from '../../harness/effective-capabilities.js'
import { CURSOR_CAPABILITIES } from '../../harness/builtin-harnesses.js'

export async function runCursorSdkTurnOwned(
  deps: CursorSdkRuntimeDeps,
    threadId: string,
    turnId: string,
    signal: AbortSignal,
    providerId: string | undefined,
    abortRuntime: () => void
  ): Promise<TurnRunOutcome> {
    const thread = await deps.threadStore.get(threadId)
    const turn = thread?.turns.find((candidate) => candidate.id === turnId)
    if (!thread || !turn) {
      await deps.turns.finishTurn({
        threadId,
        turnId,
        status: 'failed',
        error: 'no input for Cursor subscription turn',
        code: 'cursor_sdk_missing_turn'
      })
      return 'failed'
    }
    const items = await deps.sessionStore.loadItems(threadId)
    const userItem = [...items]
      .reverse()
      .find((item) => item.turnId === turnId && item.kind === 'user_message')
    if (!userItem || userItem.kind !== 'user_message') {
      await deps.turns.finishTurn({
        threadId,
        turnId,
        status: 'failed',
        error: 'no input for Cursor subscription turn',
        code: 'cursor_sdk_missing_turn'
      })
      return 'failed'
    }

    const credentials = await resolveCursorTurnCredentials({
      deps, thread, turn, providerId, threadId, turnId
    })
    if (credentials === 'failed') return 'failed'
    const {
      actingModelRoute,
      resolvedProviderId,
      resolvedAccountId,
      credentialSourceId,
      apiKey
    } = credentials
    if (signal.aborted) {
      await deps.turns.finishTurn({ threadId, turnId, status: 'aborted' })
      return 'aborted'
    }
    if (!turn.actingModelRoute) {
      await deps.turns.updateTurnMetadata(threadId, turnId, { actingModelRoute })
    }

    const userText = userMessageTextWithComposerContexts(userItem)
    let kunContext: CursorKunTurnContext = {
      instructionBlocks: [],
      activeSkillIds: [],
      tools: [],
      customTools: {}
    }
    if (deps.loadKunTurnContext) {
      try {
        kunContext = await deps.loadKunTurnContext({
          threadId,
          turnId,
          userText,
          actingModelRoute,
          signal
        })
      } catch (error) {
        if (signal.aborted) {
          await deps.turns.finishTurn({ threadId, turnId, status: 'aborted' })
          return 'aborted'
        }
        abortRuntime()
        const message = sanitizeCursorSdkError(error, apiKey)
        await deps.events.record({
          kind: 'error',
          threadId,
          turnId,
          message,
          code: 'cursor_sdk_context_failed',
          severity: 'error'
        })
        await deps.turns.finishTurn({
          threadId,
          turnId,
          status: 'failed',
          error: message,
          code: 'cursor_sdk_context_failed',
          severity: 'error'
        })
        return 'failed'
      }
    }
    if (signal.aborted) {
      await deps.turns.finishTurn({ threadId, turnId, status: 'aborted' })
      return 'aborted'
    }
    // loadKunTurnContext materializes an active goal's internal history item.
    // Re-read canonical items after it returns so the provider prompt and
    // delegated-session digest use the same stable prefix.
    const planMode =
      turn.orchestration === 'graph' ||
      deps.enforceReadOnly === true ||
      (turn.mode ?? thread.mode) === 'plan'
    const canonicalHistory = deps.loadKunTurnContext
      ? await deps.sessionStore.loadItems(threadId)
      : items
    const latestGoal = planMode
      ? undefined
      : (await deps.threadStore.get(threadId))?.goal
    const goalContextKeyForHistory = goalContextKey(latestGoal)
    const filteredHistory = filterGoalContextsForGoalKey(canonicalHistory, goalContextKeyForHistory)
    const turnDynamicContext = projectTurnDynamicContext({
      turnId,
      persona: turn.persona,
      items: filteredHistory
    })
    const historyItems = [...turnDynamicContext.historyItems]
    let historyTranscript: string | undefined
    const ensureHistoryTranscript = (): string =>
      historyTranscript ??= buildHistoryTranscript(
        historyItems,
        turnId,
        DEFAULT_SDK_HISTORY_TRANSCRIPT_MAX_BYTES
      )
    const instructionBlocks = [
      deps.systemPrompt?.trim(),
      buildClientSurfaceInstruction(resolveTurnClientSurface(turn)),
      thread.systemPrompt?.trim(),
      ...kunContext.instructionBlocks,
      ...turnDynamicContext.instructions
    ].filter((value, index, all): value is string =>
      Boolean(value) && all.indexOf(value) === index
    )
    const model = actingModelRoute.model
    const attachmentIds = userItem.attachmentIds ?? []
    const resolvedImages = await resolveCursorSdkImages({
      attachmentStore: deps.attachmentStore,
      attachmentIds,
      threadId,
      workspace: thread.workspace
    })
    const approvalPolicy = turn.approvalPolicy ?? thread.approvalPolicy
    const sandboxMode = turn.sandboxMode ?? thread.sandboxMode
    let capabilities = cursorSdkCapabilities(Boolean(deps.loadKunTurnContext))
    let options = cursorAgentExecutionOptions({
      workspace: thread.workspace,
      apiKey,
      model,
      name: `Kun · ${thread.title || thread.id}`.slice(0, 120),
      planMode,
      approvalPolicy,
      sandboxMode,
      enforceReadOnly: deps.enforceReadOnly
    })
    if (Object.keys(kunContext.customTools).length > 0) {
      options = {
        ...options,
        local: {
          ...options.local,
          customTools: kunContext.customTools
        }
      }
    }
    let preparation: DelegatedSessionPreparation | undefined
    if (deps.sessionCoordinator) {
      preparation = await deps.sessionCoordinator.prepare({
        threadId,
        route: {
          providerKind: 'cursor-sdk',
          providerId: resolvedProviderId,
          credentialIdentity: delegatedCredentialIdentity({
            providerId: resolvedProviderId,
            accountId: resolvedAccountId,
            credentialSourceId,
            credentialSecret: apiKey
          }),
          workspace: thread.workspace,
          model,
          capabilityFingerprint: delegatedCapabilityFingerprint({
            systemPrompt: deps.systemPrompt?.trim() || '',
            threadPersona: thread.systemPrompt?.trim() || '',
            mode: options.mode,
            sandbox: options.local?.sandboxOptions?.enabled !== false,
            approvalPolicy,
            sandboxMode,
            settingSources: options.local?.settingSources ?? [],
            capabilities,
            ...(deps.loadKunTurnContext
              ? {
                  instructions: kunContext.instructionBlocks,
                  tools: kunContext.tools.map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    inputSchema: tool.inputSchema,
                    providerId: tool.providerId,
                    providerKind: tool.providerKind
                  }))
                }
              : {})
          }),
          continuationMode: 'native'
        },
        priorItems: priorItemsForDelegatedTurn(historyItems, turnId)
      })
    }
    const resolveHandoff = (
      prep: DelegatedSessionPreparation | undefined
    ): TurnHandoff | undefined =>
      resolveTurnHandoff({
        enabled: Boolean(deps.sessionCoordinator) && deps.deterministicHandoff !== false,
        preparation: prep,
        items: historyItems,
        currentTurnId: turnId,
        ownerThreadId: threadId,
        workspacePath: thread.workspace,
        taskWorkspaces: deps.taskWorkspaces
      })
    let turnHandoff = resolveHandoff(preparation)
    let handoffBriefDigest = turnHandoff?.brief.digest
    const buildPrompt = (includeHistory: boolean): string => composeSdkPromptText({
      ...(turnHandoff
        ? { handoffBrief: turnHandoff.brief.text }
        : includeHistory
          ? { historyTranscript: ensureHistoryTranscript() }
          : {}),
      userText,
      instructionBlocks
    })
    const resumeNativeSession = Boolean(
      preparation?.resumed && turnDynamicContext.instructions.length === 0
    )
    let prompt = buildPrompt(!resumeNativeSession)
    let sdkMessage: string | SDKUserMessage = resolvedImages.images.length > 0
      ? { text: prompt, images: resolvedImages.images }
      : prompt
    const recordHandoff = (): Promise<void> =>
      recordHandoffInjected(
        (event) => deps.events.record(event),
        { threadId, turnId, harnessId: 'cursor' },
        turnHandoff
      )
    await deps.events.record({
      kind: 'delegated_runtime',
      threadId,
      turnId,
      providerKind: 'cursor-sdk',
      providerId: resolvedProviderId,
      harnessId: 'cursor',
      phase: resumeNativeSession ? 'resumed' : 'rebased',
      ...(preparation?.rebaseReason ? { reason: preparation.rebaseReason } : {}),
      capabilities,
      capabilitiesV2: capabilitiesV2FromLegacy(capabilities, CURSOR_CAPABILITIES)
    })
    await recordHandoff()
    const contextProfile = deps.contextProfile?.(model)
    const recordContextSnapshot = async (resumed: boolean): Promise<void> => {
      if (!contextProfile) return
      const system = estimateDelegatedTokens(instructionBlocks.join('\n'))
      const messages = estimateDelegatedTokens([
        turnHandoff?.brief.text ?? (resumed ? '' : ensureHistoryTranscript()),
        userText
      ].join('\n'))
      const tools = estimateDelegatedTokens(JSON.stringify(kunContext.tools))
      const skills = estimateDelegatedTokens(kunContext.activeSkillIds.join('\n'))
      const other = resolvedImages.images.length * 1_024
      await deps.events.record({
        kind: 'context_snapshot',
        threadId,
        turnId,
        model,
        providerId: resolvedProviderId,
        stepIndex: 0,
        ...contextProfile,
        estimatedInputTokens: system + skills + tools + messages + other,
        breakdown: { tools, system, skills, messages, other },
        toolCount: kunContext.tools.length,
        activeSkillIds: kunContext.activeSkillIds,
        contextManagement: 'sdk-managed',
        nativeHistory: resumed ? 'unknown' : 'none'
      })
    }
    await recordContextSnapshot(resumeNativeSession)
    const limits = normalizeTurnLimits(deps.turnLimits)
    const mapper = new CursorSdkEventMapper({
      threadId,
      turnId,
      providerId: resolvedProviderId,
      model,
      nextId: (prefix) => deps.ids.next(prefix),
      limits: deps.streamLimits
    })
    const materializedOutputItemIds = new Set<string>()
    let trace: CursorTrace | undefined
    let agent: SDKAgent | undefined
    let run: Run | undefined
    let timedOut = false
    let authenticationRecoveryAttempted = false
    let rejectInterruption: ((error: CursorTurnInterruptedError) => void) | undefined
    const interrupted = new Promise<never>((_resolve, reject) => {
      rejectInterruption = reject
    })
    void interrupted.catch(() => undefined)
    const cancelRun = (): void => {
      if (run) void run.cancel().catch(() => undefined)
    }
    const onAbort = (): void => {
      cancelRun()
      rejectInterruption?.(new CursorTurnInterruptedError('aborted'))
    }
    const timeout = setTimeout(() => {
      timedOut = true
      cancelRun()
      rejectInterruption?.(new CursorTurnInterruptedError('timeout'))
    }, limits.maxWallTimeMs)
    signal.addEventListener('abort', onAbort, { once: true })

    try {
      const sdk = deps.loadSdk
        ? await Promise.race([deps.loadSdk(), interrupted])
        : await Promise.race([
            import('@cursor/sdk').then((module) => module as CursorSdkApi),
            interrupted
          ])
      const attachIsolatedStore = (): void => {
        if (!deps.sessionCoordinator || !sdk.JsonlLocalAgentStore || !preparation) return
        const store = new sdk.JsonlLocalAgentStore(
          deps.sessionCoordinator.store.providerStateDir(
            'cursor-sdk',
            threadId,
            delegatedRouteKey(preparation.route)
          )
        )
        options = {
          ...options,
          local: { ...options.local, store }
        }
      }
      if (deps.sessionCoordinator && !sdk.JsonlLocalAgentStore) {
        if (resumeNativeSession && preparation?.resumed) {
          preparation = await deps.sessionCoordinator.rejectResume(preparation)
        }
        capabilities = { ...capabilities, nativeResume: false }
        await deps.events.record({
          kind: 'delegated_runtime',
          threadId,
          turnId,
          providerKind: 'cursor-sdk',
          providerId: resolvedProviderId,
          harnessId: 'cursor',
          phase: 'portable',
          reason: 'capabilities_changed',
          capabilities,
          capabilitiesV2: capabilitiesV2FromLegacy(capabilities, CURSOR_CAPABILITIES)
        })
        throw new Error(
          'Cursor SDK configuration does not expose the isolated local agent store required for durable sessions'
        )
      }
      attachIsolatedStore()
      if (resumeNativeSession && preparation?.nativeSessionId) {
        try {
          agent = await Promise.race([
            sdk.Agent.resume(preparation.nativeSessionId, options),
            interrupted
          ])
        } catch (error) {
          if (error instanceof CursorTurnInterruptedError) throw error
          preparation = deps.sessionCoordinator
            ? await deps.sessionCoordinator.rejectResume(preparation)
            : {
                ...preparation,
                generation: preparation.generation + 1,
                nativeSessionId: undefined,
                resumed: false,
                rebaseReason: 'native_state_unavailable'
              }
          // The rebased preparation may now need a full handoff brief.
          turnHandoff = resolveHandoff(preparation)
          handoffBriefDigest = turnHandoff?.brief.digest
          attachIsolatedStore()
          prompt = buildPrompt(true)
          sdkMessage = resolvedImages.images.length > 0
            ? { text: prompt, images: resolvedImages.images }
            : prompt
          await deps.events.record({
            kind: 'delegated_runtime',
            threadId,
            turnId,
            providerKind: 'cursor-sdk',
            providerId: resolvedProviderId,
            harnessId: 'cursor',
            phase: 'rebased',
            reason: 'native_state_unavailable',
            capabilities,
            capabilitiesV2: capabilitiesV2FromLegacy(capabilities, CURSOR_CAPABILITIES)
          })
          await recordHandoff()
          await recordContextSnapshot(false)
          await deps.readiness?.validateTurn(threadId, turnId, signal)
          agent = await Promise.race([sdk.Agent.create(options), interrupted])
        }
      } else {
        await deps.readiness?.validateTurn(threadId, turnId, signal)
        agent = await Promise.race([sdk.Agent.create(options), interrupted])
      }
      let attemptPrompt = prompt
      let attemptMessage = sdkMessage
      let forceRecoveryRun = false
      let recoveryContinuesAcceptedRun = false
      let graphRecoveryAttempted = false
      let graphRecoveryPhase = kunContext.graphPhase
      for (;;) {
        trace = await startCursorTrace(deps.debugSink, {
          threadId,
          turnId,
          provider: resolvedProviderId,
          model,
          prompt: attemptPrompt,
          redactedRequestValues: [
            ...goalContextTexts(historyItems),
            ...turnDynamicContext.privateValues
          ],
          instructions: instructionBlocks,
          tools: kunContext.tools,
          images: recoveryContinuesAcceptedRun ? [] : resolvedImages.summaries,
          mode: options.mode ?? 'plan',
          sandboxEnabled: options.local?.sandboxOptions?.enabled !== false,
          delegated: {
            providerKind: 'cursor-sdk',
            phase: resumeNativeSession || recoveryContinuesAcceptedRun ? 'resumed' : 'rebased',
            ...(preparation?.rebaseReason ? { reason: preparation.rebaseReason } : {}),
            contextManagement: 'sdk-managed',
            nativeHistory: resumeNativeSession || recoveryContinuesAcceptedRun
              ? 'unknown'
              : 'none',
            capabilities
          }
        })
        let runAccepted = false
        try {
          run = await Promise.race([
            agent.send(attemptMessage, {
              mode: options.mode,
              local: {
                ...(forceRecoveryRun ? { force: true } : {}),
                // Cursor exposes custom tools through the per-send local
                // override. Re-send the current turn's map so resumed agents
                // and recovery runs cannot fall back to an empty tool set.
                customTools: kunContext.customTools
              }
            }),
            interrupted
          ])
          runAccepted = true

          if (run.supports('stream')) {
            const iterator = run.stream()[Symbol.asyncIterator]()
            for (;;) {
              const next = await Promise.race([iterator.next(), interrupted])
              if (next.done) break
              await consumeCursorMessage(deps,
                threadId,
                turnId,
                mapper,
                next.value,
                trace,
                materializedOutputItemIds
              )
            }
          }
          const result = await Promise.race([run.wait(), interrupted])
          if (result.status === 'cancelled' || signal.aborted) {
            await finishCursorTrace(trace, {
              kind: 'error',
              error: new CursorTurnInterruptedError('aborted')
            })
            trace = undefined
            await deps.turns.finishTurn({ threadId, turnId, status: 'aborted' })
            return 'aborted'
          }
          if (result.status === 'error') {
            throw cursorRunError(result)
          }
          for (const draft of mapper.finalize(result.result, result.usage)) {
            await emitCursorDraft(deps,threadId, draft)
          }
          finishCursorTraceChunks(trace, mapper.text, result.usage, resolvedProviderId, model)
          await finishCursorTrace(trace, { kind: 'completed' })
          trace = undefined
          if (graphRecoveryPhase && !graphRecoveryAttempted) {
            const graphPlanCommitted = kunContext.graphPlanWasCommitted?.() === true
            if (
              graphRecoveryPhase === 'planning' &&
              !graphPlanCommitted &&
              kunContext.graphPlanCanRetry?.() === false
            ) {
              break
            }
            const shouldCheckDurableGraph =
              graphRecoveryPhase === 'supervising' || graphPlanCommitted
            if (graphPlanCommitted) graphRecoveryPhase = 'supervising'
            const graphCompletion = shouldCheckDurableGraph
              ? delegatedGraphCompletionCheck(
                  await deps.turns.suspendGraphLeadTurn({
                    threadId,
                    turnId
                  })
                )
              : 'retry_required'
            if (graphCompletion === 'retry_required') {
              graphRecoveryAttempted = true
              const recoveryInstruction =
                delegatedGraphRecoveryInstruction(graphRecoveryPhase)
              await deps.events.record({
                kind: 'error',
                threadId,
                turnId,
                message: recoveryInstruction,
                code: graphRecoveryPhase === 'planning'
                  ? 'graph_plan_submission_required'
                  : 'graph_supervision_required',
                severity: 'warning'
              })
              attemptPrompt = recoveryInstruction
              attemptMessage = recoveryInstruction
              forceRecoveryRun = false
              recoveryContinuesAcceptedRun = true
              continue
            }
          }
          break
        } catch (error) {
          if (
            authenticationRecoveryAttempted
            || error instanceof CursorTurnInterruptedError
            || cursorSdkErrorCode(error) !== 'cursor_sdk_authentication_failed'
          ) {
            throw error
          }
          authenticationRecoveryAttempted = true
          const safeAttemptError = new Error(sanitizeCursorSdkError(error, apiKey))
          safeAttemptError.name = error instanceof Error ? error.name : 'CursorSdkError'
          await finishCursorTrace(trace, { kind: 'error', error: safeAttemptError })
          trace = undefined
          await deps.events.record({
            kind: 'pipeline_stage',
            threadId,
            turnId,
            stage: 'pre_send',
            label: 'Cursor SDK authentication expired; rebuilding the SDK session and retrying once',
            details: {
              reason: 'cursor_sdk_authentication_failed',
              attempt: 2,
              maxAttempts: 2,
              requestAccepted: runAccepted
            }
          })
          const recoveryAgentId: string = agent.agentId
          await Promise.race([agent[Symbol.asyncDispose](), interrupted])
          agent = await Promise.race([
            sdk.Agent.resume(recoveryAgentId, options),
            interrupted
          ])
          forceRecoveryRun = true
          recoveryContinuesAcceptedRun = runAccepted
          if (runAccepted) {
            attemptPrompt = CURSOR_AUTH_RECOVERY_PROMPT
            attemptMessage = CURSOR_AUTH_RECOVERY_PROMPT
          } else {
            attemptPrompt = prompt
            attemptMessage = sdkMessage
          }
        }
      }
      const graphCompletion = await parkDelegatedGraphTurnAfterRecovery(
        deps.turns,
        { threadId, turnId }
      )
      const outcome: TurnRunOutcome =
        graphCompletion === 'suspended' ||
        graphCompletion === 'suspended_pending_supervision'
          ? graphCompletion
          : 'completed'
      if (outcome === 'completed') {
        await deps.turns.finishTurn({ threadId, turnId, status: 'completed' })
      }
      if (preparation && deps.sessionCoordinator) {
        try {
          await deps.sessionCoordinator.commit({
            preparation,
            // Preserve the exact goal generation visible to this request.
            // A goal mutation during the turn must trigger one rebase on the
            // next request, not make this checkpoint disagree forever.
            committedItems: filterGoalContextsForGoalKey(
              await deps.sessionStore.loadItems(threadId),
              goalContextKeyForHistory
            ),
            lastCommittedTurnId: turnId,
            nativeSessionId: turnDynamicContext.instructions.length > 0
              ? undefined
              : agent.agentId,
            ...(handoffBriefDigest ? { handoffBriefDigest } : {})
          })
        } catch {
          // The canonical Kun turn is already durable. A checkpoint write
          // failure simply forces a portable rebase on the next turn.
        }
      }
      return outcome
    } catch (error) {
      const abortedBeforeFailure = signal.aborted
      abortRuntime()
      cancelRun()
      const { code, message, safeTraceError } = cursorTurnFailure(error, apiKey, {
        timedOut, maxWallTimeMs: limits.maxWallTimeMs, authenticationRecoveryAttempted
      })
      await finishCursorTrace(trace, { kind: 'error', error: safeTraceError })
      trace = undefined
      if (
        abortedBeforeFailure
        || error instanceof CursorTurnInterruptedError && error.reason === 'aborted'
      ) {
        await deps.turns.finishTurn({ threadId, turnId, status: 'aborted' })
        return 'aborted'
      }
      await deps.events.record({
        kind: 'error',
        threadId,
        turnId,
        message,
        code,
        severity: 'error'
      })
      await deps.turns.finishTurn({
        threadId,
        turnId,
        status: 'failed',
        error: message,
        code,
        severity: 'error'
      })
      return 'failed'
    } finally {
      clearTimeout(timeout)
      signal.removeEventListener('abort', onAbort)
      try {
        agent?.close()
      } catch {
        // best effort: the turn is already terminal
      }
    }
}
