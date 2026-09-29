import { scryptSync } from 'node:crypto'
import { resolve } from 'node:path'
import type { TurnItem } from '../contracts/items.js'
import { effectiveHistoryAfterLatestCompaction } from '../loop/compaction-history.js'
import {
  delegatedRouteKey,
  sha256,
  stableStringify
} from './delegated-session-binding-keys.js'

export { FileDelegatedSessionBindingStore } from './delegated-session-binding-store.js'
export { delegatedRouteKey } from './delegated-session-binding-keys.js'

export type DelegatedProviderKind =
  | 'agent-sdk'
  | 'cursor-sdk'
  | 'antigravity-cli'
  | 'acp'
  | 'codex-app-server'
  | 'pi-rpc'
export type DelegatedContinuationMode = 'native' | 'portable'

export type DelegatedSessionRoute = {
  providerKind: DelegatedProviderKind
  providerId: string
  credentialIdentity: string
  workspace: string
  model: string
  capabilityFingerprint: string
  continuationMode: DelegatedContinuationMode
}

/**
 * A delegated session displaced by a harness switch (docs/ade/08 §5.2). The
 * provider state directory `provider-state/<thread>/<kind>/<key>` stays on
 * disk so a later turn on the same route can resume natively.
 */
export type ParkedSession = DelegatedSessionRoute & {
  /** delegatedRouteKey() of the parked route. */
  key: string
  nativeSessionId?: string
  synchronizedHistoryDigest: string
  /** History item count at commit, used by prefix validation on restore. */
  priorItemCount?: number
  lastCommittedTurnId: string
  handoffBriefDigest?: string
  parkedAt: string
}

export type DelegatedSessionBinding = DelegatedSessionRoute & {
  schemaVersion: 2
  threadId: string
  generation: number
  nativeSessionId?: string
  synchronizedHistoryDigest: string
  /** History item count at commit, used by prefix validation on restore. */
  priorItemCount?: number
  lastCommittedTurnId: string
  /** Digest of the last injected handoff brief, for audit (docs/ade/08 §4). */
  handoffBriefDigest?: string
  /** Sessions parked by earlier harness switches; newest last, max 3, ≤7d. */
  parked?: ParkedSession[]
  createdAt: string
  updatedAt: string
}

export type DelegatedSessionPreparation = {
  threadId: string
  generation: number
  route: DelegatedSessionRoute
  priorHistoryDigest: string
  nativeSessionId?: string
  resumed: boolean
  /** Set when this resume restored a parked session (docs/ade/08 §5). */
  parkedDelta?: {
    lastCommittedTurnId: string
    /** Route that ran most recently before this restore (the switch source). */
    fromRoute?: { providerKind: DelegatedProviderKind; providerId: string; model: string }
  }
  /**
   * The superseded binding's provider coordinates when a rebase switched
   * routes — used to label the handoff brief's 来源 (source) field.
   */
  rebasedFrom?: { providerKind: DelegatedProviderKind; providerId: string; model: string }
  rebaseReason?:
    | 'new'
    | 'route_changed'
    | 'capabilities_changed'
    | 'history_changed'
    | 'native_state_unavailable'
}

export interface DelegatedSessionBindingStore {
  load(threadId: string): Promise<DelegatedSessionBinding | null>
  save(binding: DelegatedSessionBinding): Promise<void>
  delete(threadId: string): Promise<void>
  clearProviderState(
    providerKind: DelegatedProviderKind,
    threadId: string,
    routeKey: string
  ): Promise<void>
  /** rm-only variant for evicted/expired parked state — no dir recreation. */
  removeProviderState(
    providerKind: DelegatedProviderKind,
    threadId: string,
    routeKey: string
  ): Promise<void>
  providerStateDir(
    providerKind: DelegatedProviderKind,
    threadId: string,
    routeKey: string
  ): string
}

const BINDING_SCHEMA_VERSION = 2
const PARKED_SESSION_LIMIT = 3
const PARKED_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000
const MAX_NATIVE_SESSION_ID_LENGTH = 1_024

