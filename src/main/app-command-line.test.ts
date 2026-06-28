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

  it('enables Wayland IME switches on pure Wayland Linux sessions', async () => {
    const { configureLinuxWaylandImeSwitches } = await import('./app-command-line')

    configureLinuxWaylandImeSwitches('linux', { WAYLAND_DISPLAY: 'wayland-1' })

    expect(appendSwitch).toHaveBeenCalledTimes(3)
    expect(appendSwitch).toHaveBeenNthCalledWith(1, 'ozone-platform-hint', 'auto')
    expect(appendSwitch).toHaveBeenNthCalledWith(2, 'enable-wayland-ime')
    expect(appendSwitch).toHaveBeenNthCalledWith(3, 'wayland-text-input-version', '3')
  })

  it('keeps user-provided switches unchanged', async () => {
    hasSwitch.mockImplementation((name: string) => name === 'ozone-platform-hint')
    const { configureLinuxWaylandImeSwitches } = await import('./app-command-line')

    configureLinuxWaylandImeSwitches('linux', { WAYLAND_DISPLAY: 'wayland-1' })

    expect(appendSwitch).toHaveBeenCalledTimes(2)
    expect(appendSwitch).toHaveBeenNthCalledWith(1, 'enable-wayland-ime')
    expect(appendSwitch).toHaveBeenNthCalledWith(2, 'wayland-text-input-version', '3')
  })

  it('does not add Wayland IME switches on other platforms', async () => {
    const { configureLinuxWaylandImeSwitches } = await import('./app-command-line')

    configureLinuxWaylandImeSwitches('win32')
    configureLinuxWaylandImeSwitches('darwin')

    expect(appendSwitch).not.toHaveBeenCalled()
  })

  it('does not force Wayland switches on generic Linux or X11 sessions', async () => {
    const { configureLinuxWaylandImeSwitches } = await import('./app-command-line')

    configureLinuxWaylandImeSwitches('linux', {})
    configureLinuxWaylandImeSwitches('linux', { DISPLAY: ':0' })
    configureLinuxWaylandImeSwitches('linux', { DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-1' })

    expect(appendSwitch).not.toHaveBeenCalled()
  })

  it('supports explicit Linux Wayland IME opt-in and opt-out', async () => {
    const { configureLinuxWaylandImeSwitches } = await import('./app-command-line')

    configureLinuxWaylandImeSwitches('linux', { DISPLAY: ':0', KUN_LINUX_WAYLAND_IME: '1' })
    expect(appendSwitch).toHaveBeenCalledTimes(3)

    appendSwitch.mockReset()
    configureLinuxWaylandImeSwitches('linux', { WAYLAND_DISPLAY: 'wayland-1', KUN_LINUX_WAYLAND_IME: '0' })
    expect(appendSwitch).not.toHaveBeenCalled()
  })
})
