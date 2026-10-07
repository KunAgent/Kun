import { dispatchGuidanceForTurn } from '../ade/dispatch-guidance.js'
import { observeHarnessAliasRoute } from '../harness/gateway-alias-route-observer.js'
import type { HarnessGatewayBinding } from '../contracts/harness-gateway-binding.js'
/**
 * Protocol-agnostic front half of a delegated turn (docs/ade/impl/p6a §2):
 * load thread/turn/items, locate the user input, gate graph orchestration,
 * ensure goal context, compute the filtered history, instruction blocks,
 * acting model route, credential identity/env, secret env, permission mode,
 * approval policy triple, and turn limits. Extracted from `AcpRuntime` so the
 * shared `SessionTurnRuntime` (codex-app-server, pi-rpc, …) resolves the
 * identical context — same field order, same fallbacks.
 */
import {
  goalContextTexts,
  type TurnItem,
  type UserTurnItem
} from '../contracts/items.js'
import type {
  HarnessCredentialMode,
  HarnessDefinition,
  HarnessId,
  HarnessTransport
} from '../contracts/harness.js'
import {
  DEFAULT_APPROVAL_REVIEWER,
  type ApprovalPolicy,
  type ApprovalReviewer,
  type SandboxMode
} from '../contracts/policy.js'
import type { Turn } from '../contracts/turns.js'
import { userMessageTextWithComposerContexts } from '../domain/composer-context.js'
import {
  filterGoalContextsForGoalKey,
  goalContextKey
} from '../loop/continuation-instructions.js'
import { normalizeTurnLimits, type TurnLimitsConfig } from '../loop/turn-limits.js'
import { nativeHarnessCredentialEnv, resolveHarnessSecretEnv } from '../harness/harness-secret-env.js'
import { nativeAgentNetworkStatus } from '../harness/native-agent-network.js'
import type { TurnRunOutcome } from '../loop/turn-execution-types.js'
import {
  projectTurnDynamicContext,
  type TurnDynamicContext
} from '../prompt/turn-persona-context.js'
import { historyReferenceInstructions } from '../prompt/history-reference-context.js'
import type { SessionStore } from '../ports/session-store.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { TurnService } from '../services/turn-service.js'
import { defaultCredentialMode } from '../harness/resolve-turn-harness.js'
import { harnessTurnNativeAgent, harnessTurnPermissionMode } from '../harness/harness-turn-permissions.js'
import { isUnattendedTurn } from '../harness/usage-for-turn.js'
import type { DelegatedSessionCoordinator } from '../runtime/delegated-session-binding.js'
import { parkDelegatedGraphTurnAfterRecovery } from '../runtime/delegated-graph-turn-policy.js'
import type { HarnessSecretRefResolver } from '../harness/harness-secret-env.js'
import type { HarnessDefaultsEntry } from '../config/kun-config-application.js'
import type { ActingTurnModelRoute } from '../contracts/turns.js'
import type {
  DelegatedCredentialEnvInput,
  DelegatedCredentialResolver
} from './delegated-credentials.js'

export type SessionTurnContextDeps = {
  readiness?: Pick<import('../harness/harness-readiness.js').HarnessReadinessService, 'validateTurn' | 'commandForTurn'>
  catalog: { get(id: string): HarnessDefinition | undefined }
  harnessDefaults?: (harnessId: HarnessId) => HarnessDefaultsEntry | undefined
  resolveSecretEnv?: HarnessSecretRefResolver
  threadStore: ThreadStore
  sessionStore: SessionStore
  turns: TurnService
  systemPrompt?: string
  credentialEnv?: DelegatedCredentialResolver
  enforceReadOnly?: boolean
  allowUnattendedFullAccess?: boolean
  defaultApprovalPolicy?: ApprovalPolicy
  defaultSandboxMode?: SandboxMode
  defaultApprovalReviewer?: ApprovalReviewer
  turnLimits?: TurnLimitsConfig
}

