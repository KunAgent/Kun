import { afterEach, describe, expect, it, vi } from 'vitest'

// Exercise the loader's public factory with both bundler and native-ESM shapes.
describe('terminal screen module interop', () => {
  afterEach(() => {
    vi.doUnmock('@xterm/headless')
    vi.doUnmock('@xterm/addon-serialize')
    vi.resetModules()
  })

  function dependencies(headlessShape: string, addonShape: string) {
    const dispose = vi.fn()
    class Terminal {
      write(_data: string, callback?: () => void) { callback?.() }
      resize() {}
      dispose = dispose
      loadAddon() {}
    }
    class SerializeAddon { serialize() { return 'screen state' } }
    const namespace = (name: string, value: unknown, shape: string) => ({
      [name]: shape === 'named' ? value : undefined,
      default: shape === 'default' ? { [name]: value } : undefined
    })
    vi.doMock('@xterm/headless', () => namespace('Terminal', Terminal, headlessShape))
    vi.doMock('@xterm/addon-serialize', () => namespace('SerializeAddon', SerializeAddon, addonShape))
    return { dispose }
  }

  for (const headless of ['named', 'default']) {
    for (const addon of ['named', 'default']) {
      it(`loads ${headless} Terminal with ${addon} SerializeAddon`, async () => {
        dependencies(headless, addon)
        const { loadTerminalScreens } = await import('./screen')
        const factory = await loadTerminalScreens()
        expect(factory.fullScreen).toBe(true)
        const screen = factory.create(80, 24)
        try {
          screen.write('hello')
          expect(await screen.capture()).toBe('screen state')
        } finally { screen.dispose() }
      })
    }
  }

  it.each(['headless', 'addon'])('safely degrades when %s cannot be imported', async missing => {
    dependencies('named', 'named')
    vi.doMock(missing === 'headless' ? '@xterm/headless' : '@xterm/addon-serialize', () => {
      throw new Error('dependency unavailable')
    })
    const { loadTerminalScreens } = await import('./screen')
    const factory = await loadTerminalScreens()
    expect(factory.fullScreen).toBe(false)
    const screen = factory.create(80, 24)
    screen.write('hello')
    expect(await screen.capture()).toContain('hello')
    screen.dispose()
  })

  it.each(['headless', 'addon'])('does not advertise full-screen support for missing %s constructors', async missing => {
    dependencies(missing === 'headless' ? 'missing' : 'named', missing === 'addon' ? 'missing' : 'named')
    const { loadTerminalScreens } = await import('./screen')
    expect((await loadTerminalScreens()).fullScreen).toBe(false)
  })

  it('disposes a terminal if loading its serializer fails', async () => {
    const { dispose } = dependencies('default', 'default')
    vi.doMock('@xterm/addon-serialize', () => ({
      SerializeAddon: undefined,
      default: { SerializeAddon: class { constructor() { throw new Error('addon failed') } } }
    }))
    const { loadTerminalScreens } = await import('./screen')
    const factory = await loadTerminalScreens()
    expect(() => factory.create(80, 24)).toThrow('addon failed')
    expect(dispose).toHaveBeenCalledOnce()
  })
})
