import { powerMonitor, screen } from 'electron'
import { randomUUID } from 'node:crypto'
import type { DesktopAuthority } from './session-service'
import { controlRuntimeHost, stopControlRuntimeHost } from '../control-host/runtime-host'
import type { ControlDesktop } from '../control-host/desktop'
import { ElectronDesktopCapture, displayFingerprint } from './capture-host'
import { NativeDesktopInput, desktopHelperAvailable } from './native-input'
import { desktopInputArbiter } from './input-arbiter'
import { getComputerUsePermissions } from '../services/computer-use-permissions'
import { privacyScreenSupported } from './privacy-screen'
import { DesktopShareIndicator } from './indicator'
import { bindDesktopDisplayStops, bindDesktopPrivacyStops } from './host-lifecycle'
import { logInfo } from '../logger'
import { stopComputerSessions } from '../computer-access/lifecycle'
import { NativeMobileDisplay, mobileDisplaySupported, isKunMobileDisplay, expectedMobileDisplayChange } from './virtual-display'
import { WaylandSession, PORTAL_DISPLAY, isWayland } from './wayland-session'
const engines = new Set<ControlDesktop>()
export async function stopBuiltinDesktopEngines() {
  try { await stopComputerSessions(); await Promise.all([...engines].map(engine => engine.stopAll('application_quit'))) }
  finally { await stopControlRuntimeHost() }
}

export function createDesktopEngine(ice: (authority: DesktopAuthority) => Promise<unknown[]>, authorizeOrigin: (authority: DesktopAuthority, origin: { kind: 'code' | 'agent' | 'device'; id: string }) => Promise<void>) {
  const portal = isWayland() ? new WaylandSession(() => { void service.stopAll('host_inactive').catch(() => {}) }) : undefined
  const service: ControlDesktop = controlRuntimeHost().desktop({
    supported: () => desktopHelperAvailable(),
    permissions: async () => portal ? { screenRecording: portal.selection ? 'granted' : 'denied',
      accessibility: portal.selection?.input ? 'granted' : 'denied' } : getComputerUsePermissions(),
    prepareHost: portal ? async enabled => { if (enabled) await portal.prepare(); else portal.close() } : undefined,
    privacySupported: privacyScreenSupported,
    gameSupported: desktopHelperAvailable,
    diagnostic: value => logInfo('remote-desktop', 'Desktop session state.', value),
    virtualSupported: mobileDisplaySupported, virtualDisplay: lost => new NativeMobileDisplay(lost),
    displays: () => portal ? (portal.selection ? [{ id: PORTAL_DISPLAY, primary: true,
      fingerprint: JSON.stringify(portal.selection), label: 'Wayland · Portal', pixelWidth: portal.selection.width,
      pixelHeight: portal.selection.height, rotation: 0 }] : []) : screen.getAllDisplays().filter(display => !isKunMobileDisplay(display.id)).map(display => ({ id: display.id, primary: display.id === screen.getPrimaryDisplay().id, fingerprint: displayFingerprint(display), label: display.label || `Display ${display.id}`,
      pixelWidth: Math.round(display.size.width * display.scaleFactor), pixelHeight: Math.round(display.size.height * display.scaleFactor), rotation: display.rotation })),
    capture: (id, receive) => new ElectronDesktopCapture(id, receive, () => controlRuntimeHost().captureDirectory(), portal),
    input: lost => portal ? portal.input() : new NativeDesktopInput(lost), ice, authorizeOrigin,
    indicator: new DesktopShareIndicator(),
    now: () => performance.now(), id: randomUUID, arbiter: desktopInputArbiter
  })
  bindDesktopDisplayStops(screen, reason => service.stopAll(reason), value => logInfo('remote-desktop', 'Desktop display change.', value),
    expectedMobileDisplayChange, id => service.ports.relevantDisplay(id))
  bindDesktopPrivacyStops(powerMonitor, reason => service.stopAll(reason))
  engines.add(service)
  return service
}
