import {
  AGENT_ROSTER_LANES,
  AGENT_ROSTER_LANE_USAGE,
  type AgentRosterEngine,
  type AgentRosterFacts,
  type AgentRosterFailureCode,
  type AgentRosterLane,
  type AgentRosterLaneStatus
} from '../contracts/agent-roster.js'
import { CONVERSATION_HARNESS_IDS } from '../contracts/agent-executor.js'
import type { SubagentProfileConfig } from '../contracts/capabilities.js'
import type { HarnessGatewayBinding } from '../contracts/harness-gateway-binding.js'
import type {
  HarnessCredentialMode,
  HarnessDefinition,
  HarnessId,
  HarnessRoute,
  HarnessStatus
} from '../contracts/harness.js'
import type { HarnessCapabilities } from '../contracts/harness-capabilities.js'
import { checkHarnessAdmission } from '../harness/harness-admission.js'
import {
  resolveHarnessRoute,
  type HarnessRouteResolutionDeps
} from '../harness/harness-route-resolution.js'

export const NATIVE_HARNESS_ID = 'kun'

/** Engine services the roster reads; all of them answer from host state. */
export type AgentRosterEngineAccess = HarnessRouteResolutionDeps & {
  catalog: {
    get(id: string): HarnessDefinition | undefined
    isDisabled?(id: HarnessId): boolean
    isProfileEnabled?(route: {
      harnessId: HarnessId
      credentialMode: HarnessCredentialMode
      providerId?: string
      gatewayBinding?: HarnessGatewayBinding
    }): boolean
  }
  detector: {
    cachedStatus(id: HarnessId): HarnessStatus | undefined
    status(id: HarnessId): Promise<HarnessStatus>
  }
  capabilitiesForRoute(route: HarnessRoute): Promise<HarnessCapabilities>
}

export type AgentRosterEvaluation = {
  engine: AgentRosterEngine
  facts: AgentRosterFacts
  lanes: Record<AgentRosterLane, AgentRosterLaneStatus>
  /** Concrete route for a bound engine; absent on the lane default. */
  route?: HarnessRoute
}

type EvaluationMode = 'cached' | 'probe'

/** A profile is bound to an engine when it pins one other than the native loop. */
export function profileEngineId(profile: SubagentProfileConfig): HarnessId | undefined {
  const id = profile.harnessId?.trim()
  return id && id !== NATIVE_HARNESS_ID ? id : undefined
}

/**
 * Evaluate one role against every lane. `cached` mode reads detector caches
 * only (listing never probes an engine); `probe` awaits readiness the way a
 * dispatch does.
 */
export async function evaluateRosterProfile(input: {
  profile: SubagentProfileConfig
  engines: AgentRosterEngineAccess | undefined
  honorEngineBinding: boolean
  parent: { model?: string; providerId?: string }
  mode: EvaluationMode
}): Promise<AgentRosterEvaluation> {
  const { profile, engines } = input
  const engineId = profileEngineId(profile)
  const modeBlock = profile.mode === 'primary'
    ? blocked('mode_mismatch', `${profileLabel(profile)} is a primary-session role and cannot be dispatched`)
    : undefined
  if (!engineId || !engines) {
    const caps = engines ? await nativeCapabilities(engines) : undefined
    return {
      engine: { kind: 'lane-default' },
      facts: factsFor(profile, caps),
      lanes: laneMap((lane) => lane === 'conversation' ? ok() : modeBlock ?? ok())
    }
  }
  const definition = engines.catalog.get(engineId)
  const resolved = resolveHarnessRoute({
    harnessId: engineId,
    definition,
    pin: profile,
    deps: engines,
    parent: input.parent
  })
  const engine: AgentRosterEngine = {
    kind: 'bound',
    harnessId: engineId,
    displayName: definition?.displayName ?? engineId,
    credentialMode: resolved.route.credentialMode,
    ...(resolved.route.model !== '-' ? { model: resolved.route.model } : {}),
    ...(resolved.route.providerId ? { providerId: resolved.route.providerId } : {}),
    ...(resolved.route.gatewayBinding ? { gatewayBinding: resolved.route.gatewayBinding } : {})
  }
  const unavailable = engineUnavailable(engines, definition, engineId, resolved)
  const caps = definition && !unavailable
    ? await engines.capabilitiesForRoute(resolved.route)
    : undefined
  const status = definition && !unavailable
    ? input.mode === 'probe'
      ? await engines.detector.status(engineId).catch(() => undefined)
      : cachedStatus(engines, engineId)
    : undefined
  const lanes = laneMap((lane) => {
    if (lane !== 'conversation' && modeBlock) return modeBlock
    if (lane === 'delegate' && !input.honorEngineBinding) return ok()
    if (unavailable) return unavailable
    if (lane === 'conversation' && !(CONVERSATION_HARNESS_IDS as readonly string[]).includes(engineId)) {
      return blocked('capability_missing', `${engine.displayName} cannot take part in conversations`)
    }
    if (!caps || !definition) return blocked('engine_unavailable', `${engine.displayName} is unavailable`)
    if (!status) return { state: 'unchecked' }
    const admission = checkHarnessAdmission({
      usage: AGENT_ROSTER_LANE_USAGE[lane],
      credentialMode: resolved.route.credentialMode,
      harness: definition,
      effective: caps,
      status,
      workspace: { isolated: laneIsolated(lane, profile) },
      unattended: false,
      allowUnattendedFullAccess: false
    })
    if (admission.ok) return ok()
    return blocked(
      admission.code === 'harness_not_ready' ? 'engine_not_ready' : admission.code,
      admission.message
    )
  })
  return {
    engine,
    facts: factsFor(profile, caps),
    lanes,
    ...(unavailable ? {} : { route: resolved.route })
  }
}

