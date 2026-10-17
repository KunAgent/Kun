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
  status(): Promise<MobileLinkStatus>
  enable(enabled: boolean): Promise<MobileLinkStatus>
  confirm(id: string, scopes?: MobileLinkScope[]): Promise<MobileLinkStatus>
  setScopes(id: string, scopes: MobileLinkScope[]): Promise<MobileLinkStatus>
  revoke(id: string): Promise<MobileLinkStatus>
}
export const MOBILE_LINK_CHANNELS = {
  status: 'mobile-link:status',
  enable: 'mobile-link:enable',
  confirm: 'mobile-link:confirm',
  revoke: 'mobile-link:revoke',
  setScopes: 'mobile-link:set-scopes'
} as const
