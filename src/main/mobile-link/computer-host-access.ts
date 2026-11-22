import type { RemoteApi } from '@kun/remote-protocol'
import { COMPUTER_MAX_REQUIRED } from '../../shared/computer-membership'
import type { MobileLinkStatus } from '../../shared/mobile-link'
import { ComputerMembershipLease, computerMembershipError } from '../computer-access/membership'

export const COMPUTER_PAIRING_INTERVAL_MS = 2000
export const COMPUTER_DESKTOP_SCOPES = ['desktop.view', 'desktop.control'] as const

/** Optional server extension. Legacy deployments and phone grants keep their original routes. */
export class ComputerHostAccess {
  constructor(private readonly desktopStatus?: () => Promise<{ ready: boolean; inputReady?: boolean; gameEnabled?: boolean } | undefined>) {}
  private reported?: string
  active = false
  downgraded = false
  private membership?: ComputerMembershipLease
  private generation = 0
  private timer?: ReturnType<typeof setInterval>
  private trigger?: () => void
  reset() {
    ++this.generation; this.reported = undefined
    clearInterval(this.timer); this.timer = undefined; this.trigger = undefined
    this.active = false; this.downgraded = false
    this.membership?.invalidate(); this.membership = undefined
  }
  poke() { this.trigger?.() }
  /** Only the explicit local host switch starts this, never the renderer's presence poll. */
  watch(api: RemoteApi, canPair: (peer: string) => boolean, changed: () => Promise<unknown>, lost?: (downgraded: boolean) => void) {
    clearInterval(this.timer)
    const generation = ++this.generation
    let pending = false, queued = false, nextReadinessCheck = 0
    const alive = () => generation === this.generation && this.active && Boolean(this.membership)
    const current = () => generation === this.generation && this.current()
    const poll = async () => {
      if (!alive()) return
      if (pending) { queued = true; return }
      pending = true
      try {
        const hadLease = this.current()
        if (this.membership!.remaining() < 10000) {
          if (!(await this.renew())) { if (generation === this.generation) lost?.(this.downgraded); return }
          if (!hadLease && current()) await changed()
        }
        if (!current()) return
        // Directory metadata is advisory and cannot enable access or renew a grant.
        const status = this.desktopStatus && Date.now() >= nextReadinessCheck ? await this.desktopStatus().catch(() => undefined) : undefined
        if (status && current()) {
          const readiness = !status.ready ? 'permission' : status.gameEnabled && status.inputReady ? 'game' : 'ready'
          if (this.reported !== readiness) {
            try {
              await api.request('/desktop/host', 'PUT', { readiness })
              if (current()) this.reported = readiness
            } catch { nextReadinessCheck = Date.now() + 60_000 }
          }
        }
        if (!current()) return
        const { pairings } = await api.request<{ pairings: MobileLinkStatus['pairings'] }>('/desktop/pairings')
        if (!current()) return
        const eligible = pairings.slice(0, 16).filter(
          pairing => pairing.purpose === 'desktop' && /^[a-f0-9-]{36}$/.test(pairing.id) && canPair(pairing.controllerId)
        )
        if (!eligible.length) return
        if (!(await this.renew())) { if (generation === this.generation) lost?.(this.downgraded); return }
        for (const pairing of eligible) {
          if (!current()) return
          await api.request('/desktop/pairings/' + pairing.id + '/confirm', 'POST')
          if (!current()) return
          await changed()
        }
      } catch { /* Transient failures retry on the next poll; membership remains fail-closed. */ }
      finally {
        pending = false
        if (queued && alive()) { queued = false; void poll() }
      }
    }
    this.trigger = () => void poll()
    this.timer = setInterval(() => void poll(), COMPUTER_PAIRING_INTERVAL_MS)
    this.timer.unref?.()
    void poll()
  }
  current() { return this.active && this.membership?.current() === true }
  async requireMax() {
    if (!this.membership) { this.downgraded = true; throw computerMembershipError() }
    try { await this.membership.require(true); this.downgraded = false }
    catch (error) { this.downgraded = (error as { code?: string })?.code === COMPUTER_MAX_REQUIRED; throw error }
  }
  async renew() { try { await this.requireMax(); return this.current() } catch { return false } }
  async advertise(api: RemoteApi, enabled: boolean, required = false, owner?: string) {
    this.reset()
    const generation = this.generation
    const current = () => { if (generation !== this.generation) throw Error('ACCOUNT_CHANGED') }
    try {
      if (enabled) {
        if (!owner) throw Error('ACCOUNT_CHANGED')
        this.membership?.invalidate()
        this.membership = new ComputerMembershipLease(owner, () => api.entitlements())
        await this.requireMax(); current()
        const caps = await api.request('/capabilities'); current()
        if (caps.desktop?.computerAccess !== true) throw Error('COMPUTER_SERVER_UPDATE_REQUIRED')
      }
      await api.request('/desktop/host', 'PUT', { enabled }); current()
      this.active = enabled
    } catch (error) { if (generation === this.generation) this.active = false; if (required) throw error }
  }
  async pairings(api: RemoteApi): Promise<{ pairings: MobileLinkStatus['pairings'] }> {
    const legacy = await api.request('/pairings')
    if (!this.active) return legacy
    const computers = await api.request('/desktop/pairings')
    return { pairings: [...legacy.pairings, ...computers.pairings] }
  }
  async grants(api: RemoteApi, signal?: AbortSignal): Promise<{ grants: MobileLinkStatus['grants'] }> {
    const legacy = await api.request('/grants', 'GET', undefined, false, signal)
    if (!this.active) return legacy
    const computers = await api.request('/desktop/grants', 'GET', undefined, false, signal)
    return { grants: [...legacy.grants, ...computers.grants] }
  }
}
