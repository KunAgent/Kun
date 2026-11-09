import type { MobileLinkStatus } from './mobile-link'
export type { ComputerViewerBridge, ComputerViewerConfiguration, ComputerViewerEvent, DesktopIceConfiguration } from '@kun/control-runtime/viewer'

export type ComputerDevice = { id: string; installationId: string; name: string; platform: string; enabled: boolean; supported: boolean; online: boolean | null; grantId: string | null }
export type ComputerAccessStatus = {
  supported: boolean; online: boolean; devices: ComputerDevice[]; error?: string
  active?: { hostId: string; name: string; phase: 'opening' | 'connected' | 'closing' | 'unconfirmed' }
}
export type ComputerAccessApi = {
  status(): Promise<ComputerAccessStatus>
  refresh(): Promise<ComputerAccessStatus>
  pair(hostId: string): Promise<ComputerAccessStatus>
  open(hostId: string): Promise<ComputerAccessStatus>
  close(): Promise<ComputerAccessStatus>
  confirmClosed(): Promise<ComputerAccessStatus>
  enableHost(enabled: boolean): Promise<MobileLinkStatus>
}
export const COMPUTER_ACCESS_CHANNELS = {
  status: 'computer-access:status', refresh: 'computer-access:refresh', pair: 'computer-access:pair',
  open: 'computer-access:open', close: 'computer-access:close', confirmClosed: 'computer-access:confirm-closed', host: 'computer-access:host'
} as const
