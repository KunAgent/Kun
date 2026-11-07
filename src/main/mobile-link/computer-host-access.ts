import type { RemoteApi } from '@kun/remote-protocol'
import type { MobileLinkStatus } from '../../shared/mobile-link'

/** Optional server extension. Legacy deployments and phone grants keep their original routes. */
export class ComputerHostAccess {
  active = false
  reset() { this.active = false }
  async advertise(api: RemoteApi, enabled: boolean, required = false) {
    try {
      if (enabled) {
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