/** The failure a dispatch on `lane` must report, or undefined when it may run. */
export function laneFailure(
  evaluation: Pick<AgentRosterEvaluation, 'lanes'>,
  lane: AgentRosterLane
): { code: AgentRosterFailureCode; message: string } | undefined {
  const status = evaluation.lanes[lane]
  return status.state === 'blocked' ? { code: status.code, message: status.message } : undefined
}

/** Short, positive-or-negative capability tags for model-facing listings. */
export function rosterFactTags(facts: AgentRosterFacts): string[] {
  return [
    facts.writes ? 'writes' : 'read-only',
    facts.resumable ? 'resumable' : 'not-resumable',
    facts.liveProgress ? 'live-progress' : 'no-live-progress',
    facts.kunTools ? 'kun-tools' : 'no-kun-tools',
    facts.userInput ? 'asks-user' : 'cannot-ask-user'
  ]
}

function engineUnavailable(
  engines: AgentRosterEngineAccess,
  definition: HarnessDefinition | undefined,
  engineId: HarnessId,
  resolved: { route: HarnessRoute; rejectedReason?: string }
): AgentRosterLaneStatus | undefined {
  if (!definition) return blocked('engine_unavailable', `unknown engine ${engineId}`)
  if (engines.catalog.isDisabled?.(engineId)) {
    return blocked('engine_unavailable', `${definition.displayName} is turned off or has no enabled connection`)
  }
  if (resolved.rejectedReason) return blocked('engine_unavailable', resolved.rejectedReason)
  if (engines.catalog.isProfileEnabled?.(resolved.route) === false) {
    return blocked('engine_unavailable', `the ${definition.displayName} connection this role uses is not enabled`)
  }
  return undefined
}

function cachedStatus(engines: AgentRosterEngineAccess, id: HarnessId): HarnessStatus | undefined {
  const cached = engines.detector.cachedStatus(id)
  // Like the harness router: a cache miss starts a background refresh.
  if (!cached) void engines.detector.status(id).catch(() => undefined)
  return cached
}

async function nativeCapabilities(engines: AgentRosterEngineAccess): Promise<HarnessCapabilities | undefined> {
  if (!engines.catalog.get(NATIVE_HARNESS_ID)) return undefined
  return engines.capabilitiesForRoute({
    harnessId: NATIVE_HARNESS_ID,
    model: '-',
    credentialMode: 'provider'
  }).catch(() => undefined)
}

/**
 * Workers and Graph tasks run in host-owned worktrees, conversations are
 * read-only, and a delegate_task child shares the parent workspace unless its
 * role is read-only.
 */
function laneIsolated(lane: AgentRosterLane, profile: SubagentProfileConfig): boolean {
  return lane === 'delegate' ? profile.toolPolicy === 'readOnly' : true
}

function factsFor(profile: SubagentProfileConfig, caps: HarnessCapabilities | undefined): AgentRosterFacts {
  const supported = (key: keyof HarnessCapabilities['statuses']): boolean =>
    caps ? caps.statuses[key].supported : true
  return {
    writes: profile.toolPolicy !== 'readOnly',
    resumable: supported('nativeResume'),
    liveProgress: supported('structuredStreaming'),
    kunTools: supported('kunTools'),
    userInput: supported('userInput')
  }
}

function laneMap(
  status: (lane: AgentRosterLane) => AgentRosterLaneStatus
): Record<AgentRosterLane, AgentRosterLaneStatus> {
  return Object.fromEntries(AGENT_ROSTER_LANES.map((lane) => [lane, status(lane)])) as Record<
    AgentRosterLane,
    AgentRosterLaneStatus
  >
}

function profileLabel(profile: SubagentProfileConfig): string {
  return profile.name?.trim() || 'This role'
}

function ok(): AgentRosterLaneStatus {
  return { state: 'ok' }
}

function blocked(code: AgentRosterFailureCode, message: string): AgentRosterLaneStatus {
  return { state: 'blocked', code, message: message.slice(0, 512) }
}
