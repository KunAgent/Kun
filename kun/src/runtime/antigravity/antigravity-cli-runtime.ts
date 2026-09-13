import { spawn, type ChildProcess } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import type { ServeProviderConfig } from '../../config/kun-config.js'
import type {
  ActingTurnModelRoute,
  TurnReasoningEffort
} from '../../contracts/turns.js'
import { goalContextTexts } from '../../contracts/items.js'
import { userMessageTextWithComposerContexts } from '../../domain/composer-context.js'
import { makeAssistantTextItem } from '../../domain/item.js'
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
import type {
  ModelRequestTraceDelegated,
  ModelRequestTraceRecord
} from '../../contracts/model-request-trace.js'
import {
  startLlmDebugRoundIfEnabled,
  type LlmDebugRound,
  type LlmDebugSink
} from '../../services/llm-debug-recorder.js'
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
import {
  delegatedCapabilityFingerprint,
  delegatedCredentialIdentity,
  priorItemsForDelegatedTurn,
  type DelegatedSessionCoordinator
} from '../delegated-session-binding.js'
import { shellSpawnEnv } from '../../adapters/tool/builtin-tool-utils.js'
import { parkDelegatedGraphTurnAfterRecovery } from '../delegated-graph-turn-policy.js'

const MAX_STDOUT_BYTES = 8 * 1024 * 1024
const MAX_STDERR_BYTES = 256 * 1024
const ANTIGRAVITY_MODEL_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/i
const ANTIGRAVITY_MODEL_ID_MAX_LENGTH = 128

export interface AntigravityCliRuntimeDeps {
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
  debugSink?: LlmDebugSink
  turnLimits?: TurnLimitsConfig
  spawnFn?: typeof spawn
  /** Delegated read-only children must deny mutation regardless of parent defaults. */
  enforceReadOnly?: boolean
  sessionCoordinator?: DelegatedSessionCoordinator
  contextProfile?: (model: string) => {
    contextWindowTokens: number
    softThresholdTokens: number
    hardThresholdTokens: number
  }
}

