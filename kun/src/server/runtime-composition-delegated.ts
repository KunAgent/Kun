import { freezeHarnessGatewayAliases } from '../harness/gateway-alias-binding.js'
import { nativeAgentNetworkEnv } from '../harness/native-agent-network.js'
/**
 * Delegated-turn-runtime dep assembly for the main serve scope. Extracted
 * from runtime-composition-agent.ts to keep that file under the line-count
 * gate: everything captured from the composition scope arrives via `ctx`.
 */
import {
  type AttachmentStore,
  type CapabilityRegistry,
  type AgentSdkRuntimeFactoryDeps,
  type AntigravityCliRuntimeDeps,
  type CursorSdkRuntimeFactoryDeps,
  type AcpRuntimeDeps,
  DEFAULT_APPROVAL_REVIEWER,
  type InstructionRuntime,
  type LocalToolHost,
  type MemoryStore,
  type MemoryFeedbackRuntime,
  resolveAntigravityCliCommand,
  type SkillRuntime,
  waitForWorkspaceCheckpoint
} from './runtime-factory-dependencies.js'
import type { KunServeRuntimeOptions } from './runtime-factory-types.js'
import type { createRuntimeRegistry } from './runtime-composition-registry.js'
import type { createProviderPoolAccess } from './runtime-composition-manager.js'
import {
  agentSdkProviderIdsForOptions,
  antigravityProviderIdsForOptions,
  cursorSdkProviderIdsForOptions
} from './runtime-factory-model.js'
import { CanvasReceiptRegistry } from '../services/canvas-receipt-registry.js'
import type { TaskWorkspaceService } from '../workspace-tasks/task-workspace-service.js'
import { harnessDefaultsFor } from '../harness/harness-defaults.js'
import { buildCodexAppServerDeps } from './runtime-composition-codex.js'
import { buildPiRpcDeps } from './runtime-composition-pi.js'
import type { createGraphHarnessSummary } from '../ade/graph-harness-summary.js'

export type MainDelegatedRuntimeInput = {
  options: KunServeRuntimeOptions
  registry: CapabilityRegistry
  skillRuntime: SkillRuntime
  instructionRuntime: InstructionRuntime
  attachmentStore?: AttachmentStore
  memoryStore?: MemoryStore
  taskWorkspaces?: TaskWorkspaceService
  memoryFeedback?: MemoryFeedbackRuntime
}

export type MainDelegatedRuntimeContext = {
  services: ReturnType<typeof createRuntimeRegistry>['services']
  canvasReceipts: CanvasReceiptRegistry
  toolHost: LocalToolHost
  providerPool: ReturnType<typeof createProviderPoolAccess>
  graphHarnessSummary: ReturnType<typeof createGraphHarnessSummary>
}

