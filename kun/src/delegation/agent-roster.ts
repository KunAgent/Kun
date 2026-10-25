import type {
  AgentRosterEngine,
  AgentRosterEntry,
  AgentRosterFailureCode,
  AgentRosterLane,
  AgentRosterSource
} from '../contracts/agent-roster.js'
import type { SubagentProfileConfig } from '../contracts/capabilities.js'
import type { HarnessRoute } from '../contracts/harness.js'
import {
  evaluateRosterProfile,
  laneFailure,
  type AgentRosterEngineAccess,
  type AgentRosterEvaluation
} from './agent-roster-lanes.js'
import {
  listCatalogSubagentProfiles,
  routingDocument,
  type SubagentProfileSurface
} from './subagent-profile-catalog.js'
import type { SubagentRoutingDocument } from './subagent-router.js'
import { BUILTIN_AGENT_CATALOG_BY_ID } from './builtin-agent-catalog.js'

const LANE_LABEL: Record<AgentRosterLane, string> = {
  delegate: 'a delegate_task child',
  worker: 'a worker',
  graph: 'a Graph executor',
  conversation: 'a conversation member'
}

/** One wording for a roster refusal on every lane, code included. */
export function rosterRefusal(
  id: string,
  lane: AgentRosterLane,
  failure: { code: AgentRosterFailureCode; message: string }
): string {
  return `${id} cannot run as ${LANE_LABEL[lane]} (${failure.code}): ${failure.message}`
}

/** The generic fallback role claims no territory, whatever a config says. */
const GENERIC_PROFILE_ID = 'general'
const SURFACES: readonly SubagentProfileSurface[] = ['code', 'write', 'design']

export type AgentRosterParentRoute = { model?: string; providerId?: string }

/** A learned Graph profile offered read-only on the roster. */
export type AgentRosterLearnedProfile = { id: string; profile: SubagentProfileConfig }

export type AgentRosterDeps = {
  /** Effective configured profiles: built-ins merged with settings. */
  profiles(): Readonly<Record<string, SubagentProfileConfig>>
  /** `capabilities.subagents.honorEngineBinding`. */
  honorEngineBinding(): boolean
  /** The session's default route, used when a call carries no parent route. */
  defaultParent(): AgentRosterParentRoute
  engines?: AgentRosterEngineAccess
  /** Trusted learned Graph profiles for a workspace's project. */
  learned?(workspace: string): Promise<readonly AgentRosterLearnedProfile[]>
}

type RosterSnapshot = { id: string; source: AgentRosterSource; profile: SubagentProfileConfig }

export type AgentRosterResolution =
  | {
      ok: true
      id: string
      source: AgentRosterSource
      profile: SubagentProfileConfig
      engine: AgentRosterEngine
      /** The engine route this lane must run on; absent means the lane default. */
      route?: HarnessRoute
    }
  | { ok: false; code: AgentRosterFailureCode; message: string }

export type AgentRosterExclusion = { id: string; code: AgentRosterFailureCode; message: string }

/**
 * The one list of roles every dispatch lane picks from. Stateless: each call
 * reads the live profile catalog and engine state, so config apply needs no
 * rebuild and every caller sees the same answer.
 */
export class AgentRoster {
  constructor(private readonly deps: AgentRosterDeps) {}

  /** Every role on a surface, evaluated from cached engine readiness. */
  async list(input: {
    workspace?: string
    surface?: SubagentProfileSurface
    parent?: AgentRosterParentRoute
  } = {}): Promise<AgentRosterEntry[]> {
    const snapshots = await this.snapshots(input.workspace, input.surface ?? 'code')
    return Promise.all(snapshots.map(async (snapshot) =>
      rosterEntry(snapshot, await this.evaluate(snapshot.profile, input.parent, 'cached'))))
  }

  /**
   * One role for one lane, with readiness probed the way a dispatch needs.
   * `engineOverridden`: the caller pins its own engine, so only the role's
   * mode and surface decide; its bound engine is neither checked nor used.
   */
  async resolve(id: string, input: {
    lane: AgentRosterLane
    workspace?: string
    surface?: SubagentProfileSurface
    parent?: AgentRosterParentRoute
    engineOverridden?: boolean
  }): Promise<AgentRosterResolution> {
    const surface = input.surface ?? 'code'
    const wanted = id.trim()
    const snapshot = (await this.snapshots(input.workspace, surface)).find((entry) => entry.id === wanted)
    if (!snapshot) return this.missing(wanted, input.workspace, surface)
    const evaluation = input.engineOverridden
      ? await evaluateRosterProfile({
          profile: snapshot.profile,
          engines: undefined,
          honorEngineBinding: false,
          parent: input.parent ?? this.deps.defaultParent(),
          mode: 'probe'
        })
      : await this.evaluate(snapshot.profile, input.parent, 'probe')
    const failure = laneFailure(evaluation, input.lane)
    if (failure) return { ok: false, ...failure }
    const honorsEngine = input.lane !== 'delegate' || this.deps.honorEngineBinding()
    return {
      ok: true,
      id: snapshot.id,
      source: snapshot.source,
      profile: snapshot.profile,
      engine: evaluation.engine,
      ...(honorsEngine && evaluation.route ? { route: evaluation.route } : {})
    }
  }

