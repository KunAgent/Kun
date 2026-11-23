import { sessionInstructions } from '../../session/session-instructions.js'
import {
  buildAntigravityContextSnapshot,
  loadCarriedAntigravityOccupancy,
  type AntigravityContextProfile
} from './antigravity-context-snapshot.js'
import { parseAntigravityResult } from './antigravity-result.js'
import {
  finishAntigravityTrace,
  startAntigravityTrace,
  type AntigravityTrace
} from './antigravity-trace.js'
import { AntigravityTurnStream, persistAntigravityText } from './antigravity-turn-stream.js'
import type { spawn } from 'node:child_process'
import type { HarnessRoute } from '../../contracts/harness.js'
import type { ServeProviderConfig } from '../../config/kun-config.js'
import type {
  ActingTurnModelRoute,
  TurnReasoningEffort
} from '../../contracts/turns.js'
import type { AttachmentStore } from '../../attachments/attachment-store.js'
import { goalContextTexts } from '../../contracts/items.js'
import { resolveAntigravityTurnInput } from './antigravity-attachments.js'
import { historyReferenceInstructions } from '../../prompt/history-reference-context.js'
import {
  filterGoalContextsForGoalKey,
  goalContextKey
} from '../../loop/continuation-instructions.js'
import { resolveTurnClientSurface } from '../../loop/turn-context-resolver.js'
import { normalizeTurnLimits, type TurnLimitsConfig } from '../../loop/turn-limits.js'
import type { TurnRunOutcome } from '../../loop/turn-execution-types.js'
import type { SessionStore } from '../../ports/session-store.js'
import type { ThreadStore } from '../../ports/thread-store.js'
import { buildClientSurfaceInstruction } from '../../prompt/kun-prompt-context.js'
import { projectTurnDynamicContext } from '../../prompt/turn-persona-context.js'
import type { LlmDebugSink } from '../../services/llm-debug-recorder.js'
import type { RuntimeEventRecorder } from '../../services/runtime-event-recorder.js'
import type { TurnService } from '../../services/turn-service.js'
import {
  buildHistoryTranscript,
  composeSdkPromptText,
  DEFAULT_SDK_HISTORY_TRANSCRIPT_MAX_BYTES
} from '../agent-sdk/sdk-context-assembler.js'
import type {
  DelegatedRuntimeCapabilities,
  DelegatedTurnRuntime
} from '../delegated-turn-runtime.js'
import { capabilitiesV2FromLegacy } from '../../harness/effective-capabilities.js'
import { ANTIGRAVITY_CLI_CAPABILITIES } from '../../harness/builtin-harnesses.js'
import {
  delegatedCapabilityFingerprint,
  delegatedCredentialIdentity,
  priorItemsForDelegatedTurn,
  type DelegatedSessionCoordinator
} from '../delegated-session-binding.js'
import { recordHandoffInjected, resolveTurnHandoff } from '../../handoff/turn-handoff.js'
import { runAntigravityProcess } from './antigravity-process.js'
import { parkDelegatedGraphTurnAfterRecovery } from '../delegated-graph-turn-policy.js'
import { isMissingAntigravitySession } from './antigravity-resume.js'
import {
  buildAntigravityArgs,
  resolveAntigravityPrintModel
} from './antigravity-args.js'

export {
  buildAntigravityArgs,
  normalizeAntigravityEffort,
  normalizeAntigravityModel
} from './antigravity-args.js'

