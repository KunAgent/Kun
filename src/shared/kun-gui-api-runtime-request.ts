import type { RuntimeRequestResult } from './kun-gui-api-contracts'

export type RuntimeRequestIpcApi = {
  runtimeRequest: (
    path: string,
    method?: string,
    body?: string,
    options?: { requestId?: string; priority?: 'foreground' | 'background' }
  ) => Promise<RuntimeRequestResult>
  cancelRuntimeRequest: (requestId: string) => Promise<boolean>
}