export class DelegatedSessionCoordinator {
  private readonly leases = new Map<string, Promise<void>>()

  constructor(
    readonly store: DelegatedSessionBindingStore,
    private readonly nowIso: () => string = () => new Date().toISOString()
  ) {}

  async runExclusive<T>(threadId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.leases.get(threadId) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolveLease) => {
      release = resolveLease
    })
    const tail = previous.catch(() => undefined).then(() => current)
    this.leases.set(threadId, tail)
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
      if (this.leases.get(threadId) === tail) this.leases.delete(threadId)
    }
  }

  async prepare(input: {
    threadId: string
    route: DelegatedSessionRoute
    priorItems: readonly TurnItem[]
  }): Promise<DelegatedSessionPreparation> {
    const priorHistoryDigest = delegatedHistoryDigest(input.priorItems)
    const binding = await this.store.load(input.threadId)
    const routeMatches = binding ? sameRoute(binding, input.route) : false
    const portableAligned = Boolean(
      binding &&
      routeMatches &&
      input.route.continuationMode === 'portable' &&
      binding.continuationMode === 'portable' &&
      binding.synchronizedHistoryDigest === priorHistoryDigest
    )
    const canResume = Boolean(
      binding &&
      routeMatches &&
      input.route.continuationMode === 'native' &&
      binding.continuationMode === 'native' &&
      binding.nativeSessionId &&
      binding.synchronizedHistoryDigest === priorHistoryDigest
    )
    if (binding && canResume) {
      return {
        threadId: input.threadId,
        generation: binding.generation,
        route: input.route,
        priorHistoryDigest,
        nativeSessionId: binding.nativeSessionId,
        resumed: true
      }
    }
    if (binding && portableAligned) {
      return {
        threadId: input.threadId,
        generation: binding.generation,
        route: input.route,
        priorHistoryDigest,
        resumed: false
      }
    }
    if (binding && !routeMatches) {
      // Route switch: park the displaced session (bounded to the newest 3
      // within 7 days), then try to restore a parked session for the new route.
      const now = this.nowIso()
      const pruned = pruneParked(
        [...(binding.parked ?? []), toParkedSession(binding, now)],
        now
      )
      for (const evicted of pruned.evicted) {
        await this.store.removeProviderState(
          evicted.providerKind,
          input.threadId,
          evicted.key
        )
      }
      const key = delegatedRouteKey(input.route)
      const candidate = pruned.kept.find((entry) => entry.key === key)
      const prefixOk = candidate
        ? this.prefixMatches(candidate, input.priorItems)
        : false
      if (
        candidate &&
        prefixOk &&
        input.route.continuationMode === 'native' &&
        candidate.nativeSessionId
      ) {
        await this.store.save({
          ...binding,
          schemaVersion: BINDING_SCHEMA_VERSION,
          parked: pruned.kept.filter((entry) => entry.key !== key),
          updatedAt: now
        })
        return {
          threadId: input.threadId,
          generation: binding.generation + 1,
          route: input.route,
          priorHistoryDigest,
          nativeSessionId: candidate.nativeSessionId,
          resumed: true,
          parkedDelta: {
            lastCommittedTurnId: candidate.lastCommittedTurnId,
            fromRoute: {
              providerKind: binding.providerKind,
              providerId: binding.providerId,
              model: binding.model
            }
          }
        }
      }
      let retained = pruned.kept
      if (candidate) {
        // Parked but unrestorable (prefix mismatch / non-native route): the
        // fresh session reuses this route key, so drop the stale entry and
        // reset its provider state — the prefix cannot become valid again on
        // an append-only history.
        await this.store.clearProviderState(
          input.route.providerKind,
          input.threadId,
          key
        )
        retained = pruned.kept.filter((entry) => entry.key !== key)
      }
      await this.store.save({
        ...binding,
        schemaVersion: BINDING_SCHEMA_VERSION,
        parked: retained,
        updatedAt: now
      })
      return {
        threadId: input.threadId,
        generation: binding.generation + 1,
        route: input.route,
        priorHistoryDigest,
        resumed: false,
        rebasedFrom: {
          providerKind: binding.providerKind,
          providerId: binding.providerId,
          model: binding.model
        },
        rebaseReason: rebaseReason(binding, input.route, priorHistoryDigest)
      }
    }
    if (binding) {
      // Same route but rebased in place (capability/history change): stale
      // native state for this exact route must not leak into the fresh
      // generation; parked sessions under other route keys stay parked.
      await this.store.clearProviderState(
        input.route.providerKind,
        input.threadId,
        delegatedRouteKey(input.route)
      )
    }
    return {
      threadId: input.threadId,
      generation: (binding?.generation ?? 0) + 1,
      route: input.route,
      priorHistoryDigest,
      resumed: false,
      ...(binding
        ? {
            rebasedFrom: {
              providerKind: binding.providerKind,
              providerId: binding.providerId,
              model: binding.model
            }
          }
        : {}),
      rebaseReason: rebaseReason(binding, input.route, priorHistoryDigest)
    }
  }

  async commit(input: {
    preparation: DelegatedSessionPreparation
    committedItems: readonly TurnItem[]
    lastCommittedTurnId: string
    nativeSessionId?: string
    handoffBriefDigest?: string
  }): Promise<DelegatedSessionBinding> {
    const previous = await this.store.load(input.preparation.threadId)
    if (
      previous &&
      previous.generation > input.preparation.generation
    ) {
      throw new Error('delegated session generation was superseded')
    }
    const now = this.nowIso()
    const nativeSessionId = validNativeSessionId(input.nativeSessionId)
    const continuationMode =
      input.preparation.route.continuationMode === 'native' && nativeSessionId
        ? 'native'
        : 'portable'
    const binding: DelegatedSessionBinding = {
      schemaVersion: BINDING_SCHEMA_VERSION,
      threadId: input.preparation.threadId,
      generation: input.preparation.generation,
      ...input.preparation.route,
      continuationMode,
      ...(nativeSessionId ? { nativeSessionId } : {}),
      synchronizedHistoryDigest: delegatedHistoryDigest(input.committedItems),
      // The prefix check counts the post-filter item stream the runtimes feed
      // into prepare(); runtime_context_source items never reach that stream.
      priorItemCount: input.committedItems.filter(
        (item) => item.kind !== 'runtime_context_source'
      ).length,
      lastCommittedTurnId: input.lastCommittedTurnId,
      ...(input.handoffBriefDigest
        ? { handoffBriefDigest: input.handoffBriefDigest }
        : {}),
      // Parked sessions live on the stored binding — carry them across
      // commits since the preparation only knows the active route.
      ...(previous?.parked?.length ? { parked: previous.parked } : {}),
      createdAt:
        previous?.generation === input.preparation.generation
          ? previous.createdAt
          : now,
      updatedAt: now
    }
    await this.store.save(binding)
    return binding
  }

  /**
   * A parked session may resume only if the canonical prefix it was committed
   * against is still intact: digest the first `priorItemCount` prior items and
   * compare to the parked checkpoint's synchronized digest.
   */
  private prefixMatches(
    candidate: ParkedSession,
    priorItems: readonly TurnItem[]
  ): boolean {
    if (
      candidate.priorItemCount === undefined ||
      priorItems.length < candidate.priorItemCount
    ) return false
    return (
      delegatedHistoryDigest(priorItems.slice(0, candidate.priorItemCount)) ===
      candidate.synchronizedHistoryDigest
    )
  }

  async rejectResume(
    preparation: DelegatedSessionPreparation
  ): Promise<DelegatedSessionPreparation> {
    await this.store.clearProviderState(
      preparation.route.providerKind,
      preparation.threadId,
      delegatedRouteKey(preparation.route)
    )
    return {
      ...preparation,
      generation: preparation.generation + 1,
      nativeSessionId: undefined,
      resumed: false,
      rebaseReason: 'native_state_unavailable'
    }
  }

  /**
   * A delegated backing process died (docs/ade/03 §4.3): drop the stored
   * nativeSessionId and any parked entries that lived on the same connection
   * (same providerKind + providerId + credentialIdentity, regardless of
   * model/workspace since one process hosts many sessions). The next
   * prepare() then rebases with rebaseReason 'native_state_unavailable' and
   * rebuilds portable.
   */
  async markNativeStateUnavailable(input: {
    threadId: string
    providerKind: DelegatedProviderKind
    providerId: string
    credentialIdentity: string
  }): Promise<boolean> {
    const binding = await this.store.load(input.threadId)
    if (!binding) return false
    const onConnection = (route: DelegatedSessionRoute) =>
      route.providerKind === input.providerKind &&
      route.providerId === input.providerId &&
      route.credentialIdentity === input.credentialIdentity
    const parked = binding.parked ?? []
    const deadParked = parked.filter(onConnection)
    for (const entry of deadParked) {
      await this.store.removeProviderState(
        entry.providerKind,
        input.threadId,
        entry.key
      )
    }
    const keptParked = parked.filter((entry) => !onConnection(entry))
    const clearActive =
      onConnection(binding) && binding.nativeSessionId !== undefined
    if (!clearActive && deadParked.length === 0) return false
    const { nativeSessionId: _cleared, ...rest } = binding
    const next: DelegatedSessionBinding = {
      ...rest,
      ...(clearActive ? {} : { nativeSessionId: binding.nativeSessionId }),
      parked: keptParked.length ? keptParked : undefined,
      updatedAt: this.nowIso()
    }
    await this.store.save(next)
    return true
  }

  async invalidate(threadId: string): Promise<void> {
    // The local lease orders one Runtime's calls; store.delete() obtains the
    // Manager resource fence required to coordinate separate Runtime instances.
    await this.runExclusive(threadId, () => this.store.delete(threadId))
  }
}

