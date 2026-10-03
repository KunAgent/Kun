/**
 * Shared session-level contract for native harness transports
 * (docs/ade/impl/p6a §1.1). One pooled `HarnessAgent` owns a spawned process;
 * `ensureSession` binds/creates a native session; each `HarnessSession` runs
 * Kun turns and streams protocol content through `HarnessTurnSink`, which is
 * the adapter's only egress into the timeline and gates.
 *
 * The session layer never sees Kun threadIds for its own bookkeeping — binding
 * identity lives in `SessionTurnRuntime` via `DelegatedSessionCoordinator`.
 */
import type { RuntimeEventDraft } from '../services/runtime-event-recorder.js'
import type { TurnItem, UserFileReference } from '../contracts/items.js'
import type { TurnRunOutcome } from '../loop/turn-execution-types.js'
import type { HarnessDefinition } from '../contracts/harness.js'
import type { DelegatedSessionPreparation } from '../runtime/delegated-session-binding.js'
import type { SpawnOwnedProcessOptions } from '../process/owned-process.js'
import type { ChildProcess } from 'node:child_process'

/** Error taxonomy shared by session transports; mirrors AcpError codes. */
export class HarnessTransportError extends Error {
  constructor(
    readonly code:
      | 'request_timeout'
      | 'request_aborted'
      | 'connection_closed'
      | 'harness_protocol_error'
      | 'harness_crashed'
      | 'harness_not_ready'
      | 'policy_denied'
      | 'agent_error',
    message: string,
    readonly detail?: unknown
  ) {
    super(message)
    this.name = 'HarnessTransportError'
  }
}

export type HarnessSpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOwnedProcessOptions
) => Promise<ChildProcess>

/** Facts captured at protocol handshake; surfaced in delegated_runtime events. */
export type HarnessAgentInfo = {
  protocolName: string
  protocolVersion?: string
  agentVersion?: string
  /** Raw capability payload for capability derivation + fingerprinting. */
  capabilities?: unknown
  /** Agent declared it needs interactive auth before sessions. */
  requiresAuthentication?: boolean
}

export type HarnessAgentConnectInput = {
  definition: HarnessDefinition
  /** Resolved launch command (binaryPath override applied by the runtime). */
  command: string
  args: readonly string[]
  env: Record<string, string>
  secretEnv: Record<string, string>
  credentialEnv: Record<string, string>
  stripEnv: readonly string[]
  cwd: string
  signal: AbortSignal
  /** Revalidate after asynchronous launch preparation, immediately before execution. */
  validateLaunch?: () => Promise<unknown>
  spawn?: HarnessSpawnFn
}

export type HarnessSessionStartInput = {
  threadId: string
  turnId: string
  workspacePath: string
  harnessId: string
  model?: string
  reasoningEffort?: string
  /** Resolved harness permission-level id (definition.permissionModes). */
  permissionModeId?: string
  /** Prior items snapshot for coordinator.prepare. */
  items: readonly TurnItem[]
  preparation: DelegatedSessionPreparation
  signal: AbortSignal
}

/** Prompt payload assembled by the shared context builder. */
export type HarnessTurnInput = {
  instructionBlocks: readonly string[]
  userText: string
  /** Inline image payloads (capability-gated upstream). */
  images: readonly { mediaType: string; base64: string }[]
  /** Attachment paths appended when the protocol cannot inline them. */
  attachmentPaths: readonly string[]
  fileReferences: readonly UserFileReference[]
  workspacePath: string
  model?: string
  reasoningEffort?: string
  /** Deterministic handoff brief when the native session is fresh. */
  handoffBrief?: string
  /** Portable transcript when no handoff brief applies. */
  historyTranscript?: string
  clientSurfaceInstruction?: string
  /** Kun permission ceiling for approvalPolicy/sandbox mapping. */
  kunPermissionMode: string
  approvalPolicy: string
  sandboxMode?: string
}

export type HarnessTurnResult = {
  status: 'completed' | 'failed' | 'cancelled' | 'refused'
  /** finishTurn code when status !== 'completed'. */
  code?: string
  message?: string
}

/**
 * Adapter egress. `emit` pushes timeline drafts (deltas accumulate inside the
 * emitter); `requestApproval`/`requestUserInput` route through Kun's gates and
 * must never be bypassed by adapter-side auto-answers beyond the protocol's
 * own decline responses.
 */
export type HarnessTurnSink = {
  emit(drafts: readonly RuntimeEventDraft[]): Promise<void>
  requestApproval(request: HarnessApprovalRequest): Promise<HarnessApprovalResponse>
  requestUserInput(request: HarnessUserInputRequest): Promise<HarnessUserInputResponse>
  /** Non-fatal protocol/transport note for diagnostics. */
  diagnostic(summary: string): void
}

export type HarnessApprovalRequest = {
  kind: 'command' | 'file-change' | 'permissions' | 'tool' | 'other'
  summary: string
  detail?: Record<string, unknown>
  /** True when a wrong answer could mutate outside the workspace roots. */
  risky?: boolean
}
export type HarnessApprovalResponse =
  | { decision: 'accept' }
  | { decision: 'accept-session' }
  | { decision: 'decline' }
  | { decision: 'cancel' }

export type HarnessUserInputRequest = {
  kind: 'select' | 'confirm' | 'input' | 'editor' | 'other'
  prompt: string
  options?: readonly { id: string; label: string }[]
  /**
   * Fully-shaped native questions (multi-question prompts like codex
   * `item/tool/requestUserInput`); when present the sink asks them verbatim
   * and answers come back keyed by `id`.
   */
  questions?: readonly {
    header?: string
    id: string
    question: string
    options?: readonly { label: string; description?: string }[]
  }[]
  /** Free-form fields for item/tool/requestUserInput-shaped requests. */
  fields?: readonly Record<string, unknown>[]
}
export type HarnessUserInputResponse = {
  answers?: Record<string, unknown>
  cancelled?: boolean
}

export interface HarnessSession {
  readonly providerSessionId: string
  readonly preparation: DelegatedSessionPreparation
  /** Fresh native session (no replayed history) → handoff/transcript applies. */
  readonly replayedHistory: boolean
  runTurn(
    input: HarnessTurnInput,
    sink: HarnessTurnSink,
    signal: AbortSignal
  ): Promise<HarnessTurnResult>
  /** Interrupt the in-flight turn; resolves when the protocol acked. */
  interrupt(): Promise<void>
  /** Detach per-turn resources; the pooled connection stays alive. */
  detach(): void
}

export interface HarnessAgent {
  readonly info: HarnessAgentInfo
  /** Start a new native session. */
  startSession(input: HarnessSessionStartInput): Promise<HarnessSession>
  /** Resume a parked/live native session; throw to trigger portable rebase. */
  resumeSession?(input: HarnessSessionStartInput): Promise<HarnessSession>
  /** Capability surface for coordinator fingerprints (native resume etc). */
  sessionCapabilities(): { continuation: 'native' | 'portable'; fingerprint: unknown }
  listModels?(): Promise<string[]>
  close(): Promise<void>
  /** Wire-exit hook used by the pool; fires once on unexpected death. */
  onExit(listener: (exit: { code: number | null; signal: string | null }) => void): void
  readonly closed: boolean
  /** Thread ids bound to sessions on this process (pool dormancy). */
  sessionThreadIds(): readonly string[]
}

/** Per-(harnessId,credentialIdentity) factory used by the shared pool. */
export type HarnessAgentFactory = {
  connect(input: HarnessAgentConnectInput): Promise<HarnessAgent>
}

export type { TurnRunOutcome }
