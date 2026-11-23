import type { RemoteApi } from '@kun/remote-protocol'
import type { MobileLinkStatus } from '../../shared/mobile-link'

export const PHONE_PAIRING_INTERVAL_MS = 2000

type Pairing = MobileLinkStatus['pairings'][number]

/**
 * The local phone switch is this computer's consent, so a signed-in phone pairs from
 * its own side without a second dialog here. Locally revoked controllers stay manual,
 * and a failed confirm keeps access closed and retries on the next poll.
 */
export class PhonePairingApproval {
  private generation = 0
  private timer?: ReturnType<typeof setInterval>
  private approved = new Set<string>()
  reset() {
    ++this.generation
    clearInterval(this.timer); this.timer = undefined
    this.approved.clear()
  }
  watch(api: RemoteApi, canApprove: (peer: string) => boolean, changed: () => Promise<unknown>) {
    this.reset()
    const generation = this.generation, alive = () => generation === this.generation
    let pending = false
    const poll = async () => {
      if (!alive() || pending) return
      pending = true
      try {
        const { pairings } = await api.request<{ pairings: Pairing[] }>('/pairings')
        if (!alive()) return
        const eligible = pairings.slice(0, 16).filter(
          pairing => pairing.purpose !== 'desktop' && !this.approved.has(pairing.id) &&
            /^[a-f0-9-]{36}$/.test(pairing.id) && canApprove(pairing.controllerId)
        )
        for (const pairing of eligible) {
          if (!alive()) return
          await api.request('/pairings/' + pairing.id + '/confirm', 'POST')
          if (this.approved.size > 64) this.approved.clear()
          this.approved.add(pairing.id)
          if (!alive()) return
          await changed()
        }
      } catch { /* Transient failures retry on the next poll; access stays fail-closed. */ }
      finally { pending = false }
    }
    this.timer = setInterval(() => void poll(), PHONE_PAIRING_INTERVAL_MS)
    this.timer.unref?.()
    void poll()
  }
}

/** Computer pairings stay behind the computer switch; phone pairings follow the phone switch. */
export function visiblePairings(
  pairings: Pairing[], computers: boolean, phones: boolean, denied: ReadonlySet<string>
) {
  return pairings.filter(pairing => denied.has(pairing.controllerId) ||
    !(pairing.purpose === 'desktop' ? computers : phones))
}
