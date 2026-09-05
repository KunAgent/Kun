import { afterEach, describe, expect, it, vi } from 'vitest'

const { effects, setMini } = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  setMini: vi.fn()
}))
vi.mock('react', () => ({
  useState: () => [false, setMini],
  useEffect: (effect: () => void | (() => void)) => effects.push(effect)
}))
import { useWindowMiniMode } from './use-window-mini-mode'

afterEach(() => {
  effects.length = 0
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

function MiniModeHarness() {
  let resolve!: (value: boolean) => void
  let notify!: (value: boolean) => void
  const unsubscribe = vi.fn()
  const state = new Promise<boolean>((done) => { resolve = done })
  vi.stubGlobal('window', { kunGui: {
    getWindowMiniMode: () => state,
    onWindowMiniMode: (handler: (value: boolean) => void) => {
      notify = handler
      return unsubscribe
    }
  } })
  useWindowMiniMode()
  const cleanup = effects[0]!()
  return { resolve, notify, cleanup, unsubscribe, state }
}

describe('useWindowMiniMode', () => {
  it('restores the current mini state after a renderer reload', async () => {
    const mounted = MiniModeHarness()
    mounted.resolve(true)
    await mounted.state
    expect(setMini).toHaveBeenCalledWith(true)
    mounted.cleanup?.()
    expect(mounted.unsubscribe).toHaveBeenCalledOnce()
  })

  it('keeps a newer toggle event when the initial query resolves late', async () => {
    const mounted = MiniModeHarness()
    mounted.notify(false)
    mounted.resolve(true)
    await mounted.state
    expect(setMini).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('ignores query results after unmount', async () => {
    const mounted = MiniModeHarness()
    mounted.cleanup?.()
    mounted.resolve(true)
    await mounted.state
    expect(setMini).not.toHaveBeenCalled()
  })
})
