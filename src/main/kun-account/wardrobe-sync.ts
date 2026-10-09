import type { KunAccountState } from '../../shared/kun-account'
import type { KunEconomyResult } from '../../shared/kun-account-economy'
import { EconomyError, economyErrorCode, type EconomyClient, type EconomyJson } from './economy-client'

export type RuntimeCall = (path: string, method?: string, body?: string) => Promise<{ ok: boolean; status: number; body: string }>
type Mirror = { wardrobe: unknown; revision: number; mode: 'account' }
type Activity = { runId: string; source: 'room' | 'code'; roomId?: string; threadId?: string; messageId?: string; sourceLabel?: string }

const LOCAL = new Set(['anonymous', 'expired', 'network', 'service', 'runtime'])
const ACCOUNT_PATH = '/v1/rooms/wardrobe/account'

/**
 * Keeps the runtime's wardrobe row in step with the Kun account. Signing in attaches the account
 * snapshot (and wears its look); signing out returns to the starter wardrobe. Finished turns queued
 * by the runtime are reported to the account, and every change made here writes the snapshot that
 * Kunserve answered with back into the mirror. Operations run one at a time.
 */
export class AccountWardrobeSync {
  private userId: string | null = null
  private attached = false
  private status?: KunAccountState['status']
  private chain: Promise<unknown> = Promise.resolve()
  private draining = false
  private timer?: ReturnType<typeof setInterval>
  private disabled = false

  constructor(private readonly deps: {
    economy: EconomyClient
    runtime: RuntimeCall
    log(message: string): void
    intervalMs?: number
  }) {}

  private run<T>(work: () => Promise<T>): Promise<T> {
    const next = this.chain.catch(() => undefined).then(work)
    this.chain = next.catch(() => undefined)
    return next
  }

  private async runtime(path: string, method = 'GET', body?: unknown): Promise<EconomyJson> {
    const response = await this.deps.runtime(path, method, body === undefined ? undefined : JSON.stringify(body))
      .catch(() => { throw new EconomyError('runtime') })
    if (!response.ok) {
      // A debug run keeps its local game and never mirrors an account.
      if (response.status === 409 && response.body.includes('wardrobe_local_debug')) this.disabled = true
      throw new EconomyError('runtime')
    }
    try { return JSON.parse(response.body) as EconomyJson } catch { throw new EconomyError('runtime') }
  }

  /** Signed in attaches once per user; signed out detaches; transient errors keep what is there. */
  accountChanged(state: KunAccountState): void {
    const previous = this.status
    this.status = state.status
    if (state.status === 'authenticated' && state.user) {
      if (this.userId === state.user.id) return
      this.userId = state.user.id
      this.attached = false
      void this.run(() => this.attach()).catch((error) => this.deps.log(`attach failed: ${economyErrorCode(error)}`))
      this.startTimer()
    } else if (state.status === 'anonymous' && previous !== 'anonymous') {
      this.userId = null
      this.attached = false
      this.stopTimer()
      void this.run(() => this.runtime(`${ACCOUNT_PATH}/detach`, 'POST', {}))
        .catch((error) => this.deps.log(`detach failed: ${economyErrorCode(error)}`))
    }
  }

  private startTimer(): void {
    if (this.timer) return
    this.timer = setInterval(() => { void this.tick() }, this.deps.intervalMs ?? 180_000)
    this.timer.unref?.()
  }
  private stopTimer(): void { clearInterval(this.timer); this.timer = undefined }
  private async tick(): Promise<void> {
    if (this.disabled) return this.stopTimer()
    await this.run(() => this.attached ? this.drain() : this.attach()).catch(() => undefined)
  }

  private async mirror(snapshot: EconomyJson, withLook: boolean): Promise<Mirror> {
    if (!this.userId) throw new EconomyError('anonymous')
    return await this.runtime(`${ACCOUNT_PATH}/attach`, 'POST', {
      userId: this.userId, wardrobe: snapshot.wardrobe, ...(withLook ? { look: snapshot.look ?? null } : {}) }) as Mirror
  }

