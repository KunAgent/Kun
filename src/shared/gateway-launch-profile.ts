import type { GatewayClientId } from './gateway-client-setup'
export type GatewayLaunchProfileRequest =
  | { action: 'preview'; clientId: GatewayClientId; baseUrl: string; modelId: string }
  | { action: 'apply' | 'restore'; planId: string }
export type GatewayLaunchProfilePreview = {
  planId: string
  path: string
  before: string
  after: string
  launch: string
  canRestore: boolean
  applied?: boolean
}
export type GatewayLaunchProfileResult = {
  ok: boolean
  canceled?: boolean
  error?: string
  preview?: GatewayLaunchProfilePreview
  restored?: boolean
}