export type SessionTurnContext = {
  thread: NonNullable<Awaited<ReturnType<ThreadStore['get']>>>
  turn: Turn
  items: readonly TurnItem[]
  userItem: UserTurnItem
  definition: HarnessDefinition
  workspace: string
  instructionBlocks: readonly string[]
  turnDynamicContext: TurnDynamicContext
  goalContextKeyForHistory: string | null | undefined
  model: string | undefined
  /**
   * Model id the harness wire must send: under `kun-gateway` the route grant
   * is scoped to `kun/<provider>/<model>` — adapters send this, records keep
   * `model`. Undefined = send `model` verbatim.
   */
  wireModel?: string
  actingModelRoute: ActingTurnModelRoute
  credentialMode: ReturnType<typeof defaultCredentialMode>
  accountId: string | undefined
  permissionModeId: string | undefined
  /** Composer-selected native Agent (definition `nativeAgents`); replaces the permission mode. */
  nativeAgentId?: string
  approvalPolicy: ApprovalPolicy | undefined
  sandboxMode: SandboxMode | undefined
  approvalReviewer: ApprovalReviewer
  credentialIdentity: string
  credentialEnv: Record<string, string>
  secretEnv: Record<string, string>
  /** `${harnessId}:${credentialIdentity}` — the shared pool key. */
  poolKey: string
  limits: ReturnType<typeof normalizeTurnLimits>
  /** Bounded user-intent text for approval review context. */
  intent: string
  /** Redacted values for trace/llm-debug hygiene. */
  redactedRequestValues: readonly string[]
}

export type SessionTurnContextResult =
  | { ok: true; ctx: SessionTurnContext }
  | { ok: false; outcome: TurnRunOutcome }

export type ResolveSessionTurnContextInput = {
  threadId: string
  turnId: string
  signal: AbortSignal
  /** The transport this runtime serves (e.g. 'acp', 'codex-app-server'). */
  transport: HarnessTransport
  /** finishTurn failure text when no user input exists. */
  noInputMessage: string
  /** Graph-orchestration rejection message (transport-specific wording). */
  graphUnavailableMessage: string
  /** Resolves the credential identity + env; shared `resolveDelegatedCredentialContext`. */
  resolveCredentialContext: (
    resolve: DelegatedCredentialResolver | undefined,
    input: DelegatedCredentialContextInput
  ) => Promise<{
    credentialIdentity: string
    env: Record<string, string>
    wireModel?: string
  }>
}

export type DelegatedCredentialContextInput = {
  frozenGatewayAliases?: readonly import('../contracts/harness-gateway-binding.js').HarnessGatewayAliasGrant[]
  onResolvedAliases?: (aliases: import('../contracts/harness-gateway-binding.js').HarnessGatewayAliasGrant[]) => Promise<void>
  onGatewayRoute?: (route: import('../ports/model-client.js').ModelRouteTargetMetadata) => Promise<void>
  gatewayBinding?: HarnessGatewayBinding
  definition: HarnessDefinition
  credentialMode: HarnessCredentialMode
  threadId: string
  turnId: string
  providerId?: string
  model?: string
  accountId?: string
}

export function modelForHarnessWire(
  requestedModel: string | undefined,
  credentialMode: HarnessCredentialMode
): string | undefined {
  return credentialMode === 'native-login' && requestedModel === 'default'
    ? undefined
    : requestedModel
}

/**
 * Shared context resolution. All failure branches finish the turn themselves
 * and return `{ok:false, outcome}` so callers stay a flat early-return.
 */
