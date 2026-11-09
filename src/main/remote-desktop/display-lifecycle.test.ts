import { beforeEach, expect, it, vi } from 'vitest'

const f = vi.hoisted(() => ({
  screenEvents: new Map<string, (...args: any[]) => void>(),
  powerEvents: new Map<string, (...args: any[]) => void>(),
  stop: vi.fn(async () => {})
}))
vi.mock('electron', () => ({
  screen: { on: (name: string, handler: (...args: any[]) => void) => f.screenEvents.set(name, handler) },
  powerMonitor: { on: (name: string, handler: (...args: any[]) => void) => f.powerEvents.set(name, handler) }
}))
vi.mock('../control-host/runtime-host', () => ({ controlRuntimeHost: () => ({ desktop: () => ({ stopAll: f.stop }) }), stopControlRuntimeHost: vi.fn() }))
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
