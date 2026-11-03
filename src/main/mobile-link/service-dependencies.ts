import type { RemoteApi, DeviceIdentity, Socket } from '@kun/remote-protocol'
import type { ArtAccountAccess } from '../art-assets/account-access'
import type { ProtectedRuntimeRequestLease } from '../ipc/app-ipc-handler-options'
import type { SharedFileTransfer } from './share-files'

export type LinkDependencies = {
  account: ArtAccountAccess
  requireMembership(owner: string): Promise<void>
  identity(owner: string): Promise<DeviceIdentity>
  origin: string
  name: string
  platform: string
  appVersion?: string
  fetch: typeof fetch
  socket(url: string, headers: Record<string, string>): Socket
  lease(): Promise<ProtectedRuntimeRequestLease>
  diagnostic?(code: string, details?: { attempt?: number; elapsedMs?: number }): void
  sharedFiles?: SharedFileTransfer
  desktopSchedules?(method: string, params: unknown, scope: {
    accountId: string; deviceId: string; authorizationId: string; scopes: import('../../shared/mobile-link-scopes').MobileLinkScope[]
  }, lease: ProtectedRuntimeRequestLease): Promise<unknown>
  files?(
    scope: {
      api: RemoteApi
      peer: string
      owner: string
      authorizationId: string
      current(): boolean
      lease(): Promise<ProtectedRuntimeRequestLease>
    },
    call: any
  ): Promise<unknown>
}
