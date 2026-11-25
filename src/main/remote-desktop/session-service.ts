// Host contracts only; the executable desktop engine is downloaded with control.
import type {
  RemoteDesktopService as BaseRemoteDesktopService,
  DesktopAuthority,
  DesktopHostDisplay,
  DesktopInputPort,
  DesktopEngineDependencies as BaseDesktopEngineDependencies
} from '@kun/control-runtime/desktop'
import type { DesktopUnlockBox, DesktopUnlockChallenge } from '@kun/remote-protocol'
import type { DesktopAccessStatus, DesktopConfiguration } from '../../shared/remote-desktop'
import type { DesktopHostLockState } from './desktop-unlock'

export type DesktopUnlockPort = {
  prepare(authority: DesktopAuthority): Promise<DesktopUnlockChallenge>
  submit(authority: DesktopAuthority, box: DesktopUnlockBox): Promise<{ unlocked: true }>
  revokePeer(deviceId: string): void
  clear(): void
}
export type DesktopEngineDependencies = Omit<BaseDesktopEngineDependencies, 'diagnostic'> & {
  unlockSupported?(): boolean
  lockState?(): Promise<DesktopHostLockState>
  unlock?: DesktopUnlockPort
  diagnostic?(value: Record<string, unknown>): void
}
export type RemoteDesktopService = Omit<BaseRemoteDesktopService, 'status' | 'configure' | 'configureRemoteAccess'> & {
  status(): Promise<DesktopAccessStatus>
  configure(value: DesktopConfiguration, current?: () => boolean): Promise<DesktopAccessStatus>
  configureRemoteAccess(enabled: boolean, current?: () => boolean): Promise<DesktopAccessStatus>
}
export type { DesktopAuthority, DesktopHostDisplay, DesktopInputPort }