export function delegatedHistoryDigest(items: readonly TurnItem[]): string {
  const effective = effectiveHistoryAfterLatestCompaction(
    items.filter((item) => item.kind !== 'runtime_context_source')
  )
  return sha256(stableStringify(effective.map(digestItem)))
}

export function delegatedCapabilityFingerprint(value: unknown): string {
  return sha256(stableStringify(value))
}

export function delegatedCredentialIdentity(input: {
  providerId: string
  accountId?: string
  credentialSourceId?: string
  credentialSecret?: string
}): string {
  const parts = [
    ...(input.accountId?.trim() ? [`account:${input.accountId.trim()}`] : []),
    ...(input.credentialSourceId?.trim()
      ? [`credential-source:${input.credentialSourceId.trim()}`]
      : []),
    ...(input.credentialSecret?.trim()
      ? [`credential-secret:${input.credentialSecret.trim()}`]
      : [])
  ]
  if (parts.length === 0) {
    parts.push(`provider-config:${input.providerId.trim() || 'default'}`)
  }
  return `scrypt-v1:${credentialIdentityDigest(parts.join('\n'))}`
}

export function priorItemsForDelegatedTurn(
  items: readonly TurnItem[],
  currentTurnId: string
): TurnItem[] {
  const prior = items.filter((item) =>
    item.turnId !== currentTurnId && item.kind !== 'runtime_context_source'
  )
  const priorGoalKeys = new Set(
    prior
      .filter((item): item is Extract<TurnItem, { kind: 'goal_context' }> => item.kind === 'goal_context')
      .map((item) => item.goalKey ?? item.id)
  )
  // A native provider session does not yet contain a newly materialized goal
  // generation. Include that first current-turn record so prepare() rebases
  // safely. For later turns of the same generation, the one thread-level
  // context is already in `prior`; omitting it preserves native resumption.
  // Other current-turn items remain omitted because the live user request is
  // sent separately by each delegated runtime.
  return [
    ...prior,
    ...items.filter((item) =>
      item.turnId === currentTurnId &&
      item.kind === 'goal_context' &&
      !priorGoalKeys.has(item.goalKey ?? item.id)
    )
  ]
}