export interface AntigravityCliRuntimeDeps {
  nativeNetworkEnv?: () => Record<string, string>
  readiness?: Pick<import('../../harness/harness-readiness.js').HarnessReadinessService, 'validateTurn'>
  resolveCredentialSource?: (sourceId: string) => Promise<{ apiKey: string } | null>
  providerConfigs: Record<string, ServeProviderConfig>
  providerIds: ReadonlySet<string>
  defaultIsAntigravity: boolean
  defaultModel?: string
  /** Immutable Kun/role prompt supplied by the owning runtime boundary. */
  systemPrompt?: string
  binaryPath?: string
  threadStore: ThreadStore
  sessionStore: SessionStore
  turns: TurnService
  events: RuntimeEventRecorder
  ids: { next(prefix: string): string }
  attachmentStore?: AttachmentStore
  debugSink?: LlmDebugSink
  turnLimits?: TurnLimitsConfig
  spawnFn?: typeof spawn
  /** Delegated read-only children must deny mutation regardless of parent defaults. */
  enforceReadOnly?: boolean
  sessionCoordinator?: DelegatedSessionCoordinator
  /** Host task-workspace index for handoff work-state merging. */
  taskWorkspaces?: {
    list(filter?: { ownerThreadId?: string }): Array<{
      ownerThreadId: string
      path: string
      branch?: string
      changedFiles: readonly string[]
    }>
  }
  /**
   * `ade.deterministicHandoff` — when false the runtime sends the raw portable
   * transcript instead of the deterministic brief.
   */
  deterministicHandoff?: boolean
  contextProfile?: (model: string, providerId?: string) => AntigravityContextProfile
}

export class AntigravityCliRuntime implements DelegatedTurnRuntime {
  constructor(private readonly deps: AntigravityCliRuntimeDeps) {}

  handlesRoute(route: HarnessRoute): boolean {
    return route.harnessId === 'antigravity' && route.credentialMode === 'native-login' &&
      (!route.providerId || route.providerId === 'default' || this.deps.providerIds.has(route.providerId))
  }

  handlesProvider(providerId: string | undefined): boolean {
    if (providerId && this.deps.providerIds.has(providerId)) return true
    if (!this.deps.defaultIsAntigravity) return false
    return !providerId || !this.deps.providerConfigs[providerId]
  }

  capabilities(providerId: string | undefined): DelegatedRuntimeCapabilities | undefined {
    if (!this.handlesProvider(providerId)) return undefined
    return antigravityCapabilities()
  }

  async runTurn(
    threadId: string,
    turnId: string,
    signal: AbortSignal,
    providerId?: string
  ): Promise<TurnRunOutcome> {
    const execute = () => this.runTurnOwned(threadId, turnId, signal, providerId)
    return this.deps.sessionCoordinator
      ? this.deps.sessionCoordinator.runExclusive(threadId, execute)
      : execute()
  }

