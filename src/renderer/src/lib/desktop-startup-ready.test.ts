import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopStartupPhase, DesktopStartupStatePayload } from '@shared/desktop-startup-state'
import { whenDesktopStartupReady } from './desktop-startup-ready'

function stubStartup(initial: DesktopStartupPhase) {
  let handler: ((payload: DesktopStartupStatePayload) => void) | undefined
  const unsubscribe = vi.fn()
  const startup = {
    getState: vi.fn(async () => ({ phase: initial })),
    onState: vi.fn((next: (payload: DesktopStartupStatePayload) => void) => { handler = next; return unsubscribe })
  }
  vi.stubGlobal('window', { kunGui: { startup } })
  return { startup, unsubscribe, push: (phase: DesktopStartupPhase) => handler?.({ phase }) }
}
const settle = async (): Promise<void> => { for (let index = 0; index < 4; index += 1) await Promise.resolve() }

describe('whenDesktopStartupReady', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('resolves at once where there is no desktop startup channel', async () => {
    vi.stubGlobal('window', { kunGui: {} })
    await expect(whenDesktopStartupReady()).resolves.toBeUndefined()
  })

  it('waits through the startup phases and resolves when the main process reports ready', async () => {
    const { push, unsubscribe } = stubStartup('services_starting')
    const ready = vi.fn()
    void whenDesktopStartupReady().then(ready)
    await settle()
    expect(ready).not.toHaveBeenCalled()
    push('runtime_starting')
    await settle()
    expect(ready).not.toHaveBeenCalled()
    push('ready')
    await settle()
    expect(ready).toHaveBeenCalledTimes(1)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('resolves when the desktop was already ready before the renderer asked', async () => {
    stubStartup('ready')
    await expect(whenDesktopStartupReady()).resolves.toBeUndefined()
  })

  it('never resolves when startup ends in recovery, and survives an unreadable state', async () => {
    const { push, startup } = stubStartup('recovery_required')
    startup.getState.mockRejectedValueOnce(new Error('no handler'))
    const ready = vi.fn()
    void whenDesktopStartupReady().then(ready)
    push('recovery_required')
    await settle()
    expect(ready).not.toHaveBeenCalled()
  })
})
