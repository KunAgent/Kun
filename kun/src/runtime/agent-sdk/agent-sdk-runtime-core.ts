import { makeAssistantReasoningItem, makeAssistantTextItem } from '../../domain/item.js'
import { normalizeTurnLimits } from '../../loop/turn-limits.js'
import type { TurnRunOutcome } from '../../loop/turn-execution-types.js'
import { SdkEventMapper, SdkResourceLimitError } from './sdk-event-mapper.js'
import { assembleSdkOptions, buildCanUseTool } from './sdk-options-builder.js'
import {
  bridgedToolModelNames,
  buildBridgedToolSpecs,
  selectBridgeableTools,
  toSdkMcpServer
} from './sdk-tool-bridge.js'
import { composeSdkPromptText } from './sdk-context-assembler.js'
import type { SdkQueryResult } from './sdk-protocol.js'
import type { DelegatedRuntimeCapabilities } from '../delegated-turn-runtime.js'
import {
  delegatedGraphPlanCanRetry,
  delegatedGraphPlanRepairFeedback,
  delegatedGraphPlanWasCommitted,
  delegatedGraphRecoveryInstruction
} from '../delegated-graph-turn-policy.js'
import {
  AgentSdkCredentialUnavailableError,
  AgentSdkProtocolError,
  userMessageStream,
  type SdkRuntimeDeps,
  type SdkTurnContext,
  type TurnStatus
} from './agent-sdk-runtime-contracts.js'
import {
  MAX_SVG_COMPLETION_ATTEMPTS,
  assistantDeltaOf,
  itemOf,
  observeSvgToolResult,
  shouldPersist,
  svgCompletionRecoveryInstruction,
  svgCompletionSatisfied,
  type SdkSvgCompletionState
} from './agent-sdk-runtime-items.js'
import {
  captureAgentSdkTraceDraft,
  estimatedTokens,
  finishAgentSdkTrace,
  sanitizeAgentSdkError,
  startAgentSdkTrace
} from './agent-sdk-runtime-trace.js'
import {
  SdkAssistantDeltaEventCoalescer,
  agentSdkCapabilities,
  abortError,
  awaitAbortable,
  closeIterator,
  sdkResultTurnCount
} from './agent-sdk-runtime-stream.js'
import { decideSdkBuiltinSandbox } from './agent-sdk-runtime-sandbox.js'

export class AgentSdkRuntime {
  constructor(private readonly deps: SdkRuntimeDeps) {}

  handlesProvider(providerId: string | undefined): boolean {
    return this.deps.handlesProvider(providerId)
  }

  capabilities(providerId: string | undefined): DelegatedRuntimeCapabilities | undefined {
    if (!this.handlesProvider(providerId)) return undefined
    return agentSdkCapabilities()
  }

  async runTurn(
    threadId: string,
    turnId: string,
    signal: AbortSignal
  ): Promise<TurnRunOutcome> {
    const execute = () => this.runTurnOwned(threadId, turnId, signal)
    return this.deps.runExclusive
      ? this.deps.runExclusive(threadId, execute)
      : execute()
  }

