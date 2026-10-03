import type {
  AgentOptions,
  LocalAgentStore,
  Run,
  RunResult,
  SDKAgent,
  SDKCustomTool,
  SDKImage,
  SDKMessage,
  SDKUserMessage,
  TokenUsage
} from '@cursor/sdk'
import type { AttachmentStore } from '../../attachments/attachment-store.js'
import type { ServeProviderConfig } from '../../config/kun-config.js'
import {
  MAX_TURN_ATTACHMENT_BYTES,
  MAX_TURN_ATTACHMENT_IDS
} from '../../contracts/attachments.js'
import type {
  ModelRequestTraceDelegated,
  ModelRequestTraceRecord
} from '../../contracts/model-request-trace.js'
import { goalContextTexts, type TurnItem } from '../../contracts/items.js'
import type { ActingTurnModelRoute, Turn } from '../../contracts/turns.js'
import type { SetThreadTodosRequest, ThreadRecord } from '../../contracts/threads.js'
import type { UsageSnapshot } from '../../contracts/usage.js'
import { userMessageTextWithComposerContexts } from '../../domain/composer-context.js'
import { resolveTurnClientSurface } from '../../loop/turn-context-resolver.js'
import { normalizeTurnLimits, type TurnLimitsConfig } from '../../loop/turn-limits.js'
import type { TurnRunOutcome } from '../../loop/turn-execution-types.js'
import type { SessionStore } from '../../ports/session-store.js'
import type { ThreadStore } from '../../ports/thread-store.js'
import { buildClientSurfaceInstruction } from '../../prompt/kun-prompt-context.js'
import {
  startLlmDebugRoundIfEnabled,
  type LlmDebugRound,
  type LlmDebugSink
} from '../../services/llm-debug-recorder.js'
import type { RuntimeEventDraft, RuntimeEventRecorder } from '../../services/runtime-event-recorder.js'
import type { TurnService } from '../../services/turn-service.js'
import {
  buildHistoryTranscript,
  composeSdkPromptText,
  DEFAULT_SDK_HISTORY_TRANSCRIPT_MAX_BYTES
} from '../agent-sdk/sdk-context-assembler.js'
import {
  filterGoalContextsForGoalKey,
  goalContextKey
} from '../../loop/continuation-instructions.js'
import type {
  DelegatedRuntimeCapabilities,
  DelegatedTurnRuntime
} from '../delegated-turn-runtime.js'
import {
  delegatedCapabilityFingerprint,
  delegatedCredentialIdentity,
  priorItemsForDelegatedTurn,
  type DelegatedSessionCoordinator,
  type DelegatedSessionPreparation
} from '../delegated-session-binding.js'
import {
  delegatedGraphCompletionCheck,
  delegatedGraphRecoveryInstruction,
  parkDelegatedGraphTurnAfterRecovery,
  type DelegatedGraphPhase
} from '../delegated-graph-turn-policy.js'
import {
  CursorSdkEventMapper,
  CursorSdkResourceLimitError,
  cursorTodosRequestFromMessage,
  mapCursorUsage,
  type CursorSdkStreamLimits
} from './cursor-sdk-event-mapper.js'
import type { CursorBridgeTool } from './cursor-sdk-tool-bridge.js'

const DEFAULT_CURSOR_MODEL = 'auto'
const MAX_CURSOR_ERROR_LENGTH = 2_000
export const CURSOR_AUTH_RECOVERY_PROMPT = [
  'Continue the interrupted request from the current persisted agent state.',
  'Do not repeat tool calls that already completed or duplicate their side effects.',
  'Use the existing results and finish the pending response.'
].join('\n')

export interface CursorSdkApi {
  Agent: {
    create(options: AgentOptions): Promise<SDKAgent>
    resume(agentId: string, options?: Partial<AgentOptions>): Promise<SDKAgent>
  }
  JsonlLocalAgentStore?: new (rootDir: string) => LocalAgentStore
}

