import type { RemoteApi } from '@kun/remote-protocol'
import type { MobileLinkStatus } from '../../shared/mobile-link'
import { PairingWatch } from './pairing-watch'

export { PAIRING_FALLBACK_MS as PHONE_PAIRING_INTERVAL_MS } from './pairing-watch'

type Pairing = MobileLinkStatus['pairings'][number]

/**
 * The local phone switch is this computer's consent, so a signed-in phone pairs from
 * its own side without a second dialog here. Locally revoked controllers stay manual,
 * and a failed confirm keeps access closed and retries on the next poll.
 */
export class PhonePairingApproval {
  private generation = 0
  private polling?: PairingWatch
  private approved = new Set<string>()
  reset() {
    ++this.generation
    this.polling?.stop(); this.polling = undefined
    this.approved.clear()
  }
  poke() { this.polling?.wake() }
  reconnect() { this.polling?.reconnect() }
  setCovered(covered: boolean) { this.polling?.setCovered(covered) }
  watch(api: RemoteApi, canApprove: (peer: string) => boolean, changed: () => Promise<unknown>) {
    this.reset()
    const generation = this.generation, alive = () => generation === this.generation
    this.polling = new PairingWatch(async () => {
      const { pairings } = await api.request<{ pairings: Pairing[] }>('/pairings')
      if (!alive()) return
      const eligible = pairings.slice(0, 16).filter(
        pairing => pairing.purpose !== 'desktop' && !this.approved.has(pairing.id) &&
          /^[a-f0-9-]{36}$/.test(pairing.id) && canApprove(pairing.controllerId)
      )
      for (const pairing of eligible) {
        if (!alive()) return
        if (!canApprove(pairing.controllerId)) continue
        await api.request('/pairings/' + pairing.id + '/confirm', 'POST')
        if (!alive()) return
        if (this.approved.size > 64) this.approved.clear()
        this.approved.add(pairing.id)
        await changed()
      }
    })
    this.polling.wake()
  }
}

/** Computer pairings stay behind the computer switch; phone pairings follow the phone switch. */
export function visiblePairings(
  pairings: Pairing[], computers: boolean, phones: boolean, denied: ReadonlySet<string>
) {
  return pairings.filter(pairing => denied.has(pairing.controllerId) ||
    !(pairing.purpose === 'desktop' ? computers : phones))
}