  private async runTurnOwned(
    threadId: string,
    turnId: string,
    signal: AbortSignal
  ): Promise<TurnRunOutcome> {
    let ctx: SdkTurnContext | null
    try {
      ctx = await this.deps.loadTurnContext(threadId, turnId, signal)
    } catch (error) {
      if (signal.aborted) {
        await this.deps.finishTurn(threadId, turnId, 'aborted')
        return 'aborted'
      }
      if (!(error instanceof AgentSdkCredentialUnavailableError)) throw error
      await this.deps.recordEvent({
        kind: 'error',
        threadId,
        turnId,
        message: error.message,
        code: error.code,
        severity: 'error'
      })
      await this.deps.finishTurn(threadId, turnId, 'failed', error.message, error.code)
      return 'failed'
    }
    if (signal.aborted) {
      await this.deps.finishTurn(threadId, turnId, 'aborted')
      return 'aborted'
    }
    if (!ctx) {
      await this.deps.finishTurn(threadId, turnId, 'failed', 'no input for subscription turn')
      return 'failed'
    }
    if (ctx.requireSvgCompletion) {
      const toolNames = new Set(ctx.bridgeableTools.map((tool) => tool.name))
      const canMutate = toolNames.has('design_svg_edit') || toolNames.has('design_svg_animate')
      const canValidate = toolNames.has('design_svg_validate')
      const sandboxBlocksMutation = ctx.sandboxMode === 'read-only' || ctx.sandboxMode === 'external-sandbox'
      if (ctx.approvalPolicy === 'never' || sandboxBlocksMutation || !canMutate || !canValidate) {
        const message = 'Dedicated SVG artifact tools are unavailable under the current approval, plan, skill, or sandbox policy.'
        await this.deps.recordEvent({
          kind: 'error', threadId, turnId, message, code: 'svg_tools_unavailable', severity: 'error'
        })
        await this.deps.finishTurn(threadId, turnId, 'failed', message)
        return 'failed'
      }
    }

    const limits = normalizeTurnLimits(this.deps.getTurnLimits?.())
    const sdkStreamLimits = this.deps.getSdkStreamLimits?.()
    const mapper = new SdkEventMapper({
      threadId,
      turnId,
      ...(ctx.billingKind ? { billingKind: ctx.billingKind, model: ctx.model } : {}),
      nextId: (p) => this.deps.nextId(p),
      streamLimits: {
        ...sdkStreamLimits,
        // A delegated SDK assistant message is one native model step. Keep the
        // same per-step tool-call ceiling even when a test overrides other
        // stream budgets.
        maxToolCallsPerStep: limits.maxToolCallsPerStep,
        maxPendingToolCalls: sdkStreamLimits?.maxPendingToolCalls ?? limits.maxToolCallsPerStep
      }
    })
    let emittedText = ''
    let emittedReasoning = ''
    let queuedTextChars = 0
    let queuedReasoningChars = 0
    const deltaEvents = new SdkAssistantDeltaEventCoalescer(async (delta) => {
      if (delta.kind === 'assistant_text_delta') {
        if (delta.textOffset !== emittedText.length) {
          throw new Error(
            `Agent SDK assistant text delta offset mismatch: expected ${emittedText.length}, ` +
            `got ${delta.textOffset}`
          )
        }
        emittedText += delta.text
        await this.deps.applyAssistantDelta(
          threadId,
          makeAssistantTextItem({
            id: delta.itemId, threadId, turnId, text: emittedText, status: 'running'
          }),
          delta.text,
          delta.textOffset
        )
        return
      }
      if (delta.textOffset !== emittedReasoning.length) {
        throw new Error(
          `Agent SDK assistant reasoning delta offset mismatch: expected ${emittedReasoning.length}, ` +
          `got ${delta.textOffset}`
        )
      }
      emittedReasoning += delta.text
      await this.deps.applyAssistantDelta(
        threadId,
        makeAssistantReasoningItem({
          id: delta.itemId, threadId, turnId, text: emittedReasoning, status: 'running'
        }),
        delta.text,
        delta.textOffset
      )
    })
    const abort = new AbortController()
    const maxWallTimeMs = limits.maxWallTimeMs
    let timedOut = false
    let activeStream: SdkQueryResult | undefined
    let activeStreamInterrupted = false
    const interruptActiveStream = (): void => {
      if (!activeStream || activeStreamInterrupted) return
      activeStreamInterrupted = true
      try {
        const interrupted = activeStream.interrupt?.()
        if (interrupted) void Promise.resolve(interrupted).catch(() => undefined)
      } catch {
        // Best effort: the abort controller is the authoritative cancellation
        // path, and reporting the original limit must not be masked here.
      }
    }
    const onAbort = (): void => {
      abort.abort(signal.reason)
      interruptActiveStream()
    }
    const failWithLimit = async (
      code: 'turn_step_limit' | 'turn_wall_time_limit' | 'tool_call_limit_exceeded' | 'stream_resource_limit',
      message: string
    ): Promise<'failed'> => {
      await this.deps.recordEvent({
        kind: 'error', threadId, turnId, message, code, severity: 'warning'
      })
      await this.deps.finishTurn(threadId, turnId, 'failed', message)
      return 'failed'
    }
    const timeout = setTimeout(() => {
      timedOut = true
      abort.abort(new Error(`turn exceeded ${maxWallTimeMs}ms wall time`))
      interruptActiveStream()
    }, maxWallTimeMs)
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })

    try {
      if (abort.signal.aborted) throw abortError(abort.signal)
      const sdk = await awaitAbortable(() => this.deps.loadSdk(), abort.signal)

      // Bridge kun-exclusive tools into an in-process MCP server.
      const selectedKunTools = selectBridgeableTools(
        ctx.bridgeableTools,
        ctx.bridgeKunBuiltinOverlaps || ctx.planMode ? { overlap: new Set() } : undefined
      )
      let graphPlanCommitted = false
      let graphPlanRetryAllowed = true
      let graphPlanRepairFeedback: string | undefined
      const bridged = buildBridgedToolSpecs(selectedKunTools, async (name, args) => {
        const result = await this.deps.executeKunTool(
          threadId,
          turnId,
          name,
          args,
          abort.signal
        )
        if (name === 'graph_define_plan') {
          if (delegatedGraphPlanWasCommitted(result)) {
            graphPlanCommitted = true
            graphPlanRetryAllowed = false
            graphPlanRepairFeedback = undefined
          } else {
            graphPlanRetryAllowed = delegatedGraphPlanCanRetry(result)
            graphPlanRepairFeedback =
              delegatedGraphPlanRepairFeedback(result)
          }
        }
        return result
      })
      let resumeSessionId = ctx.resumeSessionId
      let activeRebaseReason = ctx.sessionPreparation?.rebaseReason
      const buildOptions = (maxTurns?: number) => assembleSdkOptions({
          cwd: ctx.workspace,
          kunSystemPrompt: this.deps.kunSystemPrompt(),
          threadPersona: ctx.threadPersona,
          // Plan turns never enter SDK bypassPermissions; bridged calls still
          // cross Kun's own execution gate below.
          approvalPolicy: ctx.planMode ? 'never' : ctx.approvalPolicy,
          ...(ctx.sandboxMode ? { sandboxMode: ctx.sandboxMode } : {}),
          // Do not map Kun's plan turn to the SDK's global `plan` permission:
          // that also blocks Kun's bridged create_plan tool. Plan authority is
          // instead enforced by disabling native built-ins, bridging the
          // Plan-filtered Kun catalog, and denying forged native calls below.
          bridgedToolModelNames: bridgedToolModelNames(bridged),
          ...(ctx.allowSdkBuiltins === false || ctx.requireSvgCompletion || ctx.planMode
            ? { allowSdkBuiltins: false }
            : {}),
          // Each retry gets a fresh SDK MCP server wrapper. Reusing one server
          // instance across independent query transports is not guaranteed to be
          // reconnectable by the Agent SDK.
          mcpServers: bridged.length ? { kun: toSdkMcpServer(sdk, bridged) } : undefined,
          canUseTool: buildCanUseTool((name, input) => {
            const sandboxDecision = decideSdkBuiltinSandbox(name, input, ctx)
            if (sandboxDecision) return sandboxDecision
            return this.deps.decideToolApproval(threadId, turnId, name, input, abort.signal)
          }),
          baseEnv: {
            ...this.deps.baseEnv(),
            ...(ctx.claudeConfigDir ? { CLAUDE_CONFIG_DIR: ctx.claudeConfigDir } : {})
          },
          oauthToken: ctx.oauthToken,
          abortController: abort,
          ...(maxTurns !== undefined ? { maxTurns } : {}),
          ...(ctx.model ? { model: ctx.model } : {}),
          ...(ctx.reasoningEffort ? { reasoningEffort: ctx.reasoningEffort } : {}),
          ...(resumeSessionId ? { resume: resumeSessionId } : {}),
          ...(this.deps.pathToClaudeCodeExecutable
            ? { pathToClaudeCodeExecutable: this.deps.pathToClaudeCodeExecutable }
            : {})
        })

      // A compatible native session already owns prior context. Portable
      // history is sent only when seeding a new generation.
      const composeTurnText = (): string => ctx.preserveExactUserPrompt
        ? ctx.userText
        : composeSdkPromptText({
            ...(!resumeSessionId && ctx.historyTranscript
              ? { historyTranscript: ctx.historyTranscript }
              : {}),
            userText: ctx.userText,
            ...(ctx.contextInstructions?.length ? { instructionBlocks: ctx.contextInstructions } : {})
          })
      const capabilities = agentSdkCapabilities()
      await this.deps.recordEvent({
        kind: 'delegated_runtime',
        threadId,
        turnId,
        providerKind: 'agent-sdk',
        providerId: ctx.sessionPreparation?.route.providerId ?? 'default',
        phase: resumeSessionId ? 'resumed' : 'rebased',
        ...(ctx.sessionPreparation?.rebaseReason
          ? { reason: ctx.sessionPreparation.rebaseReason }
          : {}),
        capabilities
      })
      const recordContextSnapshot = async (): Promise<void> => {
        if (!ctx.contextProfile) return
        const system = estimatedTokens([
          this.deps.kunSystemPrompt(),
          ctx.threadPersona ?? ''
        ].join('\n'))
        const tools = estimatedTokens(JSON.stringify(selectedKunTools))
        const skills = estimatedTokens((ctx.contextInstructions ?? []).join('\n'))
        const messages = estimatedTokens([
          resumeSessionId ? '' : ctx.historyTranscript ?? '',
          ctx.userText
        ].join('\n'))
        const other = (ctx.images?.length ?? 0) * 1_024
        await this.deps.recordEvent({
          kind: 'context_snapshot',
          threadId,
          turnId,
          model: ctx.model ?? 'claude-default',
          providerId: ctx.sessionPreparation?.route.providerId ?? 'default',
          stepIndex: 0,
          ...ctx.contextProfile,
          estimatedInputTokens: tools + system + skills + messages + other,
          breakdown: { tools, system, skills, messages, other },
          toolCount: selectedKunTools.length,
          activeSkillIds: [...(ctx.activeSkillIds ?? [])],
          contextManagement: 'sdk-managed',
          nativeHistory: resumeSessionId ? 'unknown' : 'none'
        })
      }
      await recordContextSnapshot()
      const svgCompletion: SdkSvgCompletionState = {
        sequence: 0,
        lastMutation: -1,
        lastValidation: -1
      }
      const maxAttempts = ctx.graphPhase
        ? 2
        : ctx.requireSvgCompletion
          ? MAX_SVG_COMPLETION_ATTEMPTS
          : 1
      let graphRecoveryPhase = ctx.graphPhase
      let completionGateFailed = false
      let stepLimitFailed = false
      let sdkTurnsUsed = 0
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const remainingTurns = limits.maxSteps === undefined
          ? undefined
          : limits.maxSteps - sdkTurnsUsed
        if (remainingTurns !== undefined && remainingTurns <= 0) {
          stepLimitFailed = true
          break
        }
        const composedText = composeTurnText()
        const attemptText = attempt === 0
          ? composedText
          : graphRecoveryPhase
            ? delegatedGraphRecoveryInstruction(
                graphRecoveryPhase,
                graphPlanRepairFeedback
              )
            : `${composedText}\n\n${svgCompletionRecoveryInstruction(svgCompletion)}`
        const prompt = (
          ctx.images &&
          ctx.images.length > 0 &&
          !(ctx.graphPhase && attempt > 0)
        )
          ? userMessageStream(attemptText, ctx.images)
          : attemptText
        const options = buildOptions(remainingTurns)
        mapper.beginQuery()
        let attemptFinalSeen = false
        let attemptMessageSeen = false
        let attemptTurns = 0
        let trace = await startAgentSdkTrace(this.deps.debugSink, {
          threadId,
          turnId,
          provider: ctx.sessionPreparation?.route.providerId ?? 'default',
          model: ctx.model ?? 'claude-default',
          prompt: attemptText,
          systemPrompt: this.deps.kunSystemPrompt(),
          threadPersona: ctx.threadPersona,
          contextInstructions: ctx.contextInstructions ?? [],
          redactedRequestValues: ctx.redactedRequestValues ?? [],
          tools: selectedKunTools,
          images: (ctx.images ?? []).map((image) => ({ mediaType: image.mediaType })),
          approvalPolicy: ctx.approvalPolicy,
          sandboxMode: ctx.sandboxMode,
          oauthToken: ctx.oauthToken,
          delegated: {
            providerKind: 'agent-sdk',
            phase: resumeSessionId ? 'resumed' : 'rebased',
            ...(!resumeSessionId && activeRebaseReason
              ? { reason: activeRebaseReason }
              : {}),
            contextManagement: 'sdk-managed',
            nativeHistory: resumeSessionId ? 'unknown' : 'none',
            capabilities
          }
        })
        try {
          const stream = sdk.query({ prompt, options })
          activeStream = stream
          activeStreamInterrupted = false
          const iterator = stream[Symbol.asyncIterator]()
          for (;;) {
            const next = await awaitAbortable(() => iterator.next(), abort.signal)
            if (next.done) break
            attemptMessageSeen = true
            const message = next.value
            if (signal.aborted || abort.signal.aborted) {
              interruptActiveStream()
              break
            }
            if (message.type === 'result') {
              attemptFinalSeen = true
              attemptTurns = sdkResultTurnCount(message)
            }
            for (const draft of mapper.map(message)) {
              captureAgentSdkTraceDraft(trace, draft)
              const delta = assistantDeltaOf(draft)
              if (delta) {
                const textOffset = delta.kind === 'assistant_text_delta'
                  ? queuedTextChars
                  : queuedReasoningChars
                await deltaEvents.append({ ...delta, textOffset })
                if (delta.kind === 'assistant_text_delta') {
                  queuedTextChars += delta.text.length
                } else {
                  queuedReasoningChars += delta.text.length
                }
                continue
              }
              // Preserve the mapper's exact event order: milestones, tools,
              // usage, and errors may not overtake pending assistant deltas.
              await deltaEvents.flush()
              const item = itemOf(draft)
              if (ctx.requireSvgCompletion && item) observeSvgToolResult(svgCompletion, item)
              if (item && shouldPersist(item)) {
                // applyItem persists the item AND records its own item_created event,
                // so only ALSO record non-item_created signal events (tool_call_ready,
                // tool_call_finished) — never the item_created draft itself, or the
                // item would be published twice.
                await this.deps.applyItem(threadId, item)
                if (draft.kind !== 'item_created') await this.deps.recordEvent(draft)
              } else {
                await this.deps.recordEvent(draft)
              }
            }
            // `result` is terminal and already carries usage/final status. Give
            // the Query a bounded chance to clean up before a recovery query starts.
            if (attemptFinalSeen) {
              const closed = await closeIterator(iterator, abort.signal)
              if (!closed) interruptActiveStream()
              break
            }
          }
          if (!attemptFinalSeen && !signal.aborted && !abort.signal.aborted) {
            const protocolError = new AgentSdkProtocolError(
              'agent SDK stream ended without a terminal result'
            )
            await finishAgentSdkTrace(trace, { kind: 'error', error: protocolError })
            trace = undefined
            throw protocolError
          }
          const attemptFinal = mapper.getFinal()
          if (attemptFinalSeen && attemptFinal?.status === 'failed') {
            await finishAgentSdkTrace(trace, {
              kind: 'failed',
              error: new Error(sanitizeAgentSdkError(
                attemptFinal.message ?? 'agent SDK query failed',
                ctx.oauthToken
              ))
            })
          } else if (signal.aborted || abort.signal.aborted) {
            await finishAgentSdkTrace(trace, {
              kind: 'error',
              error: abortError(abort.signal)
            })
          } else {
            await finishAgentSdkTrace(trace, { kind: 'completed' })
          }
          trace = undefined
        } catch (error) {
          await finishAgentSdkTrace(trace, {
            kind: 'error',
            error: new Error(sanitizeAgentSdkError(error, ctx.oauthToken))
          })
          trace = undefined
          if (resumeSessionId && !attemptMessageSeen && !abort.signal.aborted) {
            resumeSessionId = undefined
            activeRebaseReason = 'native_state_unavailable'
            activeStream = undefined
            await this.deps.rejectResume?.(threadId, turnId)
            await this.deps.recordEvent({
              kind: 'delegated_runtime',
              threadId,
              turnId,
              providerKind: 'agent-sdk',
              providerId: ctx.sessionPreparation?.route.providerId ?? 'default',
              phase: 'rebased',
              reason: 'native_state_unavailable',
              capabilities
            })
            await recordContextSnapshot()
            attempt -= 1
            continue
          }
          throw error
        }
        if (timedOut) interruptActiveStream()
        activeStream = undefined
        // Every recovery query must resume the session created by the
        // immediately preceding query. Otherwise the model loses structured
        // MCP tool results (notably graph_define_plan issue paths).
        resumeSessionId = mapper.getSessionId() ?? resumeSessionId
        // Starting a query consumes at least one native model step even if a
        // malformed/aborted SDK stream omits its terminal result message.
        sdkTurnsUsed += attemptFinalSeen ? Math.max(1, attemptTurns) : 1
        if (limits.maxSteps !== undefined && sdkTurnsUsed > limits.maxSteps) stepLimitFailed = true
        if (attemptFinalSeen && mapper.getFinal()?.status === 'failed') break
        if (signal.aborted || abort.signal.aborted) {
          break
        }
        if (ctx.graphPhase) {
          if (attempt > 0) break
          if (
            ctx.graphPhase === 'planning' &&
            !graphPlanCommitted &&
            !graphPlanRetryAllowed
          ) {
            break
          }
          const shouldCheckDurableGraph =
            ctx.graphPhase === 'supervising' || graphPlanCommitted
          const recoveryPhase = graphPlanCommitted
            ? 'supervising'
            : ctx.graphPhase
          graphRecoveryPhase = recoveryPhase
          const graphCompletion = shouldCheckDurableGraph
            ? await this.deps.checkGraphCompletion?.(threadId, turnId) ?? 'retry_required'
            : 'retry_required'
          if (graphCompletion !== 'retry_required') break
          if (limits.maxSteps !== undefined && sdkTurnsUsed >= limits.maxSteps) {
            stepLimitFailed = true
            break
          }
          await this.deps.recordEvent({
            kind: 'error',
            threadId,
            turnId,
            message: delegatedGraphRecoveryInstruction(
              recoveryPhase,
              graphPlanRepairFeedback
            ),
            code: recoveryPhase === 'planning'
              ? 'graph_plan_submission_required'
              : 'graph_supervision_required',
            severity: 'warning'
          })
          continue
        }
        if (!ctx.requireSvgCompletion || svgCompletionSatisfied(svgCompletion)) {
          break
        }
        if (limits.maxSteps !== undefined && sdkTurnsUsed >= limits.maxSteps) {
          stepLimitFailed = true
          break
        }
        const message = svgCompletionRecoveryInstruction(svgCompletion)
        await this.deps.recordEvent({
          kind: 'error',
          threadId,
          turnId,
          message,
          code: svgCompletion.lastMutation < 0
            ? 'required_svg_mutation_missing'
            : 'required_svg_validation_missing',
          severity: 'warning'
        })
        if (attempt === maxAttempts - 1) completionGateFailed = true
      }

      await deltaEvents.flush()
      // Some SDK versions omit a fresh init/session message when resuming.
      // A successful resumed query still advances the already validated native
      // session, so retain that ID instead of downgrading the binding.
      const sessionId = mapper.getSessionId() ?? resumeSessionId
      if (sessionId && !ctx.disableNativeContinuation) {
        await this.deps.saveSessionId(threadId, turnId, sessionId)
      }

      if (signal.aborted) {
        await this.deps.finishTurn(threadId, turnId, 'aborted')
        return 'aborted'
      }
      if (timedOut) {
        const message = `turn exceeded ${maxWallTimeMs}ms wall time`
        return await failWithLimit('turn_wall_time_limit', message)
      }
      if (stepLimitFailed && limits.maxSteps !== undefined) {
        return await failWithLimit('turn_step_limit', `turn exceeded ${limits.maxSteps} model steps`)
      }
      if (completionGateFailed) {
        const message = 'Dedicated SVG artifact turn exhausted its recovery attempts without a successful structured mutation followed by validation.'
        await this.deps.finishTurn(threadId, turnId, 'failed', message)
        return 'failed'
      }

      const final = mapper.getFinal()
      if (final?.code === 'turn_step_limit' && limits.maxSteps !== undefined) {
        return await failWithLimit('turn_step_limit', `turn exceeded ${limits.maxSteps} model steps`)
      }
      const status: 'completed' | 'failed' | 'aborted' =
        final?.status === 'failed' ? 'failed' : 'completed'
      return (await this.deps.finishTurn(
        threadId,
        turnId,
        status,
        final?.message ? sanitizeAgentSdkError(final.message, ctx.oauthToken) : undefined
      )) ?? status
    } catch (err) {
      let failure = err
      try {
        await deltaEvents.flush()
      } catch (deltaError) {
        failure = deltaError
      }
      if (signal.aborted) {
        interruptActiveStream()
        await this.deps.finishTurn(threadId, turnId, 'aborted')
        return 'aborted'
      }
      if (timedOut) {
        interruptActiveStream()
        return await failWithLimit(
          'turn_wall_time_limit',
          `turn exceeded ${maxWallTimeMs}ms wall time`
        )
      }
      if (failure instanceof SdkResourceLimitError) {
        abort.abort(failure)
        interruptActiveStream()
        return await failWithLimit(failure.code, failure.message)
      }
      if (failure instanceof AgentSdkProtocolError) {
        abort.abort(failure)
        interruptActiveStream()
        await this.deps.recordEvent({
          kind: 'error', threadId, turnId, message: failure.message, code: failure.code, severity: 'error'
        })
        await this.deps.finishTurn(threadId, turnId, 'failed', failure.message)
        return 'failed'
      }
      abort.abort(failure)
      interruptActiveStream()
      const message = sanitizeAgentSdkError(failure, ctx.oauthToken)
      await this.deps.recordEvent({ kind: 'error', threadId, turnId, message })
      await this.deps.finishTurn(threadId, turnId, 'failed', message)
      return 'failed'
    } finally {
      deltaEvents.dispose()
      clearTimeout(timeout)
      signal.removeEventListener('abort', onAbort)
    }
  }
}
