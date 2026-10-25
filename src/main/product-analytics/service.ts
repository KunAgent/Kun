import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { ArtAccountAccess } from '../art-assets/account-access'
import { AnalyticsInput, AnalyticsEvent, ANALYTICS_LIMITS, type AnalyticsState } from '../../shared/product-analytics'
import { AnalyticsHttpError, AnalyticsTransport, type AnalyticsSession } from './transport'
import type { AnalyticsStorage, AnalyticsDiskState } from './storage'

type RuntimeResponse = { ok: boolean; status?: number; body: string }
type Runtime = (path: string, method?: string, body?: string) => Promise<RuntimeResponse>
const Pending = AnalyticsInput.extend({ eventId: z.string().uuid(), occurredAt: z.string().datetime() })
function legacyLeaseRequired(response: RuntimeResponse): boolean {
  if (response.ok || response.status !== 400) return false
  try {
    const error = z.object({ code: z.literal('validation_error'), details: z.array(z.object({
      code: z.literal('unrecognized_keys'), keys: z.array(z.string()), path: z.array(z.unknown())
    })) }).parse(JSON.parse(response.body))
    return error.details.length === 1 && error.details[0].path.length === 0 &&
      error.details[0].keys.length === 1 && error.details[0].keys[0] === 'workAnalyticsVersion'
  } catch { return false }
}
export class ProductAnalyticsService {
  private state?: AnalyticsDiskState
  private loading?: Promise<void>
  private lane = Promise.resolve()
  private timer?: ReturnType<typeof setInterval>
  private unsubscribe?: () => void
  private session?: AnalyticsSession
  private abort = new AbortController()
  private available = false
  private nextAttempt = 0
  private failures = 0
  private busy = false
  private identitySync?: Promise<void>
  private generation = 0
  private disposed = false
  private cleanupTimer?: ReturnType<typeof setTimeout>
  private cleanupBusy = false
  constructor(private readonly deps: { storage: AnalyticsStorage; transport: AnalyticsTransport; account: ArtAccountAccess;
    runtime: Runtime; appVersion: string; platform: 'macos' | 'windows' | 'linux' }) {}
  private async load() {
    this.loading ??= this.deps.storage.read().then(s => { this.state = s })
    await this.loading
  }
  private async mutate(change: (s: AnalyticsDiskState) => void) {
    const run = this.lane.then(async () => { await this.load(); change(this.state!); await this.deps.storage.write(this.state!) })
    this.lane = run.catch(() => {}); await run
  }
  captureEpoch(): string | null { return this.state?.enabled ? this.state.epoch : null }
  async getState(): Promise<AnalyticsState> {
    await this.load()
    if (this.state!.pendingRuntimeClear) void this.clearRuntimeQueue()
    if (this.state!.enabled) { await this.synchronizeIdentity(); this.start() }
    return { epoch: this.state!.epoch, enabled: this.state!.enabled, installation: this.state!.installation, available: this.available, guidance: false }
  }
  async setEnabled(enabled: boolean): Promise<AnalyticsState> {
    this.generation++; this.abort.abort(); this.abort = new AbortController()
    if (this.state) { this.state.enabled = false; this.state.events = [] }
    const previous = this.session; this.session = undefined
    if (this.timer) clearInterval(this.timer); this.timer = undefined
    this.unsubscribe?.(); this.unsubscribe = undefined
    if (previous) void this.deps.transport.revoke(previous)
    try {
      await this.mutate(s => { s.pendingRuntimeClear = s.pendingRuntimeClear ?? s.epoch; s.enabled = enabled; s.events = []; s.actor = null; s.epoch = randomUUID();
        s.installationId = enabled ? randomUUID() : null })
    } catch (error) {
      if (this.state) { this.state.enabled = false; this.state.events = [] }
      throw error
    }
    this.available = false; this.nextAttempt = 0; this.failures = 0
    void this.clearRuntimeQueue()
    if (enabled) this.start()
    return this.getState()
  }
  private async clearRuntimeQueue() {
    if (this.cleanupBusy || this.disposed || !this.state?.pendingRuntimeClear) return
    this.cleanupBusy = true
    const expectedEpoch = this.state.pendingRuntimeClear
    try {
      const result = await this.deps.runtime('/v1/product-analytics/lease', 'POST', JSON.stringify({ epoch: null, expectedEpoch }))
      if (result.ok) await this.mutate(s => { if (s.pendingRuntimeClear === expectedEpoch) s.pendingRuntimeClear = null })
    } catch { /* Retry only this explicit pending cleanup, never enable capture. */ }
    finally {
      this.cleanupBusy = false
      if (!this.disposed && this.state?.pendingRuntimeClear && !this.cleanupTimer) {
        this.cleanupTimer = setTimeout(() => { this.cleanupTimer = undefined; void this.clearRuntimeQueue() }, 60_000)
        this.cleanupTimer.unref?.()
      }
    }
  }
  private start() {
    if (this.timer || this.disposed) return
    this.unsubscribe = this.deps.account.onState(() => { void this.synchronizeIdentity().catch(() => {}) })
    this.timer = setInterval(() => { void this.flush() }, 15_000); this.timer.unref?.()
    void this.flush()
  }
  private synchronizeIdentity() {
    return this.identitySync ??= this.updateIdentity().finally(() => { this.identitySync = undefined })
  }
  private async updateIdentity() {
    if (!this.state?.enabled || this.disposed) return
    const generation = this.generation
    const account = await this.deps.account.getState()
    if (generation !== this.generation || !this.state?.enabled) return
    const actor = account.user?.id ? 'u:' + account.user.id : 'anonymous'
    if (this.state.actor === actor) return
    this.generation++; this.abort.abort(); this.abort = new AbortController()
    const previous = this.session; this.session = undefined
    if (previous) void this.deps.transport.revoke(previous)
    await this.mutate(s => { if (!s.enabled) return; s.actor = actor; s.epoch = randomUUID(); s.events = actor === 'anonymous' ? [] : [{
      eventId: randomUUID(), occurredAt: new Date().toISOString(), name: 'account_session_ready', properties: {},
      schemaVersion: 1, surface: 'desktop', sessionId: s.epoch, appVersion: this.deps.appVersion, platform: this.deps.platform, observation: 'ui'
    }] })
    this.nextAttempt = 0
    await this.deps.runtime('/v1/product-analytics/lease', 'POST', JSON.stringify({ epoch: null })).catch(() => {})
  }
  async track(input: AnalyticsInput, expectedEpoch?: string) {
    const parsed = AnalyticsInput.safeParse(input); if (!parsed.success) return
    await this.load(); if (!this.state?.enabled || this.disposed) return
    await this.synchronizeIdentity()
    const epoch = this.state.epoch
    if (expectedEpoch !== undefined && expectedEpoch !== epoch) return
    await this.mutate(s => {
      if (!s.enabled || s.epoch !== epoch) return
      const event = AnalyticsEvent.parse({ ...parsed.data, eventId: randomUUID(), occurredAt: new Date().toISOString(),
        schemaVersion: 1, surface: 'desktop', sessionId: epoch, appVersion: this.deps.appVersion,
        platform: this.deps.platform, observation: 'ui' })
      s.events = [...s.events.filter(e => Date.now() - Date.parse(e.occurredAt) < ANALYTICS_LIMITS.ageMs), event].slice(-1000)
    })
  }
  private async collectRuntime(epoch: string) {
    // Old Runtime rejects this additive capability. Fall back to its original lease
    // so Code/Room collection remains available during staggered upgrades.
    let lease = await this.deps.runtime('/v1/product-analytics/lease', 'POST', JSON.stringify({ epoch, workAnalyticsVersion: 1 }))
    if (legacyLeaseRequired(lease)) lease = await this.deps.runtime('/v1/product-analytics/lease', 'POST', JSON.stringify({ epoch }))
    if (!lease.ok || this.state?.epoch !== epoch || !this.state?.enabled) return
    const response = await this.deps.runtime('/v1/product-analytics')
    if (!response.ok || this.state?.epoch !== epoch) return
    const pending = z.object({ epoch: z.string().nullable(), events: z.array(Pending).max(1000) }).parse(JSON.parse(response.body))
    if (pending.epoch !== epoch) return
    const events = pending.events.slice(0, 50)
    await this.mutate(s => {
      if (!s.enabled || s.epoch !== epoch) return
      const ids = new Set(s.events.map(e => e.eventId))
      for (const e of events) if (!ids.has(e.eventId)) s.events.push({ ...e, schemaVersion: 1, surface: 'execution_host',
        sessionId: epoch, appVersion: this.deps.appVersion, platform: this.deps.platform, observation: 'runtime' })
      s.events = s.events.filter(e => Date.now() - Date.parse(e.occurredAt) < ANALYTICS_LIMITS.ageMs).slice(-1000)
    })
    if (this.state?.enabled && this.state.epoch === epoch) await this.deps.runtime('/v1/product-analytics/ack', 'POST',
      JSON.stringify({ epoch, ids: events.map(e => e.eventId) }))
  }
  async guidance(): Promise<boolean> {
    // This API is called only by an explicit user click. Legacy users may choose
    // the guide too; account eligibility must never turn a manual help entry into a login gate.
    try { return (await this.deps.transport.config()).guidanceEnabled } catch { return false }
  }
  async flush() {
    if (this.busy || this.disposed) return
    this.busy = true
    try {
      await this.load(); if (!this.state?.enabled) return
      await this.synchronizeIdentity()
      const epoch = this.state.epoch, generation = this.generation, signal = this.abort.signal
      // Local collection remains independent from cloud availability and reward tickets.
      await this.collectRuntime(epoch).catch(() => {})
      if (Date.now() < this.nextAttempt || generation !== this.generation || !this.state.enabled) return
      const config = await this.deps.transport.config(signal)
      if (generation !== this.generation) return
      this.available = config.collectionEnabled
      if (!config.collectionEnabled) { this.nextAttempt = Date.now() + 300_000; return }
      const account = await this.deps.account.getState()
      if ((account.user?.id ? 'u:' + account.user.id : 'anonymous') !== this.state.actor) return
      const token = account.user ? await this.deps.account.accessToken() : null
      if (account.user && !token) return
      if (generation !== this.generation || !this.state.enabled) return
      if (!this.session || Date.parse(this.session.expiresAt) <= Date.now()) {
        const session = await this.deps.transport.session(this.state.installationId!, token, signal)
        if (generation !== this.generation) { void this.deps.transport.revoke(session); return }
        this.session = session
      }
      if (token) this.session.headers = { Authorization: `Bearer ${token}` }
      const batch = this.state.events.filter(e => Date.now() - Date.parse(e.occurredAt) < ANALYTICS_LIMITS.ageMs
        && (e.properties.mode !== 'work' || config.workAnalyticsVersion === 1)).slice(0, ANALYTICS_LIMITS.batch)
      if (!batch.length) return
      const acknowledged = await this.deps.transport.send(this.session, batch, signal)
      await this.mutate(s => { if (s.enabled && s.epoch === epoch) s.events = s.events.filter(e => !acknowledged.includes(e.eventId)) })
      this.failures = 0; this.nextAttempt = 0
    } catch (error) {
      this.failures++
      const base = error instanceof AnalyticsHttpError ? error.retryMs : 15_000
      this.nextAttempt = Date.now() + Math.min(300_000, Math.max(base, 15_000 * 2 ** Math.min(this.failures, 5)))
      if (error instanceof AnalyticsHttpError && [401, 403, 404, 426, 501].includes(error.status)) {
        this.session = undefined; this.available = false; this.nextAttempt = Date.now() + 300_000
      }
    } finally { this.busy = false }
  }
  dispose() {
    this.disposed = true; this.generation++; this.abort.abort()
    if (this.timer) clearInterval(this.timer); if (this.cleanupTimer) clearTimeout(this.cleanupTimer); this.unsubscribe?.()
  }
}