export async function resolveSessionTurnContext(
  deps: SessionTurnContextDeps,
  input: ResolveSessionTurnContextInput
): Promise<SessionTurnContextResult> {
  const { threadId, turnId, signal } = input
  const fail = async (
    error: string,
    code?: string
  ): Promise<SessionTurnContextResult> => {
    await deps.turns.finishTurn({
      threadId,
      turnId,
      status: 'failed',
      error,
      ...(code ? { code } : {}),
      severity: 'error'
    })
    return { ok: false, outcome: 'failed' }
  }

  const thread = await deps.threadStore.get(threadId)
  const turn = thread?.turns.find((candidate) => candidate.id === turnId)
  if (!thread || !turn) return fail(input.noInputMessage)

  let items = await deps.sessionStore.loadItems(threadId)
  const userItem = [...items]
    .reverse()
    .find(
      (item): item is UserTurnItem =>
        item.turnId === turnId && item.kind === 'user_message'
    )
  if (!userItem) return fail(input.noInputMessage)

  const harnessId = turn.harnessId ?? thread.harnessId
  const definition = harnessId ? deps.catalog.get(harnessId) : undefined
  if (
    !definition ||
    definition.transport !== input.transport ||
    !definition.launch
  ) {
    return fail(
      `harness route is not ${input.transport}-backed: ${harnessId ?? 'none'}`,
      'route_unsupported'
    )
  }

  if (turn.orchestration === 'graph') {
    const completion = await parkDelegatedGraphTurnAfterRecovery(deps.turns, {
      threadId,
      turnId
    })
    if (
      completion === 'suspended' ||
      completion === 'suspended_pending_supervision'
    ) {
      return { ok: false, outcome: completion }
    }
    return fail(input.graphUnavailableMessage, 'capability_missing')
  }

  if (!deps.enforceReadOnly && thread.goal?.status === 'active') {
    await deps.turns.ensureGoalContext(threadId, turnId, signal)
    items = await deps.sessionStore.loadItems(threadId)
  }
  if (signal.aborted) {
    await deps.turns.finishTurn({ threadId, turnId, status: 'aborted' })
    return { ok: false, outcome: 'aborted' }
  }

  const goalContextKeyForHistory = goalContextKey(
    (await deps.threadStore.get(threadId))?.goal
  )
  items = filterGoalContextsForGoalKey(items, goalContextKeyForHistory)
  const turnDynamicContext = projectTurnDynamicContext({
    turnId,
    persona: turn.persona,
    items
  })
  items = [...turnDynamicContext.historyItems]
  const workspace = thread.workspace
  const instructionBlocks = [
    deps.systemPrompt?.trim(),
    thread.systemPrompt?.trim(),
    ...historyReferenceInstructions(thread),
    ...dispatchGuidanceForTurn(thread, turn, definition),
    ...turnDynamicContext.instructions
  ].filter((value, index, all): value is string =>
    Boolean(value) && all.indexOf(value) === index
  )
  const credentialMode =
    turn.credentialMode ?? defaultCredentialMode(definition.id, definition)
  const requestedModel =
    (turn.gatewayBinding ? undefined : turn.actingModelRoute?.model) ?? turn.model ?? thread.model ?? undefined
  // `default` is the native-login sentinel for an Agent chosen before its
  // model catalog loaded. Keep it in the durable route identity, but omit
  // session/set_model and native thread/turn model overrides on the wire.
  const model = modelForHarnessWire(requestedModel, credentialMode)
  const actingModelRoute: ActingTurnModelRoute = turn.actingModelRoute ?? {
    model: model ?? 'default',
    ...(turn.gatewayBinding ? { unresolvedGatewayAlias: true as const, requestedGatewayAlias: model } : {}),
    ...(!turn.gatewayBinding && (turn.providerId ?? thread.providerId)
      ? { providerId: turn.providerId ?? thread.providerId }
      : {}),
    ...(!turn.gatewayBinding && (turn.accountId ?? thread.accountId)
      ? { accountId: turn.accountId ?? thread.accountId }
      : {})
  }
  if (!turn.actingModelRoute && !turn.gatewayBinding) {
    await deps.turns.updateTurnMetadata(threadId, turnId, { actingModelRoute })
  }
  const approvalPolicy =
    deps.enforceReadOnly === true
      ? 'never'
      : turn.approvalPolicy ??
        thread.approvalPolicy ??
        deps.defaultApprovalPolicy
  const sandboxMode =
    deps.enforceReadOnly === true
      ? 'read-only'
      : turn.sandboxMode ?? thread.sandboxMode ?? deps.defaultSandboxMode
  const approvalReviewer =
    turn.approvalReviewer ??
    thread.approvalReviewer ??
    deps.defaultApprovalReviewer ??
    DEFAULT_APPROVAL_REVIEWER
  const permissionModeId = harnessTurnPermissionMode(definition, {
    requested: deps.harnessDefaults?.(definition.id)?.permissionMode,
    approvalPolicy, sandboxMode, approvalReviewer, unattended: isUnattendedTurn(turn),
    allowUnattendedFullAccess: deps.allowUnattendedFullAccess === true
  })
  const nativeAgentId = harnessTurnNativeAgent(definition, {
    requested: turn.harnessAgentId, sandboxMode, unattended: isUnattendedTurn(turn),
    allowUnattendedFullAccess: deps.allowUnattendedFullAccess === true
  })

  const {
    credentialIdentity,
    env: resolvedCredentialEnv,
    wireModel
  } = await input.resolveCredentialContext(deps.credentialEnv, {
      definition,
      credentialMode,
      threadId,
      turnId,
      providerId: turn.gatewayBinding ? undefined : actingModelRoute.providerId,
      model: turn.gatewayBinding ? model : actingModelRoute.model,
      accountId: turn.gatewayBinding ? undefined : actingModelRoute.accountId,
      gatewayBinding: turn.gatewayBinding,
      frozenGatewayAliases: turn.gatewayAliasGrants,
      ...(turn.gatewayBinding ? {
        onResolvedAliases: async (gatewayAliasGrants) => { await deps.turns.updateTurnMetadata(threadId, turnId, { gatewayAliasGrants }) },
        onGatewayRoute: observeHarnessAliasRoute(actingModelRoute, model ?? '', async (route) => {
          await deps.turns.updateTurnMetadata(threadId, turnId, { actingModelRoute: route })
        })
      } : {})
    })
  const secretEnv = await resolveHarnessSecretEnv(
    definition,
    deps.resolveSecretEnv
  )

  const credentialEnv = credentialMode === 'native-login'
    ? nativeHarnessCredentialEnv(definition, { ...process.env, ...definition.launch?.env, ...secretEnv })
    : resolvedCredentialEnv
  const readinessIdentity = await deps.readiness?.validateTurn(threadId, turnId, input.signal, {
    harnessId: definition.id, credentialMode, providerId: turn.gatewayBinding ? undefined : actingModelRoute.providerId,
    model: turn.gatewayBinding ? model ?? 'default' : actingModelRoute.model,
    ...(turn.gatewayBinding ? { gatewayBinding: turn.gatewayBinding } : {})
  })
  return {
    ok: true,
    ctx: {
      thread,
      turn,
      items,
      userItem,
      definition,
      workspace,
      instructionBlocks,
      turnDynamicContext,
      goalContextKeyForHistory,
      model,
      ...(wireModel ? { wireModel } : {}),
      actingModelRoute,
      credentialMode,
      accountId: actingModelRoute.accountId,
      permissionModeId,
      ...(nativeAgentId ? { nativeAgentId } : {}),
      approvalPolicy,
      sandboxMode,
      approvalReviewer,
      credentialIdentity,
      credentialEnv,
      secretEnv,
      poolKey:
        definition.poolScope === 'workspace'
          ? `${definition.id}:${credentialIdentity}:${workspace}:${nativeAgentNetworkStatus(definition).networkFingerprint}:${readinessIdentity ?? ''}`
          : `${definition.id}:${credentialIdentity}:${nativeAgentNetworkStatus(definition).networkFingerprint}:${readinessIdentity ?? ''}`,
      limits: normalizeTurnLimits(deps.turnLimits),
      intent:
        turn.prompt || userMessageTextWithComposerContexts(userItem),
      redactedRequestValues: [
        ...goalContextTexts(items),
        ...turnDynamicContext.privateValues
      ]
    }
  }
}