export interface CursorSdkRuntimeDeps {
  readiness?: Pick<import('../../harness/harness-readiness.js').HarnessReadinessService, 'validateTurn'>
  providerConfigs: Record<string, ServeProviderConfig>
  providerIds: ReadonlySet<string>
  defaultIsCursor: boolean
  defaultApiKey?: string
  defaultCredentialSourceId?: string
  /** Re-read managed credentials for every turn; never fall back to cached keys. */
  resolveCredentialSource?: (sourceId: string) => Promise<{ apiKey: string } | null>
  defaultModel?: string
  systemPrompt?: string
  threadStore: ThreadStore
  sessionStore: SessionStore
  turns: TurnService
  events: RuntimeEventRecorder
  ids: { next(prefix: string): string }
  debugSink?: LlmDebugSink
  attachmentStore?: AttachmentStore
  turnLimits?: TurnLimitsConfig
  streamLimits?: Partial<CursorSdkStreamLimits>
  loadSdk?: () => Promise<CursorSdkApi>
  /** Mirrors successful Cursor-owned updateTodos calls into Kun thread state. */
  setThreadTodos?: (threadId: string, request: SetThreadTodosRequest) => Promise<unknown>
  /** Delegated read-only children must deny mutation regardless of parent defaults. */
  enforceReadOnly?: boolean
  sessionCoordinator?: DelegatedSessionCoordinator
  /** Host task-workspace index for handoff work-state merging (docs/ade/07). */
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
   * transcript instead of the deterministic brief (docs/ade/08 §4).
   */
  deterministicHandoff?: boolean
  contextProfile?: (model: string) => {
    contextWindowTokens: number
    softThresholdTokens: number
    hardThresholdTokens: number
  }
  loadKunTurnContext?: (input: {
    threadId: string
    turnId: string
    userText: string
    actingModelRoute: ActingTurnModelRoute
    signal: AbortSignal
  }) => Promise<CursorKunTurnContext>
}

export type CursorKunTurnContext = {
  instructionBlocks: string[]
  activeSkillIds: string[]
  tools: CursorBridgeTool[]
  customTools: Record<string, SDKCustomTool>
  graphPhase?: DelegatedGraphPhase
  graphPlanWasCommitted?: () => boolean
  graphPlanCanRetry?: () => boolean
}

export class CursorTurnInterruptedError extends Error {
  constructor(readonly reason: 'aborted' | 'timeout') {
    super(reason === 'timeout' ? 'Cursor SDK turn exceeded its wall-time limit' : 'Cursor SDK turn was aborted')
    this.name = 'CursorTurnInterruptedError'
  }
}

export function normalizeCursorModel(model: string | undefined): string {
  const normalized = model?.trim()
  return normalized || DEFAULT_CURSOR_MODEL
}

export function cursorAgentExecutionOptions(input: {
  workspace: string
  apiKey: string
  model: string
  name: string
  planMode: boolean
  approvalPolicy: string
  sandboxMode: string
  enforceReadOnly?: boolean
}): AgentOptions {
  const mutationAllowed =
    input.enforceReadOnly !== true
    && input.planMode !== true
    && input.approvalPolicy === 'auto'
    && input.sandboxMode !== 'read-only'
    && input.sandboxMode !== 'external-sandbox'
  return {
    apiKey: input.apiKey,
    model: { id: normalizeCursorModel(input.model) },
    name: input.name,
    mode: mutationAllowed ? 'agent' : 'plan',
    local: {
      cwd: input.workspace,
      // Never inherit ~/.cursor, workspace .cursor rules, team settings, or
      // plugins. Kun's canonical prompt and policy are the sole ambient input.
      settingSources: [],
      autoReview: false,
      // Keep the SDK's own transport and stalled-run recovery enabled even if
      // a future SDK release changes the headless default.
      enableAgentRetries: true,
      sandboxOptions: {
        enabled:
          input.planMode === true ||
          input.enforceReadOnly === true ||
          input.sandboxMode !== 'danger-full-access'
      }
    }
  }
}

export function sanitizeCursorSdkError(error: unknown, apiKey: string): string {
  const raw = error instanceof Error ? error.message : String(error)
  const withoutSecret = apiKey ? raw.split(apiKey).join('[REDACTED]') : raw
  return withoutSecret.slice(0, MAX_CURSOR_ERROR_LENGTH)
}

export type CursorSdkImageSummary = {
  mimeType: string
  byteSize: number
  width?: number
  height?: number
}

export async function resolveCursorSdkImages(input: {
  attachmentStore?: AttachmentStore
  attachmentIds: readonly string[]
  threadId: string
  workspace: string
}): Promise<{ images: SDKImage[]; summaries: CursorSdkImageSummary[] }> {
  if (!input.attachmentStore || input.attachmentIds.length === 0) {
    return { images: [], summaries: [] }
  }
  const images: SDKImage[] = []
  const summaries: CursorSdkImageSummary[] = []
  let totalBytes = 0
  for (const id of input.attachmentIds.slice(0, MAX_TURN_ATTACHMENT_IDS)) {
    try {
      const attachment = await input.attachmentStore.resolveContent(id, {
        threadId: input.threadId,
        workspace: input.workspace
      })
      if (
        attachment.kind !== 'image'
        || !attachment.mimeType.startsWith('image/')
        || attachment.data.byteLength <= 0
        || totalBytes + attachment.data.byteLength > MAX_TURN_ATTACHMENT_BYTES
      ) {
        continue
      }
      totalBytes += attachment.data.byteLength
      const dimension = positiveDimension(attachment.width, attachment.height)
      images.push({
        data: attachment.data.toString('base64'),
        mimeType: attachment.mimeType,
        ...(dimension ? { dimension } : {})
      })
      summaries.push({
        mimeType: attachment.mimeType,
        byteSize: attachment.data.byteLength,
        ...(dimension ?? {})
      })
    } catch {
      // Missing or unauthorized attachments are excluded from the delegated request.
    }
  }
  return { images, summaries }
}

