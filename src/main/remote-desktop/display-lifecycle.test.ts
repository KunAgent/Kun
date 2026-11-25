import { beforeEach, expect, it, vi } from 'vitest'
import type { DesktopEngineDependencies } from './session-service'

const f = vi.hoisted(() => {
  const stop = vi.fn(async () => {})
  return {
    screenEvents: new Map<string, (...args: any[]) => void>(),
    powerEvents: new Map<string, (...args: any[]) => void>(),
    stop,
    desktop: vi.fn((_deps: DesktopEngineDependencies) => ({ stopAll: stop }))
  }
})
vi.mock('electron', () => ({
  screen: { on: (name: string, handler: (...args: any[]) => void) => f.screenEvents.set(name, handler) },
  powerMonitor: { on: (name: string, handler: (...args: any[]) => void) => f.powerEvents.set(name, handler) }
}))
vi.mock('../control-host/runtime-host', () => ({ controlRuntimeHost: () => ({ desktop: f.desktop }), stopControlRuntimeHost: vi.fn() }))
vi.mock('./capture-host', () => ({ ElectronDesktopCapture: vi.fn(), displayFingerprint: vi.fn() }))
vi.mock('./native-input', () => ({ NativeDesktopInput: vi.fn(), desktopHelperAvailable: () => true }))
vi.mock('../services/computer-use-permissions', () => ({ getComputerUsePermissions: vi.fn() }))
vi.mock('./indicator', () => ({ DesktopShareIndicator: vi.fn() }))
vi.mock('../computer-access/lifecycle', () => ({ stopComputerSessions: vi.fn() }))
vi.mock('../logger', () => ({ logInfo: vi.fn() }))
import { createDesktopEngine } from './engine'
import { logInfo } from '../logger'

beforeEach(() => {
  f.screenEvents.clear(); f.powerEvents.clear(); f.stop.mockClear(); vi.mocked(logInfo).mockReset()
  createDesktopEngine(async () => [], async () => {})
})
it.each(['win32', 'linux', 'darwin'] as const)('uses the macOS lock-state preflight only on its native platform (%s)', platform => {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!
  try {
    Object.defineProperty(process, 'platform', { value: platform })
    createDesktopEngine(async () => [], async () => {})
    const deps = f.desktop.mock.lastCall![0]
    expect(typeof deps.lockState === 'function').toBe(platform === 'darwin')
    f.powerEvents.get('lock-screen')!()
    expect(f.stop).toHaveBeenCalledExactlyOnceWith('host_inactive')
  } finally { Object.defineProperty(process, 'platform', original) }
})
it('keeps an incoming desktop session alive when only the available work area changes', () => {
  f.screenEvents.get('display-metrics-changed')!({}, {}, ['workArea'])
  expect(f.stop).not.toHaveBeenCalled()
})
it.each(['bounds', 'scaleFactor', 'rotation'])('ends the session when display %s changes', metric => {
  f.screenEvents.get('display-metrics-changed')!({}, {}, ['workArea', metric])
  expect(f.stop).toHaveBeenCalledExactlyOnceWith('display_changed')
})
it('ends the session on display removal', () => {
  f.screenEvents.get('display-removed')!({}, {})
  expect(f.stop).toHaveBeenCalledExactlyOnceWith('display_changed')
})
it('still stops an invalidated display when diagnostic logging fails', () => {
  vi.mocked(logInfo).mockImplementationOnce(() => { throw Error('log unavailable') })
  f.screenEvents.get('display-metrics-changed')!({}, {}, ['bounds'])
  expect(f.stop).toHaveBeenCalledExactlyOnceWith('display_changed')
})
it.each(['lock-screen', 'suspend', 'user-did-resign-active'])('still ends the session on %s', event => {
  f.powerEvents.get(event)!()
  expect(f.stop).toHaveBeenCalledExactlyOnceWith('host_inactive')
})