  /** Every dispatchable catalog role on a surface, unfiltered by engine state. */
  async catalogDocuments(input: {
    workspace?: string
    surface?: SubagentProfileSurface
  } = {}): Promise<SubagentRoutingDocument[]> {
    return (await listCatalogSubagentProfiles(this.deps.profiles(), input.workspace, input.surface ?? 'code'))
      .filter((snapshot) => snapshot.profile.mode !== 'primary')
      .map(routingDocument)
  }

  /**
   * Routing documents a lane may auto-route over. Roles the lane cannot run
   * (by cached readiness) are left out and reported, never silently re-homed.
   */
  async routingDocuments(input: {
    lane: AgentRosterLane
    workspace?: string
    surface?: SubagentProfileSurface
    parent?: AgentRosterParentRoute
  }): Promise<{ documents: SubagentRoutingDocument[]; excluded: AgentRosterExclusion[] }> {
    const snapshots = await this.snapshots(input.workspace, input.surface ?? 'code')
    const documents: SubagentRoutingDocument[] = []
    const excluded: AgentRosterExclusion[] = []
    for (const snapshot of snapshots) {
      if (snapshot.source === 'learned') continue
      const evaluation = await this.evaluate(snapshot.profile, input.parent, 'cached')
      const failure = laneFailure(evaluation, input.lane)
      if (failure) excluded.push({ id: snapshot.id, ...failure })
      else documents.push(routingDocument({ ...snapshot, source: snapshot.source }))
    }
    return { documents, excluded }
  }

  private evaluate(
    profile: SubagentProfileConfig,
    parent: AgentRosterParentRoute | undefined,
    mode: 'cached' | 'probe'
  ): Promise<AgentRosterEvaluation> {
    return evaluateRosterProfile({
      profile,
      engines: this.deps.engines,
      honorEngineBinding: this.deps.honorEngineBinding(),
      parent: parent ?? this.deps.defaultParent(),
      mode
    })
  }

  private async snapshots(
    workspace: string | undefined,
    surface: SubagentProfileSurface
  ): Promise<RosterSnapshot[]> {
    // A user override of a built-in role is still that built-in role on the roster.
    const catalog: RosterSnapshot[] = (await listCatalogSubagentProfiles(this.deps.profiles(), workspace, surface))
      .map((entry) => entry.source === 'configured' && BUILTIN_AGENT_CATALOG_BY_ID[entry.id]
        ? { ...entry, source: 'builtin' as const }
        : entry)
    if (!workspace || !this.deps.learned) return catalog
    const taken = new Set(catalog.map((entry) => entry.id))
    const learned = await this.deps.learned(workspace).catch(() => [])
    return [
      ...catalog,
      ...learned
        .filter((entry) => !taken.has(entry.id))
        .map((entry) => ({ id: entry.id, source: 'learned' as const, profile: entry.profile }))
    ].sort((left, right) => left.id.localeCompare(right.id))
  }

  private async missing(
    id: string,
    workspace: string | undefined,
    surface: SubagentProfileSurface
  ): Promise<AgentRosterResolution> {
    for (const other of SURFACES) {
      if (other === surface) continue
      if ((await this.snapshots(workspace, other)).some((entry) => entry.id === id)) {
        return {
          ok: false,
          code: 'surface_mismatch',
          message: `agent ${id} is not available on the ${surface} surface`
        }
      }
    }
    return { ok: false, code: 'not_found', message: `unknown agent ${id}` }
  }
}

function rosterEntry(snapshot: RosterSnapshot, evaluation: AgentRosterEvaluation): AgentRosterEntry {
  const { profile } = snapshot
  const owns = snapshot.id === GENERIC_PROFILE_ID ? undefined : profile.owns?.trim()
  return {
    id: snapshot.id,
    source: snapshot.source,
    name: (profile.name?.trim() || snapshot.id).slice(0, 256),
    description: (profile.description ?? '').slice(0, 2_048),
    ...(owns ? { owns } : {}),
    surfaces: [...(profile.surfaces ?? ['shared'])],
    mode: profile.mode,
    toolPolicy: profile.toolPolicy,
    engine: evaluation.engine,
    facts: evaluation.facts,
    lanes: evaluation.lanes
  }
}