  private async runTurnOwned(
    threadId: string,
    turnId: string,
    signal: AbortSignal,
    providerId?: string
  ): Promise<TurnRunOutcome> {
    const thread = await this.deps.threadStore.get(threadId)
    const turn = thread?.turns.find((candidate) => candidate.id === turnId)
    if (!thread || !turn) {
      await this.deps.turns.finishTurn({
        threadId,
        turnId,
        status: 'failed',
        error: 'no input for Antigravity subscription turn'
      })
      return 'failed'
    }
    let items = await this.deps.sessionStore.loadItems(threadId)
    const userItem = [...items]
      .reverse()
      .find((item) => item.turnId === turnId && item.kind === 'user_message')
    if (!userItem || userItem.kind !== 'user_message') {
      await this.deps.turns.finishTurn({
        threadId,
        turnId,
        status: 'failed',
        error: 'no input for Antigravity subscription turn'
      })
      return 'failed'
    }
    if (turn.orchestration === 'graph') {
      const message =
        'Graph mode is unavailable for the Antigravity CLI provider because it cannot execute Kun structured Graph tools. Choose a tool-capable provider and continue the same planning draft.'
      await this.persistAssistantText(threadId, turnId, message)
      const graphCompletion = await parkDelegatedGraphTurnAfterRecovery(
        this.deps.turns,
        { threadId, turnId }
      )
      if (
        graphCompletion === 'suspended' ||
        graphCompletion === 'suspended_pending_supervision'
      ) return graphCompletion
      await this.deps.turns.finishTurn({
        threadId,
        turnId,
        status: 'failed',
        error: message,
        code: 'antigravity_graph_tools_unsupported',
        severity: 'error'
      })
      return 'failed'
    }
    const planMode = this.deps.enforceReadOnly === true || (turn.mode ?? thread.mode) === 'plan'
    if (!planMode && thread.goal?.status === 'active') {
      await this.deps.turns.ensureGoalContext(threadId, turnId, signal)
      items = await this.deps.sessionStore.loadItems(threadId)
    }
    if (signal.aborted) {
      await this.deps.turns.finishTurn({ threadId, turnId, status: 'aborted' })
      return 'aborted'
    }
    const goalForHistory = planMode
      ? undefined
      : (await this.deps.threadStore.get(threadId))?.goal
    const goalContextKeyForHistory = goalContextKey(goalForHistory)
    items = filterGoalContextsForGoalKey(items, goalContextKeyForHistory)
    const turnDynamicContext = projectTurnDynamicContext({
      turnId,
      persona: turn.persona,
      items
    })
    items = [...turnDynamicContext.historyItems]

    const instructionBlocks = [
      this.deps.systemPrompt?.trim(),
      buildClientSurfaceInstruction(resolveTurnClientSurface(turn)),
      thread.systemPrompt?.trim(),
      ...historyReferenceInstructions(thread),
      ...turnDynamicContext.instructions
    ].filter((value, index, all): value is string =>
      Boolean(value) && all.indexOf(value) === index
    )
    const limits = normalizeTurnLimits(this.deps.turnLimits)
    const binaryPath = this.deps.binaryPath?.trim() || process.env.KUN_ANTIGRAVITY_BINARY?.trim() || 'agy'
    const requestedProviderId = turn.providerId?.trim()
    const explicitProviderId =
      requestedProviderId ||
      providerId?.trim() ||
      thread.providerId?.trim()
    const fallbackProviderId = explicitProviderId || 'antigravity-cli'
    const requestedAccountId = turn.accountId?.trim() || (
      !requestedProviderId || requestedProviderId === thread.providerId?.trim()
        ? thread.accountId?.trim()
        : undefined
    )
    let selection: ReturnType<typeof resolveAntigravityPrintModel>
    try {
      selection = resolveAntigravityPrintModel(
        turn.actingModelRoute?.model ||
        turn.model ||
        thread.model ||
        this.deps.defaultModel,
        turn.reasoningEffort
      )
    } catch (error) {
      await this.deps.turns.finishTurn({
        threadId,
        turnId,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error)
      })
      return 'failed'
    }
    const { model, effort } = selection
    const actingModelRoute: ActingTurnModelRoute = turn.actingModelRoute ?? {
      model,
      providerId: fallbackProviderId,
      ...(requestedAccountId ? { accountId: requestedAccountId } : {})
    }
    const resolvedProviderId = actingModelRoute.providerId ?? fallbackProviderId
    const resolvedAccountId = actingModelRoute.accountId ?? requestedAccountId
    const snapshotProviderId =
      resolvedProviderId === 'antigravity-cli' ? explicitProviderId : resolvedProviderId
    if (!turn.actingModelRoute) {
      await this.deps.turns.updateTurnMetadata(threadId, turnId, { actingModelRoute })
    }
    const approvalPolicy = this.deps.enforceReadOnly === true
      ? 'never'
      : turn.approvalPolicy ?? thread.approvalPolicy
    const sandboxMode = this.deps.enforceReadOnly === true
      ? 'read-only'
      : turn.sandboxMode ?? thread.sandboxMode
    const selectedProvider = this.deps.providerConfigs[resolvedProviderId]
    const provider = selectedProvider?.kind === 'antigravity-cli' ? selectedProvider : undefined
    const capabilities = antigravityCapabilities()
    const coordinator = this.deps.sessionCoordinator
    let preparation = coordinator
      ? await coordinator.prepare({
          threadId,
          route: {
            providerKind: 'antigravity-cli',
            providerId: resolvedProviderId,
            credentialIdentity: delegatedCredentialIdentity({
              providerId: resolvedProviderId,
              accountId: resolvedAccountId,
              credentialSourceId: provider?.credentialSourceId
            }),
            workspace: thread.workspace,
            model,
            modelScope: 'session',
            // Effort, plan mode, approval policy and sandbox are CLI flags
            // evaluated per process invocation; keep capabilityFingerprint
            // tied to boundary-affecting controls only (not effort) so model
            // switches that change reasoning effort keep the same conversation.
            capabilityFingerprint: delegatedCapabilityFingerprint({
              systemPrompt: this.deps.systemPrompt?.trim() || '',
              threadPersona: thread.systemPrompt?.trim() || '',
              planMode,
              approvalPolicy,
              sandboxMode,
              capabilities
            }),
            continuationMode: 'native'
          },
          priorItems: priorItemsForDelegatedTurn(items, turnId)
        })
      : undefined
    // Native history stays with the CLI; only switches/recovery need a brief.
    const resolveHandoffFor = (prep: typeof preparation) => resolveTurnHandoff({
      enabled: this.deps.deterministicHandoff !== false,
      preparation: prep,
      items,
      currentTurnId: turnId,
      ownerThreadId: threadId,
      workspacePath: thread.workspace,
      taskWorkspaces: this.deps.taskWorkspaces
    })
    const buildAttemptInputFor = async (
      prep: typeof preparation,
      handoff: ReturnType<typeof resolveHandoffFor>
    ): Promise<{ prompt: string; args: string[] }> => {
      const turnInput = await resolveAntigravityTurnInput({
        userItem,
        pendingUserMessages: prep?.pendingUserMessages,
        attachmentStore: this.deps.attachmentStore,
        threadId,
        workspace: thread.workspace
      })
      const promptText = composeSdkPromptText({
        ...(handoff
          ? { handoffBrief: handoff.brief.text }
          : {
              historyTranscript: prep?.resumed ? undefined : buildHistoryTranscript(
                items,
                turnId,
                DEFAULT_SDK_HISTORY_TRANSCRIPT_MAX_BYTES
              )
            }),
        userText: turnInput.userText,
        instructionBlocks: sessionInstructions(prep, instructionBlocks, false, turnDynamicContext.instructions)
      })
      return {
        prompt: promptText,
        args: buildAntigravityArgs({
          prompt: promptText,
          nativeSessionId: prep?.resumed ? prep.nativeSessionId : undefined,
          model,
          effort,
          timeoutMs: limits.maxWallTimeMs,
          planMode,
          approvalPolicy,
          sandboxMode,
          additionalDirectories: turnInput.additionalDirectories
        })
      }
    }
    const contextProfile = this.deps.contextProfile?.(model, snapshotProviderId ?? resolvedProviderId)
    let activePromptText = ''
    let activeSentInstructionsText = ''
    let activeCarriedOccupancy: { inputTokens: number; toolCount: number } | undefined
    let attemptWindowKnown = false
    const recordAttemptEvents = async (
      prep: typeof preparation,
      handoff: ReturnType<typeof resolveHandoffFor>,
      promptText: string
    ): Promise<void> => {
      await this.deps.events.record({
        kind: 'delegated_runtime',
        threadId,
        turnId,
        providerKind: 'antigravity-cli',
        providerId: resolvedProviderId,
        harnessId: 'antigravity',
        phase: prep?.resumed ? 'resumed' : 'rebased',
        ...(prep?.rebaseReason ? { reason: prep.rebaseReason } : {}),
        capabilities,
        capabilitiesV2: capabilitiesV2FromLegacy(capabilities, ANTIGRAVITY_CLI_CAPABILITIES)
      })
      await recordHandoffInjected(
        (event) => this.deps.events.record(event),
        { threadId, turnId, harnessId: 'antigravity' },
        handoff
      )
      if (contextProfile) {
        const sentInstructionsText = sessionInstructions(
          prep,
          instructionBlocks,
          false,
          turnDynamicContext.instructions
        ).join('\n')
        activePromptText = promptText
        activeSentInstructionsText = sentInstructionsText
        activeCarriedOccupancy = prep?.resumed
          ? await loadCarriedAntigravityOccupancy(this.deps.sessionStore, threadId)
          : undefined
        const initialSnapshot = buildAntigravityContextSnapshot({
          threadId,
          turnId,
          model,
          explicitProviderId: snapshotProviderId,
          contextProfile,
          resumed: Boolean(prep?.resumed),
          sentInstructionsText,
          promptText,
          ...(activeCarriedOccupancy
            ? {
                liveInputTokens: activeCarriedOccupancy.inputTokens,
                toolCount: activeCarriedOccupancy.toolCount
              }
            : {})
        })
        attemptWindowKnown = Boolean(initialSnapshot.contextWindowKnown)
        await this.deps.events.record(initialSnapshot)
      }
    }