  private async attach(): Promise<void> {
    if (this.disabled || !this.userId) return
    const userId = this.userId
    const snapshot = await this.deps.economy.wardrobe()
    if (this.userId !== userId) return
    await this.mirror(snapshot, true)
    this.attached = true
    // A first sign-in keeps the look already worn on this machine, as far as the account owns it.
    if (!snapshot.look) await this.pushLocalLook().catch(() => undefined)
    await this.drain()
  }

  private async pushLocalLook(): Promise<void> {
    const detail = await this.runtime('/v1/rooms/user-profile')
    const avatar = (detail.profile as { avatar?: { kind?: string; parts?: unknown } } | undefined)?.avatar
    if (avatar?.kind !== 'composed' || !avatar.parts) return
    await this.mirror(await this.deps.economy.setLook(avatar.parts as never), false)
  }

  /** Reports queued turns in order; a rule refusal drops that turn, an outage keeps the rest for later. */
  private async drain(): Promise<void> {
    const userId = this.userId
    if (!userId || !this.attached) return
    const listed = await this.runtime(`${ACCOUNT_PATH}/activity`) as { userId: string | null; activity: Activity[] }
    if (listed.userId !== userId || !listed.activity.length) return
    const runIds: string[] = [], drops: Array<{ runId: string; dropId: string }> = []
    let last: EconomyJson | null = null
    for (const entry of listed.activity) {
      const context = Object.fromEntries((['roomId', 'threadId', 'messageId', 'sourceLabel'] as const)
        .flatMap((key) => entry[key] ? [[key, entry[key]!]] : []))
      try {
        last = await this.deps.economy.activity({ runId: entry.runId, source: entry.source, context })
        runIds.push(entry.runId)
        const drop = last.counted ? (last.drop as { id?: string } | null) : null
        if (drop?.id) drops.push({ runId: entry.runId, dropId: drop.id })
      } catch (error) {
        if (LOCAL.has(economyErrorCode(error))) break
        runIds.push(entry.runId)
      }
    }
    if (!runIds.length || this.userId !== userId) return
    const snapshot = last ?? await this.deps.economy.wardrobe()
    await this.runtime(`${ACCOUNT_PATH}/activity/ack`, 'POST', { userId, runIds, drops, wardrobe: snapshot.wardrobe })
  }

  /** The renderer saw a queued turn; one report at a time is enough. */
  sync(): Promise<KunEconomyResult<null>> {
    if (!this.userId) return Promise.resolve({ ok: true, value: null })
    if (this.draining) return Promise.resolve({ ok: true, value: null })
    this.draining = true
    return this.run(() => this.attached ? this.drain() : this.attach())
      .then(() => ({ ok: true as const, value: null }), (error) => ({ ok: false as const, code: economyErrorCode(error) }))
      .finally(() => { this.draining = false })
  }

  /** Runs a change on the account and returns its answer with the mirror that now holds it. */
  change<T>(work: (economy: EconomyClient) => Promise<EconomyJson>, options: { look?: boolean } = {}): Promise<KunEconomyResult<T>> {
    return this.run(async () => {
      if (!this.userId) throw new EconomyError('anonymous')
      const result = await work(this.deps.economy)
      if (!result.wardrobe) return { ok: true as const, value: result as T }
      const mirror = await this.mirror(result, Boolean(options.look))
      const { wardrobe: _wardrobe, look: _look, revision: _revision, catalogVersion: _catalog, ...rest } = result
      return { ok: true as const, value: { ...rest, ...mirror } as T }
    }).catch((error) => ({ ok: false as const, code: economyErrorCode(error) }))
  }

  /** Reloads the mirror after a change that granted bottles without returning the wardrobe. */
  refresh(): Promise<void> {
    return this.run(async () => { if (this.userId && this.attached) await this.mirror(await this.deps.economy.wardrobe(), false) })
      .catch((error) => this.deps.log(`refresh failed: ${economyErrorCode(error)}`))
  }

  /** Reads that do not touch the wardrobe skip the queue. */
  read<T>(work: (economy: EconomyClient) => Promise<EconomyJson>): Promise<KunEconomyResult<T>> {
    if (!this.userId) return Promise.resolve({ ok: false, code: 'anonymous' })
    return work(this.deps.economy).then((value) => ({ ok: true as const, value: value as T }),
      (error) => ({ ok: false as const, code: economyErrorCode(error) }))
  }

  dispose(): void { this.stopTimer() }
}
