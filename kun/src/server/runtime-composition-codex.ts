/**
 * P6-07: `SessionTurnRuntimeDeps` assembly for the native `codex app-server`
 * transport. Kept out of runtime-composition-agent.ts for the 700-line gate;
 * every field mirrors the ACP dep surface minus ACP-only mediation pieces.
 */
import type { HarnessRuntimeComposition } from '../harness/harness-runtime.js'
import { CODEX_APP_SERVER_CAPABILITIES } from '../harness/builtin-harnesses.js'
import {
  CODEX_APP_SERVER_LEGACY_CAPABILITIES,
  makeCodexAgentFactory
} from '../runtime/codex/codex-agent.js'
import type { SessionTurnRuntimeDeps } from '../session/session-turn-runtime.js'
import type { DelegatedCredentialResolver } from '../session/delegated-credentials.js'
import type { DelegatedSessionCoordinator } from '../runtime/delegated-session-binding.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { SessionStore } from '../ports/session-store.js'
import type { TurnService } from '../services/turn-service.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import type { ApprovalGate } from '../ports/approval-gate.js'
import type { ApprovalReviewPort } from '../ports/approval-review.js'
import type { UserInputGate } from '../ports/user-input-gate.js'
import type { AttachmentStore } from '../attachments/attachment-store.js'
import type { LlmDebugSink } from '../services/llm-debug-recorder.js'
import type { TaskWorkspaceLister } from '../handoff/turn-handoff.js'
import type { KunServeRuntimeOptions } from './runtime-factory-types.js'
import type { HarnessSecretRefResolver } from '../harness/harness-secret-env.js'
import { harnessDefaultsFor } from '../harness/harness-defaults.js'
import { DEFAULT_APPROVAL_REVIEWER } from '../contracts/policy.js'

/** The composition locals the codex transport needs, grouped for the call site. */
export type CodexRuntimeSharedDeps = {
  sessionCoordinator: DelegatedSessionCoordinator
  threadStore: ThreadStore
  sessionStore: SessionStore
  turns: TurnService
  events: RuntimeEventRecorder
  ids: { next(prefix: string): string }
  credentialEnv?: DelegatedCredentialResolver
  resolveSecretEnv?: HarnessSecretRefResolver
  systemPrompt?: string
  approvalGate?: ApprovalGate
  approvalReview?: ApprovalReviewPort
  userInputGate?: UserInputGate
  attachmentStore?: AttachmentStore
  taskWorkspaces?: TaskWorkspaceLister
  debugSink?: LlmDebugSink
  nowIso: () => string
}

export function buildCodexAppServerDeps(
  options: KunServeRuntimeOptions,
  harnesses: Pick<
    HarnessRuntimeComposition,
    'catalog' | 'detector' | 'resolveSecretEnv'
  >,
  deps: CodexRuntimeSharedDeps
): SessionTurnRuntimeDeps {
  return {
    transport: 'codex-app-server',
    providerKind: 'codex-app-server',
    agentFactory: makeCodexAgentFactory(),
    capabilities: CODEX_APP_SERVER_LEGACY_CAPABILITIES,
    capabilitiesV2: CODEX_APP_SERVER_CAPABILITIES,
    catalog: harnesses.catalog,
    binaryPath: (harnessId) => options.harnesses?.binaryPaths?.[harnessId],
    harnessDefaults: (id) => harnessDefaultsFor(options.harnesses, id),
    resolveSecretEnv: deps.resolveSecretEnv ?? harnesses.resolveSecretEnv,
    threadStore: deps.threadStore,
    sessionStore: deps.sessionStore,
    turns: deps.turns,
    events: deps.events,
    ids: deps.ids,
    ...(deps.systemPrompt ? { systemPrompt: deps.systemPrompt } : {}),
    ...(deps.credentialEnv ? { credentialEnv: deps.credentialEnv } : {}),
    sessionCoordinator: deps.sessionCoordinator,
    ...(deps.approvalGate ? { approvalGate: deps.approvalGate } : {}),
    ...(deps.approvalReview ? { approvalReview: deps.approvalReview } : {}),
    ...(deps.userInputGate ? { userInputGate: deps.userInputGate } : {}),
    ...(deps.attachmentStore ? { attachmentStore: deps.attachmentStore } : {}),
    deterministicHandoff: options.ade?.deterministicHandoff !== false,
    allowUnattendedFullAccess: options.ade?.allowUnattendedFullAccess === true,
    defaultApprovalPolicy: options.approvalPolicy,
    defaultSandboxMode: options.sandboxMode,
    defaultApprovalReviewer: options.approvalReviewer ?? DEFAULT_APPROVAL_REVIEWER,
    turnLimits: options.runtime?.turnLimits,
    imageCapable: true,
    onLaunchFailure: (id, detail) =>
      harnesses.detector.recordLaunchFailure(id, detail),
    ...(deps.debugSink ? { debugSink: deps.debugSink } : {}),
    nowIso: deps.nowIso,
    ...(deps.taskWorkspaces ? { taskWorkspaces: deps.taskWorkspaces } : {})
  }
}
