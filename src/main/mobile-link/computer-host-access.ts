import type { RemoteApi } from '@kun/remote-protocol'
import type { MobileLinkStatus } from '../../shared/mobile-link'
import { ComputerMembershipLease, computerMembershipError } from '../computer-access/membership'

export const COMPUTER_PAIRING_INTERVAL_MS = 2000
export const COMPUTER_DESKTOP_SCOPES = ['desktop.view', 'desktop.control'] as const

/** Optional server extension. Legacy deployments and phone grants keep their original routes. */
export class ComputerHostAccess {
  active = false
  private membership?: ComputerMembershipLease
  private generation = 0
  private timer?: ReturnType<typeof setInterval>
  reset() {
    ++this.generation
    clearInterval(this.timer); this.timer = undefined
    this.active = false; this.membership?.invalidate(); this.membership = undefined
  }
  /** Only the explicit local host switch starts this, never the renderer's presence poll. */
  watch(api: RemoteApi, canPair: (peer: string) => boolean, changed: () => Promise<unknown>) {
    clearInterval(this.timer)
    const generation = ++this.generation
    let pending = false
    const current = () => generation === this.generation && this.current()
    const poll = async () => {
      if (pending || !current()) return
      pending = true
      try {
        const { pairings } = await api.request<{ pairings: MobileLinkStatus['pairings'] }>('/desktop/pairings')
        if (!current() || !pairings.length) return
        await this.requireMax()
        for (const pairing of pairings.slice(0, 16)) {
          if (!current()) return
          if (pairing.purpose !== 'desktop' || !/^[a-f0-9-]{36}$/.test(pairing.id) || !canPair(pairing.controllerId)) continue
          await api.request('/desktop/pairings/' + pairing.id + '/confirm', 'POST')
          if (!current()) return
          await changed()
        }
      } catch { /* Transient failures retry on the next poll; membership remains fail-closed. */ }
      finally { pending = false }
    }
    this.timer = setInterval(() => void poll(), COMPUTER_PAIRING_INTERVAL_MS)
    this.timer.unref?.()
    void poll()
  }
  current() { return this.active && this.membership?.current() === true }
  async requireMax() { if (!this.membership) throw computerMembershipError(); await this.membership.require(true) }
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