export function normalizeAntigravityModel(model: string | undefined): string {
  const normalized = model?.trim().replace(/^models\//, '').replace(/-(?:low|medium|high)$/i, '')
  if (
    !normalized
    || normalized.length > ANTIGRAVITY_MODEL_ID_MAX_LENGTH
    || !ANTIGRAVITY_MODEL_ID_PATTERN.test(normalized)
  ) {
    throw new Error(`Invalid Antigravity model id: ${model?.trim() || '(empty)'}`)
  }
  return normalized
}

export function normalizeAntigravityEffort(
  effort: TurnReasoningEffort | undefined
): 'low' | 'medium' | 'high' {
  if (effort === 'low') return 'low'
  if (effort === 'high' || effort === 'max') return 'high'
  return 'medium'
}

export function buildAntigravityArgs(input: {
  prompt: string
  model?: string
  effort?: TurnReasoningEffort
  timeoutMs: number
  planMode: boolean
  approvalPolicy: string
  sandboxMode: string
}): string[] {
  const prompt = input.prompt.startsWith('-') ? `Current request:\n${input.prompt}` : input.prompt
  const args = [
    '--print',
    prompt,
    '--model', normalizeAntigravityModel(input.model),
    '--effort', normalizeAntigravityEffort(input.effort),
    '--print-timeout', `${Math.max(1, Math.ceil(input.timeoutMs / 1000))}s`
  ]
  const denyMutation =
    input.planMode ||
    input.approvalPolicy !== 'auto' ||
    input.sandboxMode === 'read-only' ||
    input.sandboxMode === 'external-sandbox'
  if (denyMutation) {
    args.push('--mode', 'plan', '--sandbox')
  } else if (input.approvalPolicy === 'auto') {
    args.push('--dangerously-skip-permissions')
    if (input.sandboxMode !== 'danger-full-access') args.push('--sandbox')
  } else if (input.sandboxMode !== 'danger-full-access') {
    // Headless Antigravity cannot surface Kun's interactive approval gate. Preserve the
    // requested sandbox and let the official CLI soft-deny interactive actions.
    args.push('--sandbox')
  }
  return args
}

export class AntigravityCliRuntime implements DelegatedTurnRuntime {
  constructor(private readonly deps: AntigravityCliRuntimeDeps) {}

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
    const prompt = composeSdkPromptText({
      historyTranscript: buildHistoryTranscript(
        items,
        turnId,
        DEFAULT_SDK_HISTORY_TRANSCRIPT_MAX_BYTES
      ),
      userText: userMessageTextWithComposerContexts(userItem),
      instructionBlocks
    })
    const limits = normalizeTurnLimits(this.deps.turnLimits)
    const binaryPath = this.deps.binaryPath?.trim() || process.env.KUN_ANTIGRAVITY_BINARY?.trim() || 'agy'
    const requestedProviderId = turn.providerId?.trim()
    const fallbackProviderId =
      requestedProviderId ||
      providerId?.trim() ||
      thread.providerId?.trim() ||
      'antigravity-cli'
    const requestedAccountId = turn.accountId?.trim() || (
      !requestedProviderId || requestedProviderId === thread.providerId?.trim()
        ? thread.accountId?.trim()
        : undefined
    )
    let model: string
    try {
      model = normalizeAntigravityModel(
        turn.actingModelRoute?.model ||
        turn.model ||
        thread.model ||
        this.deps.defaultModel
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
    const actingModelRoute: ActingTurnModelRoute = turn.actingModelRoute ?? {
      model,
      providerId: fallbackProviderId,
      ...(requestedAccountId ? { accountId: requestedAccountId } : {})
    }
    const resolvedProviderId = actingModelRoute.providerId ?? fallbackProviderId
    const resolvedAccountId = actingModelRoute.accountId ?? requestedAccountId
    if (!turn.actingModelRoute) {
      await this.deps.turns.updateTurnMetadata(threadId, turnId, { actingModelRoute })
    }
    const effort = normalizeAntigravityEffort(turn.reasoningEffort)
    const approvalPolicy = this.deps.enforceReadOnly === true
      ? 'never'
      : turn.approvalPolicy ?? thread.approvalPolicy
    const sandboxMode = this.deps.enforceReadOnly === true
      ? 'read-only'
      : turn.sandboxMode ?? thread.sandboxMode
    const args = buildAntigravityArgs({
      prompt,
      model,
      effort,
      timeoutMs: limits.maxWallTimeMs,
      planMode,
      approvalPolicy,
      sandboxMode
    })
    const provider = this.deps.providerConfigs[resolvedProviderId]
    const capabilities = antigravityCapabilities()
    const preparation = this.deps.sessionCoordinator
      ? await this.deps.sessionCoordinator.prepare({
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
            capabilityFingerprint: delegatedCapabilityFingerprint({
              systemPrompt: this.deps.systemPrompt?.trim() || '',
              threadPersona: thread.systemPrompt?.trim() || '',
              effort,
              planMode,
              approvalPolicy,
              sandboxMode,
              capabilities
            }),
            // The supported non-interactive CLI output does not provide a
            // validated conversation id. Never use process-global --continue.
            continuationMode: 'portable'
          },
          priorItems: priorItemsForDelegatedTurn(items, turnId)
        })
      : undefined
    await this.deps.events.record({
      kind: 'delegated_runtime',
      threadId,
      turnId,
      providerKind: 'antigravity-cli',
      providerId: resolvedProviderId,
      phase: 'portable',
      ...(preparation?.rebaseReason ? { reason: preparation.rebaseReason } : {}),
      capabilities
    })
    const contextProfile = this.deps.contextProfile?.(model)
    if (contextProfile) {
      const system = estimateAntigravityTokens(instructionBlocks.join('\n'))
      const messages = estimateAntigravityTokens(prompt) - system
      await this.deps.events.record({
        kind: 'context_snapshot',
        threadId,
        turnId,
        model,
        providerId: resolvedProviderId,
        stepIndex: 0,
        ...contextProfile,
        estimatedInputTokens: system + Math.max(0, messages),
        breakdown: {
          tools: 0,
          system,
          skills: 0,
          messages: Math.max(0, messages),
          other: 0
        },
        toolCount: 0,
        activeSkillIds: [],
        contextManagement: 'sdk-managed',
        nativeHistory: 'none'
      })
    }
    let trace = await startAntigravityTrace(this.deps.debugSink, {
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
        phase: 'portable',
        ...(preparation?.rebaseReason ? { reason: preparation.rebaseReason } : {}),
        contextManagement: 'sdk-managed',
        nativeHistory: 'none',
        capabilities
      }
    })

    try {
      const output = await runAntigravityProcess({
        binaryPath,
        args,
        cwd: thread.workspace,
        signal,
        timeoutMs: limits.maxWallTimeMs,
        spawnFn: this.deps.spawnFn
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
      const text = output.trim()
      if (!text) throw new Error('Antigravity CLI returned an empty response')
      await finishAntigravityTrace(trace, { kind: 'completed', text })
      trace = undefined
      await this.persistAssistantText(threadId, turnId, text)
      const suspension = await this.deps.turns.suspendGraphLeadTurn?.({ threadId, turnId })
      const outcome: TurnRunOutcome =
        suspension === 'suspended' ||
        suspension === 'suspended_pending_supervision'
          ? suspension
          : 'completed'
      if (outcome === 'completed') {
        await this.deps.turns.finishTurn({ threadId, turnId, status: 'completed' })
      }
      if (preparation && this.deps.sessionCoordinator) {
        try {
          await this.deps.sessionCoordinator.commit({
            preparation,
            // Keep the checkpoint aligned with the goal projection supplied
            // to this CLI request, even if the goal changes before it exits.
            committedItems: filterGoalContextsForGoalKey(
              await this.deps.sessionStore.loadItems(threadId),
              goalContextKeyForHistory
            ),
            lastCommittedTurnId: turnId
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

  private async persistAssistantText(
    threadId: string,
    turnId: string,
    text: string
  ): Promise<void> {
    const itemId = this.deps.ids.next('item_assistant')
    const createdAt = new Date().toISOString()
    const runningItem = makeAssistantTextItem({
      id: itemId,
      threadId,
      turnId,
      text,
      status: 'running',
      createdAt
    })
    // `agy --print` returns one complete fragment. Persist that cumulative
    // canonical snapshot before exposing the fragment at UTF-16 offset zero,
    // then publish the final authoritative item as before.
    await this.deps.turns.applyAssistantDelta(threadId, runningItem, text, 0)
    await this.deps.turns.applyItem(
      threadId,
      makeAssistantTextItem({
        id: itemId,
        threadId,
        turnId,
        text,
        status: 'completed',
        createdAt
      })
    )
  }
}

function estimateAntigravityTokens(text: string): number {
  return text ? Math.ceil(Buffer.byteLength(text, 'utf8') / 4) : 0
}

export function antigravityCapabilities(): DelegatedRuntimeCapabilities {
  return {
    nativeResume: false,
    structuredStreaming: false,
    kunTools: false,
    externalApproval: false,
    liveSteering: false,
    nativeContextTelemetry: false,
    fork: false
  }
}

function runAntigravityProcess(input: {
  binaryPath: string
  args: string[]
  cwd: string
  signal: AbortSignal
  timeoutMs: number
  spawnFn?: typeof spawn
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const spawnFn = input.spawnFn ?? spawn
    let child: ChildProcess
    try {
      child = spawnFn(input.binaryPath, input.args, {
        cwd: input.cwd,
        // The Antigravity CLI is model-controlled. Never inherit Kun/Main
        // credentials (including the browser-use bridge bearer and signing
        // key); pass only the same small execution allow-list as shell tools.
        env: shellSpawnEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false
      })
    } catch (error) {
      reject(error)
      return
    }
    let stdout = ''
    let stderr = ''
    let stdoutBytes = 0
    const stdoutDecoder = new StringDecoder('utf8')
    const stderrDecoder = new StringDecoder('utf8')
    let settled = false
    let timedOut = false
    const terminate = (): void => {
      try {
        child.kill()
      } catch {
        // best effort
      }
    }
    const onAbort = (): void => terminate()
    const done = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      input.signal.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve(stdout)
    }
    const timer = setTimeout(() => {
      timedOut = true
      terminate()
    }, input.timeoutMs)
    if (input.signal.aborted) terminate()
    else input.signal.addEventListener('abort', onAbort, { once: true })
    child.stdout?.on('data', (chunk: Buffer | string) => {
      if (settled) return
      // Child-process streams may split one UTF-8 character across multiple
      // data events. Decode incrementally so Chinese and other multibyte text
      // survives those boundaries intact.
      stdoutBytes += Buffer.byteLength(chunk)
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        terminate()
        done(new Error('Antigravity CLI response exceeded the output limit'))
        return
      }
      stdout += stdoutDecoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      if (settled) return
      stderr = `${stderr}${stderrDecoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))}`
        .slice(-MAX_STDERR_BYTES)
    })
    child.on('error', (error) => done(error))
    child.on('exit', (code) => {
      if (settled) return
      stdout += stdoutDecoder.end()
      stderr = `${stderr}${stderrDecoder.end()}`.slice(-MAX_STDERR_BYTES)
      if (input.signal.aborted) {
        done(new Error('Antigravity CLI turn was aborted'))
      } else if (timedOut) {
        done(new Error(`Antigravity CLI turn exceeded ${input.timeoutMs}ms wall time`))
      } else if (code !== 0) {
        done(new Error(stderr.trim() || `Antigravity CLI exited with code ${code}`))
      } else {
        done()
      }
    })
  })
}

type AntigravityTrace = {
  sink: LlmDebugSink
  round: LlmDebugRound
  record: ModelRequestTraceRecord
}

async function startAntigravityTrace(
  sink: LlmDebugSink | undefined,
  input: {
    threadId: string
    turnId: string
    provider: string
    model: string
    prompt: string
    redactedRequestValues: readonly string[]
    effort: 'low' | 'medium' | 'high'
    planMode: boolean
    approvalPolicy: string
    sandboxMode: string
    delegated: ModelRequestTraceDelegated
  }
): Promise<AntigravityTrace | undefined> {
  if (!sink) return undefined
  let round: LlmDebugRound | undefined
  try {
    round = await startLlmDebugRoundIfEnabled(sink, {
      threadId: input.threadId,
      turnId: input.turnId,
      provider: input.provider,
      model: input.model,
      redactedRequestValues: input.redactedRequestValues
    })
    if (!round) return undefined
    const record = sink.beginCliInvocation(round, {
      endpointFormat: 'antigravity-cli',
      target: 'antigravity-cli://local/print',
      bodyText: JSON.stringify({
        model: input.model,
        input: input.prompt,
        effort: input.effort,
        mode: input.planMode ? 'plan' : 'agent',
        approvalPolicy: input.approvalPolicy,
        sandboxMode: input.sandboxMode
      }),
      delegated: input.delegated
    })
    return { sink, round, record }
  } catch {
    if (round) void sink.finish(round).catch(() => undefined)
    warnAntigravityTraceFailure()
    return undefined
  }
}

async function finishAntigravityTrace(
  trace: AntigravityTrace | undefined,
  result: { kind: 'completed'; text: string } | { kind: 'error'; error: unknown }
): Promise<void> {
  if (!trace) return
  try {
    if (result.kind === 'completed') {
      trace.sink.captureChunk(trace.round, {
        kind: 'assistant_text_delta',
        text: result.text
      })
      trace.sink.captureChunk(trace.round, { kind: 'completed', stopReason: 'stop' })
    } else {
      trace.sink.captureChunk(trace.round, {
        kind: 'error',
        message: result.error instanceof Error ? result.error.message : String(result.error)
      })
      trace.sink.captureTransportError(trace.record, result.error)
    }
    await trace.sink.finish(trace.round)
  } catch {
    warnAntigravityTraceFailure()
  }
}

let antigravityTraceFailureWarned = false

function warnAntigravityTraceFailure(): void {
  if (antigravityTraceFailureWarned) return
  antigravityTraceFailureWarned = true
  console.warn(
    '[kun:antigravity] model request observability capture failed; the CLI turn continues unchanged'
  )
}