    let turnHandoff = resolveHandoffFor(preparation)
    let { prompt, args } = await buildAttemptInputFor(preparation, turnHandoff)
    await recordAttemptEvents(preparation, turnHandoff, prompt)

    const createTurnStream = (): AntigravityTurnStream =>
      new AntigravityTurnStream(this.deps, threadId, turnId, {
        onInitModel: async (resolvedModel) => {
          if (!contextProfile || attemptWindowKnown) return
          const nextSnapshot = buildAntigravityContextSnapshot({
            threadId,
            turnId,
            model,
            resolvedModel,
            explicitProviderId: snapshotProviderId,
            contextProfile,
            resumed: Boolean(preparation?.resumed),
            sentInstructionsText: activeSentInstructionsText,
            promptText: activePromptText,
            ...(activeCarriedOccupancy
              ? {
                  liveInputTokens: activeCarriedOccupancy.inputTokens,
                  toolCount: activeCarriedOccupancy.toolCount
                }
              : {})
          })
          if (nextSnapshot.contextWindowKnown) {
            attemptWindowKnown = true
            await this.deps.events.record(nextSnapshot)
          }
        },
        onContextOccupancy: async ({ inputTokens, toolCount, resolvedModel }) => {
          if (!contextProfile) return
          await this.deps.events.record(buildAntigravityContextSnapshot({
            threadId,
            turnId,
            model,
            ...(resolvedModel ? { resolvedModel } : {}),
            explicitProviderId: snapshotProviderId,
            contextProfile,
            resumed: Boolean(preparation?.resumed),
            sentInstructionsText: '',
            promptText: '',
            liveInputTokens: inputTokens,
            toolCount
          }))
        }
      })

