import type { MobileLinkScope } from './mobile-link-scopes'
export type DirectLinkConfiguration = { enabled: boolean; bind: 'lan' | 'loopback'; port: number; addresses: string[];
  iceServers?: { urls: string | string[]; username?: string; credential?: string }[] }
export type DirectLinkStatus = Omit<DirectLinkConfiguration, 'iceServers'> & {
  ready: boolean; running: boolean; error?: string; hostId?: string; localAddresses: string[]; hasIceServers: boolean
  grants: { id: string; name: string; scopes: MobileLinkScope[]; online: boolean; expiresAt: number }[]
}
export type DirectLinkApi = {
  retry(): Promise<DirectLinkStatus>
  status(): Promise<DirectLinkStatus>
  configure(value: DirectLinkConfiguration): Promise<DirectLinkStatus>
  pair(scopes: MobileLinkScope[]): Promise<{ link: string; expiresAt: number }>
  revoke(id: string): Promise<DirectLinkStatus>
}
export const DIRECT_LINK_CHANNELS = { status: 'mobile-direct:status', retry: 'mobile-direct:retry', configure: 'mobile-direct:configure', pair: 'mobile-direct:pair', revoke: 'mobile-direct:revoke' } as const
