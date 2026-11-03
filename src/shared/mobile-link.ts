import type { AccountEntitlements } from '@kun/remote-protocol'
import type { MobileLinkScope } from './mobile-link-scopes'
export type MobileLinkStatus = {
  enabled: boolean
  starting?: boolean
  online: boolean
  error?: string
  deviceId?: string
  pairings: Array<{ id: string; name: string; controllerId: string }>
  grants: Array<{ id: string; controllerId: string; name?: string; scopes?: MobileLinkScope[] }>
}
export type MobileLinkApi = {
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