    let trace: AntigravityTrace | undefined
    let stream = createTurnStream()
    try {
      const credential = provider?.credentialSourceId
        ? await this.deps.resolveCredentialSource?.(provider.credentialSourceId)
        : provider?.apiKey ? { apiKey: provider.apiKey } : undefined
      let launchDenied = false
      const validateLaunch = async (): Promise<void> => {
        if (!this.deps.readiness) return
        try {
          await this.deps.readiness.validateTurn(threadId, turnId, signal)
        } catch (error) {
          launchDenied = true
          throw error
        }
      }
      let result: ReturnType<typeof parseAntigravityResult>
      for (;;) {
        launchDenied = false
        trace = await startAntigravityTrace(this.deps.debugSink, {
          threadId,
          turnId,
          provider: resolvedProviderId,
          model,
          prompt,
          redactedRequestValues: [
            ...goalContextTexts(items),
            ...turnDynamicContext.privateValues
          ],
          effort,
          planMode,
          approvalPolicy,
          sandboxMode,
          delegated: {
            providerKind: 'antigravity-cli',
            phase: preparation?.resumed ? 'resumed' : 'rebased',
            ...(preparation?.rebaseReason ? { reason: preparation.rebaseReason } : {}),
            contextManagement: 'sdk-managed',
            nativeHistory: preparation?.resumed ? 'unknown' : 'none',
            capabilities
          }
        })
        try {
          await validateLaunch()
          const output = await runAntigravityProcess({
            binaryPath,
            env: { ...this.deps.nativeNetworkEnv?.(), ...(credential?.apiKey ? { GEMINI_API_KEY: credential.apiKey } : {}) },
            args,
            cwd: thread.workspace,
            signal,
            validateLaunch,
            timeoutMs: limits.maxWallTimeMs,
            spawnFn: this.deps.spawnFn,
            onStdoutLine: stream.onLine
          })
          if (signal.aborted) {
            await finishAntigravityTrace(trace, {
              kind: 'error',
              error: new Error('Antigravity CLI turn was aborted')
            })
            trace = undefined
            await this.deps.turns.finishTurn({ threadId, turnId, status: 'aborted' })
            return 'aborted'
          }
          result = parseAntigravityResult(output, preparation?.resumed ? preparation.nativeSessionId : undefined)
          break
        } catch (error) {
          if (
            coordinator &&
            preparation?.resumed &&
            preparation.nativeSessionId &&
            !launchDenied &&
            !stream.hasStartedTurn &&
            !signal.aborted &&
            isMissingAntigravitySession(error, preparation.nativeSessionId)
          ) {
            await finishAntigravityTrace(trace, { kind: 'error', error })
            trace = undefined
            await stream.settle()
            preparation = await coordinator.rejectResume(preparation)
            turnHandoff = resolveHandoffFor(preparation)
            ;({ prompt, args } = await buildAttemptInputFor(preparation, turnHandoff))
            await recordAttemptEvents(preparation, turnHandoff, prompt)
            stream = createTurnStream()
            continue
          }
          throw error
        }
      }
      const { text, conversationId, usage } = result
      await finishAntigravityTrace(trace, { kind: 'completed', text })
      trace = undefined
      await stream.finish(text)
      const usageDraft = stream.usageDraft(usage, model, resolvedProviderId)
      if (usageDraft) await this.deps.events.record(usageDraft)
      const liveInputTokens = stream.contextOccupancyTokens(usage, Boolean(preparation?.resumed))
      if (
        contextProfile &&
        liveInputTokens !== undefined &&
        !stream.hasPublishedOccupancy(liveInputTokens, stream.toolStepCount)
      ) {
        await this.deps.events.record(buildAntigravityContextSnapshot({
          threadId,
          turnId,
          model,
          ...(stream.resolvedModel ? { resolvedModel: stream.resolvedModel } : {}),
          explicitProviderId: snapshotProviderId,
          contextProfile,
          resumed: Boolean(preparation?.resumed),
          sentInstructionsText: '',
          promptText: '',
          liveInputTokens,
          toolCount: stream.toolStepCount
        }))
      }
      const suspension = await this.deps.turns.suspendGraphLeadTurn?.({ threadId, turnId })
      const outcome: TurnRunOutcome =
        suspension === 'suspended' ||
        suspension === 'suspended_pending_supervision'
          ? suspension
          : 'completed'
      if (outcome === 'completed') {
        await this.deps.turns.finishTurn({ threadId, turnId, status: 'completed' })
      }
      if (preparation && coordinator) {
        try {
          await coordinator.commit({
            preparation,
            // Keep the checkpoint aligned with the goal projection supplied
            // to this CLI request, even if the goal changes before it exits.
            committedItems: filterGoalContextsForGoalKey(
              await this.deps.sessionStore.loadItems(threadId),
              goalContextKeyForHistory
            ),
            lastCommittedTurnId: turnId,
            nativeSessionId: conversationId,
            ...(turnHandoff ? { handoffBriefDigest: turnHandoff.brief.digest } : {})
          })
        } catch {
          // Portable history remains authoritative if the disposable binding
          // cannot be recorded.
        }
      }
      return outcome
    } catch (error) {
      await finishAntigravityTrace(trace, { kind: 'error', error })
      trace = undefined
      await stream.settle()
      if (signal.aborted) {
        await this.deps.turns.finishTurn({ threadId, turnId, status: 'aborted' })
        return 'aborted'
      }
      const message = error instanceof Error ? error.message : String(error)
      await this.deps.turns.finishTurn({
        threadId,
        turnId,
        status: 'failed',
        error: message,
        code: 'antigravity_cli_failed',
        severity: 'error'
      })
      return 'failed'
    }
  }

  private persistAssistantText(threadId: string, turnId: string, text: string): Promise<void> {
    return persistAntigravityText(this.deps, threadId, turnId, text)
  }
}

export function antigravityCapabilities(): DelegatedRuntimeCapabilities {
  return {
    nativeResume: true,
    structuredStreaming: false,
    kunTools: false,
    externalApproval: false,
    liveSteering: false,
    nativeContextTelemetry: false,
    fork: false
  }
}