function positiveDimension(
  width: number | undefined,
  height: number | undefined
): { width: number; height: number } | undefined {
  return Number.isInteger(width) && Number.isInteger(height) && width! > 0 && height! > 0
    ? { width: width!, height: height! }
    : undefined
}

export function cursorSdkErrorCode(error: unknown): string {
  if (error instanceof CursorSdkResourceLimitError) return error.code
  const record = error && typeof error === 'object'
    ? error as { name?: unknown; message?: unknown; code?: unknown }
    : {}
  const signature = `${record.name ?? ''} ${record.code ?? ''} ${record.message ?? ''}`.toLowerCase()
  if (/authentication|unauthenticated|invalid api key/.test(signature)) {
    return 'cursor_sdk_authentication_failed'
  }
  if (/rate.?limit|resource.?exhausted|quota|usage.?limit/.test(signature)) {
    return 'cursor_sdk_rate_limited'
  }
  if (/network|unavailable|connect|timeout/.test(signature)) {
    return 'cursor_sdk_network_failed'
  }
  if (/configuration|invalid.?argument/.test(signature)) {
    return 'cursor_sdk_configuration_failed'
  }
  if (/err_module_not_found|cannot find package|cannot find module/.test(signature)) {
    return 'cursor_sdk_unavailable'
  }
  return 'cursor_sdk_failed'
}

export type CursorTurnCredentials = {
  actingModelRoute: ActingTurnModelRoute
  resolvedProviderId: string
  resolvedAccountId?: string
  credentialSourceId?: string
  apiKey: string
}

/**
 * Resolve the turn's provider route + credential. Returns 'failed' after
 * finishing the turn when no API key can be produced.
 */
export async function resolveCursorTurnCredentials(input: {
  deps: Pick<
    CursorSdkRuntimeDeps,
    'providerConfigs' | 'defaultCredentialSourceId' | 'defaultApiKey' |
    'resolveCredentialSource' | 'defaultModel' | 'turns'
  >
  thread: ThreadRecord
  turn: Turn
  providerId: string | undefined
  threadId: string
  turnId: string
}): Promise<CursorTurnCredentials | 'failed'> {
  const { deps, thread, turn, providerId, threadId, turnId } = input
  const requestedProviderId = turn.providerId?.trim()
  const fallbackProviderId =
    requestedProviderId ||
    providerId?.trim() ||
    thread.providerId?.trim() ||
    'cursor-subscription'
  const requestedAccountId = turn.accountId?.trim() || (
    !requestedProviderId || requestedProviderId === thread.providerId?.trim()
      ? thread.accountId?.trim()
      : undefined
  )
  const actingModelRoute: ActingTurnModelRoute = turn.actingModelRoute ?? {
    model: normalizeCursorModel(turn.model || thread.model || deps.defaultModel),
    providerId: fallbackProviderId,
    ...(requestedAccountId ? { accountId: requestedAccountId } : {})
  }
  const resolvedProviderId = actingModelRoute.providerId ?? fallbackProviderId
  const resolvedAccountId =
    actingModelRoute.accountId ??
    requestedAccountId
  const provider = deps.providerConfigs[resolvedProviderId]
  const credentialSourceId = provider?.credentialSourceId ?? (
    resolvedProviderId === 'cursor-subscription'
      ? deps.defaultCredentialSourceId
      : undefined
  )
  const resolvedCredential = credentialSourceId
    ? await deps.resolveCredentialSource?.(credentialSourceId).catch(() => null)
    : undefined
  const apiKey = credentialSourceId
    ? resolvedCredential?.apiKey?.trim() ?? ''
    : provider?.apiKey?.trim() ||
      (resolvedProviderId === 'cursor-subscription'
        ? deps.defaultApiKey?.trim() || ''
        : '')
  if (!apiKey) {
    await deps.turns.finishTurn({
      threadId,
      turnId,
      status: 'failed',
      error: 'Cursor subscription API key is not configured',
      code: 'cursor_sdk_missing_credential',
      severity: 'error'
    })
    return 'failed'
  }
  return {
    actingModelRoute,
    resolvedProviderId,
    resolvedAccountId,
    credentialSourceId,
    apiKey
  }
}
