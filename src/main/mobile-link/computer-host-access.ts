import type { RemoteApi } from '@kun/remote-protocol'
import { COMPUTER_MAX_REQUIRED } from '../../shared/computer-membership'
import type { MobileLinkStatus } from '../../shared/mobile-link'
import { ComputerMembershipLease, computerMembershipError } from '../computer-access/membership'

import { PairingWatch } from './pairing-watch'

export { PAIRING_FALLBACK_MS as COMPUTER_PAIRING_INTERVAL_MS } from './pairing-watch'
export const COMPUTER_DESKTOP_SCOPES = ['desktop.view', 'desktop.control'] as const

/** Optional server extension. Legacy deployments and phone grants keep their original routes. */
export class ComputerHostAccess {
  constructor(private readonly desktopStatus?: () => Promise<{ ready: boolean; inputReady?: boolean; gameEnabled?: boolean } | undefined>) {}
  private reported?: string
  active = false
  downgraded = false
  private membership?: ComputerMembershipLease
  private generation = 0
  private maintenance?: ReturnType<typeof setTimeout>
  private polling?: PairingWatch
  reset() {
    ++this.generation; this.reported = undefined
    clearTimeout(this.maintenance); this.maintenance = undefined
    this.polling?.stop(); this.polling = undefined
    this.active = false; this.downgraded = false
    this.membership?.invalidate(); this.membership = undefined
  }
  poke() { this.polling?.wake() }
  reconnect() { this.polling?.reconnect() }
  setCovered(covered: boolean) { this.polling?.setCovered(covered) }
  /** Background approvals belong to the explicit local host switch. */
  watch(api: RemoteApi, canPair: (peer: string) => boolean, changed: () => Promise<unknown>, lost?: (downgraded: boolean) => void) {
    this.polling?.stop()
    clearTimeout(this.maintenance)
    const generation = ++this.generation
    if (!this.active || !this.membership) return
    const alive = () => generation === this.generation && this.active
    const current = () => alive() && this.current()
    this.polling = new PairingWatch(async () => {
      if (!current()) return
      const { pairings } = await api.request<{ pairings: MobileLinkStatus['pairings'] }>('/desktop/pairings')
      if (!current()) return
      const eligible = pairings.slice(0, 16).filter(
        pairing => pairing.purpose === 'desktop' && /^[a-f0-9-]{36}$/.test(pairing.id) && canPair(pairing.controllerId)
      )
      if (!eligible.length) return
      if (!(await this.renew())) { if (alive()) lost?.(this.downgraded); return }
      for (const pairing of eligible) {
        if (!current()) return
        if (!canPair(pairing.controllerId)) continue
        await api.request('/desktop/pairings/' + pairing.id + '/confirm', 'POST')
        if (!current()) return
        await changed()
      }
    })
    let nextReadinessCheck = 0
    const maintain = async () => {
      if (!alive()) return
      try {
        const hadLease = this.current()
        if (!(await this.renewIfDue())) { if (alive()) lost?.(this.downgraded); return }
        if (!current()) return
        if (!hadLease) { this.poke(); await changed() }
        if (!current() || !this.desktopStatus || Date.now() < nextReadinessCheck) return
        const status = await this.desktopStatus()
        if (!current() || !status) return
        const readiness = !status.ready ? 'permission' : status.gameEnabled && status.inputReady ? 'game' : 'ready'
        if (this.reported !== readiness) {
          await api.request('/desktop/host', 'PUT', { readiness })
          if (current()) this.reported = readiness
        }
      } catch {
        nextReadinessCheck = Date.now() + 60_000
      } finally {
        if (alive()) {
          // Membership keeps its own hard 30s deadline, even on a quiet relay.
          this.maintenance = setTimeout(() => void maintain(), 8000)
          this.maintenance.unref?.()
        }
      }
    }
    this.polling.wake()
    void maintain()
  }
  async renewIfDue() {
    return (this.membership?.remaining() ?? 0) > 10000 || this.renew()
  }
  current() { return this.active && this.membership?.current() === true }
  async requireMax() {
    const membership = this.membership
    if (!membership) { this.downgraded = true; throw computerMembershipError() }
    try {
      await membership.require(true)
      if (membership !== this.membership) throw Error('ACCOUNT_CHANGED')
      this.downgraded = false
    } catch (error) {
      if (membership === this.membership) this.downgraded = (error as { code?: string })?.code === COMPUTER_MAX_REQUIRED
      throw error
    }
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
