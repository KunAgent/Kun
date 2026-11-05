import { powerMonitor, screen } from 'electron'
import { randomUUID } from 'node:crypto'
import type { DesktopAuthority } from './session-service'
import { RemoteDesktopService } from './session-service'
import { ElectronDesktopCapture, displayFingerprint } from './capture-host'
import { NativeDesktopInput, desktopHelperAvailable } from './native-input'
import { desktopInputArbiter } from './input-arbiter'
import { getComputerUsePermissions } from '../services/computer-use-permissions'
import { DesktopShareIndicator } from './indicator'
import { bindDesktopPrivacyStops } from './host-lifecycle'
const engines = new Set<RemoteDesktopService>()
export async function stopBuiltinDesktopEngines() { await Promise.all([...engines].map(engine => engine.stopAll('application_quit'))) }

export function createDesktopEngine(ice: (authority: DesktopAuthority) => Promise<unknown[]>, authorizeOrigin: (authority: DesktopAuthority, origin: { kind: 'code' | 'agent'; id: string }) => Promise<void>) {
  const service = new RemoteDesktopService({
    supported: () => process.platform === 'darwin' && process.arch === 'arm64' && desktopHelperAvailable(),
    permissions: getComputerUsePermissions,
    displays: () => screen.getAllDisplays().map(display => ({ id: display.id, primary: display.id === screen.getPrimaryDisplay().id, fingerprint: displayFingerprint(display), label: display.label || `Display ${display.id}`,
      pixelWidth: Math.round(display.size.width * display.scaleFactor), pixelHeight: Math.round(display.size.height * display.scaleFactor), rotation: display.rotation })),
    capture: (id, receive) => new ElectronDesktopCapture(id, receive),
    input: lost => new NativeDesktopInput(lost), ice, authorizeOrigin,
    indicator: new DesktopShareIndicator(),
    now: () => performance.now(), id: randomUUID, arbiter: desktopInputArbiter
  })
  const changed = () => { void service.stopAll('display_changed').catch(() => {}) }
  screen.on('display-removed', changed); screen.on('display-metrics-changed', changed)
  bindDesktopPrivacyStops(powerMonitor, reason => service.stopAll(reason))
  engines.add(service)
  return service
}
