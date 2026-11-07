import type { AccountEntitlements } from '@kun/remote-protocol'
import type { MobileLinkScope } from './mobile-link-scopes'
export type MobileLinkStatus = {
  enabled: boolean
  /** Explicit unified phone/desktop consent; absent/false on legacy relay-only starts. */
  desktopAccess?: boolean
  starting?: boolean
  online: boolean
  error?: string
  deviceId?: string
  pairings: Array<{ id: string; name: string; controllerId: string; purpose?: 'desktop' }>
  grants: Array<{ id: string; controllerId: string; name?: string; scopes?: MobileLinkScope[]; purpose?: 'desktop' }>
}
export type MobileLinkApi = {
  computers?: import('./computer-access').ComputerAccessApi
  controlPackage?: import('./control-package').ControlPackageApi
  direct?: import('./direct-link').DirectLinkApi
  reconnect(): Promise<MobileLinkStatus>
  entitlements(): Promise<AccountEntitlements>
  status(): Promise<MobileLinkStatus>
  enable(enabled: boolean): Promise<MobileLinkStatus>
  resetIdentity(): Promise<MobileLinkStatus>
  confirm(id: string, scopes?: MobileLinkScope[]): Promise<MobileLinkStatus>
  setScopes(id: string, scopes: MobileLinkScope[]): Promise<MobileLinkStatus>
  desktopStatus?(): Promise<import('./remote-desktop').DesktopAccessStatus>
  desktopConfigure?(value: import('./remote-desktop').DesktopConfiguration): Promise<import('./remote-desktop').DesktopAccessStatus>
  desktopStop?(): Promise<void>
  revoke(id: string): Promise<MobileLinkStatus>
}
export const MOBILE_LINK_CHANNELS = {
  status: 'mobile-link:status',
  entitlements: 'mobile-link:entitlements',
  reconnect: 'mobile-link:reconnect',
  enable: 'mobile-link:enable',
  resetIdentity: 'mobile-link:reset-identity',
  confirm: 'mobile-link:confirm',
  revoke: 'mobile-link:revoke',
  setScopes: 'mobile-link:set-scopes',
  desktopStatus: 'mobile-link:desktop-status',
  desktopConfigure: 'mobile-link:desktop-configure',
  desktopStop: 'mobile-link:desktop-stop'
} as const