function toParkedSession(
  binding: DelegatedSessionBinding,
  parkedAt: string
): ParkedSession {
  return {
    key: delegatedRouteKey(binding),
    providerKind: binding.providerKind,
    providerId: binding.providerId,
    credentialIdentity: binding.credentialIdentity,
    workspace: binding.workspace,
    model: binding.model,
    capabilityFingerprint: binding.capabilityFingerprint,
    continuationMode: binding.continuationMode,
    ...(binding.nativeSessionId ? { nativeSessionId: binding.nativeSessionId } : {}),
    synchronizedHistoryDigest: binding.synchronizedHistoryDigest,
    ...(binding.priorItemCount !== undefined
      ? { priorItemCount: binding.priorItemCount }
      : {}),
    lastCommittedTurnId: binding.lastCommittedTurnId,
    ...(binding.handoffBriefDigest
      ? { handoffBriefDigest: binding.handoffBriefDigest }
      : {}),
    parkedAt
  }
}

/**
 * Bound the parked list to the newest PARKED_SESSION_LIMIT entries younger
 * than PARKED_SESSION_TTL_MS. Later duplicates of the same route key replace
 * earlier ones. Returns the retained list plus every evicted entry so the
 * caller can remove their provider-state directories.
 */
function pruneParked(
  list: readonly ParkedSession[],
  nowIso: string
): { kept: ParkedSession[]; evicted: ParkedSession[] } {
  const byKey = new Map<string, ParkedSession>()
  for (const entry of list) {
    byKey.delete(entry.key)
    byKey.set(entry.key, entry)
  }
  const cutoff = Date.parse(nowIso) - PARKED_SESSION_TTL_MS
  const fresh: ParkedSession[] = []
  const evicted: ParkedSession[] = []
  for (const entry of byKey.values()) {
    const parkedAtMs = Date.parse(entry.parkedAt)
    if (Number.isFinite(parkedAtMs) && parkedAtMs >= cutoff) {
      fresh.push(entry)
    } else {
      evicted.push(entry)
    }
  }
  const overflow = Math.max(0, fresh.length - PARKED_SESSION_LIMIT)
  return {
    kept: fresh.slice(overflow),
    evicted: [...evicted, ...fresh.slice(0, overflow)]
  }
}

