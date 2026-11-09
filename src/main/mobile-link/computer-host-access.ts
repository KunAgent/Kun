import type { RemoteApi } from '@kun/remote-protocol'
import type { MobileLinkStatus } from '../../shared/mobile-link'
import { ComputerMembershipLease, computerMembershipError } from '../computer-access/membership'

/** Optional server extension. Legacy deployments and phone grants keep their original routes. */
export class ComputerHostAccess {
  active = false
  private membership?: ComputerMembershipLease
  reset() { this.active = false; this.membership?.invalidate(); this.membership = undefined }
  current() { return this.active && this.membership?.current() === true }
  async requireMax() { if (!this.membership) throw computerMembershipError(); await this.membership.require(true) }
  async renew() { try { await this.requireMax(); return this.current() } catch { return false } }
  async advertise(api: RemoteApi, enabled: boolean, required = false, owner?: string) {
    if (!enabled) this.reset()
    try {
      if (enabled) {
        if (!owner) throw Error('ACCOUNT_CHANGED')
        this.membership?.invalidate()
        this.membership = new ComputerMembershipLease(owner, () => api.entitlements())
        await this.requireMax()
        const caps = await api.request('/capabilities')
        if (caps.desktop?.computerAccess !== true) throw Error('COMPUTER_SERVER_UPDATE_REQUIRED')
      }
      await api.request('/desktop/host', 'PUT', { enabled })
      this.active = enabled
    } catch (error) { this.active = false; if (required) throw error }
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
