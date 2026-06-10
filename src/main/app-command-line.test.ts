import { beforeEach, describe, expect, it, vi } from 'vitest'

const appendSwitch = vi.fn()
const hasSwitch = vi.fn()

vi.mock('electron', () => ({
  app: {
    commandLine: {
      hasSwitch,
      appendSwitch
    }
  }
}))

describe('app command line bootstrap', () => {
  beforeEach(() => {
    appendSwitch.mockReset()
    hasSwitch.mockReset()
    hasSwitch.mockReturnValue(false)
    vi.resetModules()
  })

  it('enables Wayland IME switches on Linux', async () => {
    const { configureLinuxWaylandImeSwitches } = await import('./app-command-line')

    configureLinuxWaylandImeSwitches('linux')

    expect(appendSwitch).toHaveBeenCalledTimes(2)
    expect(appendSwitch).toHaveBeenNthCalledWith(1, 'ozone-platform-hint', 'auto')
    expect(appendSwitch).toHaveBeenNthCalledWith(2, 'enable-wayland-ime')
  })

  it('keeps user-provided switches unchanged', async () => {
    hasSwitch.mockImplementation((name: string) => name === 'ozone-platform-hint')
    const { configureLinuxWaylandImeSwitches } = await import('./app-command-line')

    configureLinuxWaylandImeSwitches('linux')

    expect(appendSwitch).toHaveBeenCalledTimes(1)
    expect(appendSwitch).toHaveBeenCalledWith('enable-wayland-ime')
  })

  it('does not add Wayland IME switches on other platforms', async () => {
    const { configureLinuxWaylandImeSwitches } = await import('./app-command-line')

    configureLinuxWaylandImeSwitches('win32')
    configureLinuxWaylandImeSwitches('darwin')

    expect(appendSwitch).not.toHaveBeenCalled()
  })
})