function sameRoute(
  binding: DelegatedSessionBinding,
  route: DelegatedSessionRoute
): boolean {
  return binding.providerKind === route.providerKind &&
    binding.providerId === route.providerId &&
    binding.credentialIdentity === route.credentialIdentity &&
    binding.workspace === route.workspace &&
    binding.model === route.model &&
    binding.capabilityFingerprint === route.capabilityFingerprint &&
    binding.continuationMode === route.continuationMode
}

function rebaseReason(
  binding: DelegatedSessionBinding | null,
  route: DelegatedSessionRoute,
  historyDigest: string
): DelegatedSessionPreparation['rebaseReason'] {
  if (!binding) return 'new'
  if (
    binding.providerKind !== route.providerKind ||
    binding.providerId !== route.providerId ||
    binding.credentialIdentity !== route.credentialIdentity ||
    binding.workspace !== route.workspace ||
    binding.model !== route.model ||
    binding.continuationMode !== route.continuationMode
  ) return 'route_changed'
  if (binding.capabilityFingerprint !== route.capabilityFingerprint) {
    return 'capabilities_changed'
  }
  if (binding.synchronizedHistoryDigest !== historyDigest) return 'history_changed'
  return 'native_state_unavailable'
}

function digestItem(item: TurnItem): unknown {
  const {
    createdAt: _createdAt,
    finishedAt: _finishedAt,
    ...semantic
  } = item
  return semantic
}

function credentialIdentityDigest(value: string): string {
  return scryptSync(value, 'kun-delegated-session-credential-identity-v1', 32).toString('hex')
}

function validNativeSessionId(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized && normalized.length <= MAX_NATIVE_SESSION_ID_LENGTH
    ? normalized
    : undefined
}

export function delegatedSessionRoot(dataDir: string): string {
  return resolve(dataDir, 'delegated-sessions')
}
