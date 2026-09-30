/**
 * P6-09/11: `SessionTurnRuntimeDeps` assembly for the native `pi --mode rpc`
 * transport. Mirrors runtime-composition-codex.ts; the only structural
 * difference is the Kun config dir handed to the agent factory (bridge
 * extension + per-process permission files live there).
 */
import { join } from 'node:path'
import type { HarnessRuntimeComposition } from '../harness/harness-runtime.js'
import { PI_RPC_CAPABILITIES } from '../harness/builtin-harnesses.js'
import {
  PI_RPC_LEGACY_CAPABILITIES,
  makePiAgentFactory
} from '../runtime/pi/pi-agent.js'
import type { SessionTurnRuntimeDeps } from '../session/session-turn-runtime.js'
import { harnessDefaultsFor } from '../harness/harness-defaults.js'
import { DEFAULT_APPROVAL_REVIEWER } from '../contracts/policy.js'
import type { KunServeRuntimeOptions } from './runtime-factory-types.js'
import type { CodexRuntimeSharedDeps } from './runtime-composition-codex.js'

export function buildPiRpcDeps(
  options: KunServeRuntimeOptions,
  harnesses: Pick<
    HarnessRuntimeComposition,
    'catalog' | 'detector' | 'resolveSecretEnv'
  >,
  deps: CodexRuntimeSharedDeps
): SessionTurnRuntimeDeps {
  return {
    transport: 'pi-rpc',
    providerKind: 'pi-rpc',
    agentFactory: makePiAgentFactory({
      configDir: () => join(options.dataDir ?? '.', 'pi')
    }),
    capabilities: PI_RPC_LEGACY_CAPABILITIES,
    capabilitiesV2: PI_RPC_CAPABILITIES,
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