export function buildMainDelegatedRuntime(
  input: MainDelegatedRuntimeInput,
  ctx: MainDelegatedRuntimeContext
) {
  const { services, canvasReceipts, toolHost, providerPool, graphHarnessSummary } = ctx
  const { model } = services
  const { core } = model
  const {
    sessionStore,
    threadStore,
    events,
    ids,
    prefix,
    approvalGate,
    userInputGate,
    llmDebug,
    nowIso,
    delegatedSessions,
    delegatedContextProfile,
    threadService
  } = core
  const { resolveLegacyRequestCredentials, approvalReviewService, modelConnections } = model
  const { turnService, defaultIsAgentSdk, defaultIsAntigravity, defaultIsCursorSdk } = services
  const providerConfigs = Object.fromEntries(
    Object.entries(input.options.providers ?? {}).map(([id, provider]) => [id, { ...provider }])
  )
  const sdkRuntimeDeps: AgentSdkRuntimeFactoryDeps = {
    readiness: services.harnesses.readiness,
    registry: input.registry,
    receipts: canvasReceipts,
    toolHost,
    turns: turnService,
    sessionStore,
    threadStore,
    events,
    ids,
    prefix,
    providerConfigs,
    agentSdkProviderIds: new Set(agentSdkProviderIdsForOptions(input.options)),
    defaultApprovalPolicy: input.options.approvalPolicy,
    defaultSandboxMode: input.options.sandboxMode,
    defaultApprovalReviewer: input.options.approvalReviewer ?? DEFAULT_APPROVAL_REVIEWER,
    defaultModel: input.options.model,
    defaultIsAgentSdk,
    defaultToken: input.options.apiKey,
    defaultCredentialSourceId: input.options.credentialSourceId,
    resolveCredentialSource: async (sourceId) => {
      const resolved = await resolveLegacyRequestCredentials(sourceId)
      return resolved.apiKey.trim() ? { apiKey: resolved.apiKey } : null
    },
    turnLimits: input.options.runtime?.turnLimits,
    approvalGate,
    approvalReview: approvalReviewService,
    skillRuntime: input.skillRuntime,
    instructionRuntime: input.instructionRuntime,
    userInputGate,
    nowIso,
    ...(input.attachmentStore ? { attachmentStore: input.attachmentStore } : {}),
    ...(input.memoryStore ? { memoryStore: input.memoryStore } : {}),
    ...(input.memoryFeedback ? { memoryFeedback: input.memoryFeedback } : {}),
    ...((input.options.harnesses?.binaryPaths?.['claude-code'] ?? process.env.KUN_CLAUDE_BINARY) ? { pathToClaudeCodeExecutable: input.options.harnesses?.binaryPaths?.['claude-code'] ?? process.env.KUN_CLAUDE_BINARY } : {}),
    sessionCoordinator: delegatedSessions,
    contextProfile: delegatedContextProfile,
    deterministicHandoff: input.options.ade?.deterministicHandoff !== false,
    // `kun-gateway` credential mode (docs/ade/04 §5.5): grant issuance,
    // loopback endpoint, roles, and the catalog's gateway env block.
    harnessTokens: services.harnesses.tokens,
    harnessGatewayBaseUrl: () => services.harnesses.gatewayEndpoint.baseUrl,
    resolveGatewayAliases: async (binding) => freezeHarnessGatewayAliases(await modelConnections.snapshot(), binding),
    roles: () => core.activeOptions.roles,
    harnessCatalog: services.harnesses.catalog,
    graphHarnessSummary,
    resolveDefaultProviderId: async () => (await modelConnections.snapshot()).defaultProviderId,
    listProviderModels: async (providerId) => {
      const provider = await providerPool.poolEntry(providerId)
      return provider?.gatewayExportable ? provider.models : []
    },
    ...(input.taskWorkspaces ? { taskWorkspaces: input.taskWorkspaces } : {})
  }
  const antigravityRuntimeDeps: AntigravityCliRuntimeDeps = {
    nativeNetworkEnv: () => nativeAgentNetworkEnv(services.harnesses.catalog.get('antigravity')),
    resolveCredentialSource: resolveLegacyRequestCredentials,
    readiness: services.harnesses.readiness,
    providerConfigs,
    providerIds: new Set(antigravityProviderIdsForOptions(input.options)),
    defaultIsAntigravity,
    defaultModel: input.options.model,
    systemPrompt: prefix.systemPrompt,
    binaryPath:
      input.options.harnesses?.binaryPaths?.antigravity ?? process.env.KUN_ANTIGRAVITY_BINARY ??
      resolveAntigravityCliCommand(core.activeOptions.dataDir)?.command,
    threadStore,
    sessionStore,
    turns: turnService,
    events,
    ids,
    ...(llmDebug ? { debugSink: llmDebug } : {}),
    turnLimits: input.options.runtime?.turnLimits,
    sessionCoordinator: delegatedSessions,
    contextProfile: delegatedContextProfile,
    deterministicHandoff: input.options.ade?.deterministicHandoff !== false,
    ...(input.taskWorkspaces ? { taskWorkspaces: input.taskWorkspaces } : {})
  }
  const cursorRuntimeDeps: CursorSdkRuntimeFactoryDeps = {
    readiness: services.harnesses.readiness,
    registry: input.registry,
    toolHost,
    receipts: canvasReceipts,
    providerConfigs,
    providerIds: new Set(cursorSdkProviderIdsForOptions(input.options)),
    defaultIsCursor: defaultIsCursorSdk,
    defaultApiKey: input.options.apiKey,
    defaultCredentialSourceId: input.options.credentialSourceId,
    resolveCredentialSource: async (sourceId) => {
      const resolved = await resolveLegacyRequestCredentials(sourceId)
      return resolved.apiKey.trim() ? { apiKey: resolved.apiKey } : null
    },
    defaultModel: input.options.model,
    defaultApprovalPolicy: input.options.approvalPolicy,
    defaultSandboxMode: input.options.sandboxMode,
    defaultApprovalReviewer: input.options.approvalReviewer ?? DEFAULT_APPROVAL_REVIEWER,
    systemPrompt: prefix.systemPrompt,
    threadStore,
    sessionStore,
    turns: turnService,
    events,
    ids,
    ...(llmDebug ? { debugSink: llmDebug } : {}),
    approvalGate,
    approvalReview: approvalReviewService,
    userInputGate,
    skillRuntime: input.skillRuntime,
    instructionRuntime: input.instructionRuntime,
    graphHarnessSummary,
    nowIso,
    ...(input.memoryStore ? { memoryStore: input.memoryStore } : {}),
    ...(input.memoryFeedback ? { memoryFeedback: input.memoryFeedback } : {}),
    ...(input.attachmentStore ? { attachmentStore: input.attachmentStore } : {}),
    turnLimits: input.options.runtime?.turnLimits,
    sessionCoordinator: delegatedSessions,
    contextProfile: delegatedContextProfile,
    deterministicHandoff: input.options.ade?.deterministicHandoff !== false,
    ...(input.taskWorkspaces ? { taskWorkspaces: input.taskWorkspaces } : {})
  }
  const acpRuntimeDeps: AcpRuntimeDeps = {
    readiness: services.harnesses.readiness,
    catalog: services.harnesses.catalog,
    binaryPath: (harnessId) => core.activeOptions.harnesses?.binaryPaths?.[harnessId],
    harnessDefaults: (id) => harnessDefaultsFor(core.activeOptions.harnesses, id),
    resolveSecretEnv: services.harnesses.resolveSecretEnv, threadStore, sessionStore,
    turns: turnService,
    events,
    ids,
    systemPrompt: prefix.systemPrompt,
    sessionCoordinator: delegatedSessions,
    connectionPool: core.acpConnectionPool,
    clientHost: core.acpClientHost,
    sessionManager: core.acpSessionManager,
    approvalGate, approvalReview: approvalReviewService,
    userInputGate, workerCallbacks: services.workerCallbacks,
    kunToolsMcp: services.kunToolsMcp, credentialEnv: services.acpCredentialEnv,
    ...(input.attachmentStore ? { attachmentStore: input.attachmentStore } : {}),
    deterministicHandoff: input.options.ade?.deterministicHandoff !== false,
    allowUnattendedFullAccess: input.options.ade?.allowUnattendedFullAccess === true,
    defaultApprovalPolicy: input.options.approvalPolicy, defaultSandboxMode: input.options.sandboxMode,
    defaultApprovalReviewer: input.options.approvalReviewer ?? DEFAULT_APPROVAL_REVIEWER,
    turnLimits: input.options.runtime?.turnLimits,
    awaitWorkspaceCheckpoint: (id, sig) => waitForWorkspaceCheckpoint(core.activeOptions.dataDir, id, sig),
    // P4-03: a real launch failure outweighs any earlier probe verdict.
    onLaunchFailure: (id, detail) => services.harnesses.detector.recordLaunchFailure(id, detail),
    ...(llmDebug ? { debugSink: llmDebug } : {}),
    nowIso,
    ...(input.taskWorkspaces ? { taskWorkspaces: input.taskWorkspaces } : {})
  }
  return {
    agentSdk: sdkRuntimeDeps,
    antigravity: antigravityRuntimeDeps,
    cursor: cursorRuntimeDeps,
    acp: acpRuntimeDeps,
    // P6-07: native `codex app-server` transport on the shared session layer;
    // dep assembly lives in runtime-composition-codex.ts.
    codexAppServer: buildCodexAppServerDeps(input.options, services.harnesses, {
      sessionCoordinator: delegatedSessions,
      threadStore,
      sessionStore,
      turns: turnService,
      events,
      ids,
      credentialEnv: services.acpCredentialEnv,
      systemPrompt: prefix.systemPrompt,
      approvalGate,
      approvalReview: approvalReviewService,
      userInputGate,
      attachmentStore: input.attachmentStore,
      taskWorkspaces: input.taskWorkspaces,
      debugSink: llmDebug,
      nowIso
    }),
    // P6-09/11: native `pi --mode rpc` transport on the shared session layer;
    // dep assembly lives in runtime-composition-pi.ts.
    piRpc: buildPiRpcDeps(input.options, services.harnesses, {
      sessionCoordinator: delegatedSessions,
      threadStore,
      sessionStore,
      turns: turnService,
      events,
      ids,
      credentialEnv: services.acpCredentialEnv,
      systemPrompt: prefix.systemPrompt,
      approvalGate,
      approvalReview: approvalReviewService,
      userInputGate,
      attachmentStore: input.attachmentStore,
      taskWorkspaces: input.taskWorkspaces,
      debugSink: llmDebug,
      nowIso
    }),
    // External-agent usage is folded into the same cumulative ledger as
    // native turns so the usage index and composer footer stay correct.
    usage: core.usageService
  }
}
