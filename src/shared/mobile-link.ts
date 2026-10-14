export type MobileLinkStatus = {
  enabled: boolean
  starting?: boolean
  online: boolean
  error?: string
  deviceId?: string
  pairings: Array<{ id: string; name: string; controllerId: string }>
  grants: Array<{ id: string; controllerId: string; name?: string }>
}
export type MobileLinkApi = {
  status(): Promise<MobileLinkStatus>
  enable(enabled: boolean): Promise<MobileLinkStatus>
  confirm(id: string): Promise<MobileLinkStatus>
  revoke(id: string): Promise<MobileLinkStatus>
}
export const MOBILE_LINK_CHANNELS = {
  status: 'mobile-link:status',
  enable: 'mobile-link:enable',
  confirm: 'mobile-link:confirm',
  revoke: 'mobile-link:revoke'
} as const
