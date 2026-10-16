import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileLinkRecovery } from './recovery'

afterEach(() => vi.useRealTimers())
function fixture() {
  let online = true, network = 'network-a'
  let power!: (phase: 'suspend' | 'resume') => void
  const deps = { online: () => online, network: () => network, suspend: vi.fn(), reconnect: vi.fn(),
    power: (listener: typeof power) => { power = listener; return vi.fn() } }
  const recovery = new MobileLinkRecovery(deps)
  return { recovery, deps, power: (phase: 'suspend' | 'resume') => power(phase),
    online: (value: boolean) => { online = value }, network: (value: string) => { network = value } }
}
describe('desktop mobile power and network recovery', () => {
  it('does not disturb healthy connections on ordinary polls or an unreliable OS offline hint', async () => {
    vi.useFakeTimers()
    const f = fixture()
    try {
      await vi.advanceTimersByTimeAsync(60000)
      f.online(false)
      await vi.advanceTimersByTimeAsync(10000)
      expect(f.deps.reconnect).not.toHaveBeenCalled()
      expect(f.deps.suspend).not.toHaveBeenCalled()
      f.online(true)
      await vi.advanceTimersByTimeAsync(5000)
      expect(f.deps.reconnect).toHaveBeenCalledExactlyOnceWith('NETWORK_ONLINE')
    } finally { f.recovery.dispose() }
  })
  it('recovers once after an interface change and once after suspend/resume', async () => {
    vi.useFakeTimers()
    const f = fixture()
    try {
      f.network('network-b')
      await vi.advanceTimersByTimeAsync(5000)
      expect(f.deps.reconnect).toHaveBeenCalledExactlyOnceWith('NETWORK_CHANGED')
      f.power('suspend')
      expect(f.deps.suspend).toHaveBeenCalledOnce()
      f.network('network-c')
      await vi.advanceTimersByTimeAsync(5000)
      expect(f.deps.reconnect).toHaveBeenCalledOnce()
      f.power('resume')
      await vi.advanceTimersByTimeAsync(5000)
      expect(f.deps.reconnect.mock.calls.map(([code]) => code)).toEqual(['NETWORK_CHANGED', 'HOST_RESUMED'])
    } finally { f.recovery.dispose() }
  })
  it('detects a thirty-minute timer gap even if the platform resume event was missed', async () => {
    vi.useFakeTimers()
    const f = fixture()
    try {
      vi.setSystemTime(Date.now() + 30 * 60000)
      await vi.advanceTimersByTimeAsync(5000)
      expect(f.deps.reconnect).toHaveBeenCalledExactlyOnceWith('HOST_CLOCK_GAP')
      f.recovery.dispose()
      f.power('resume')
      await vi.advanceTimersByTimeAsync(30000)
      expect(f.deps.reconnect).toHaveBeenCalledOnce()
    } finally { f.recovery.dispose() }
  })
})
