import type { KunGuiApi } from '../shared/kun-gui-api'
import type { StorageRelocationRecoveryApi } from './storage-relocation-recovery'
import type { RuntimeDataRecoveryWindowApi } from './runtime-data-recovery'

export type * from '../shared/kun-gui-api'

declare global {
  interface Window {
    kunGui: KunGuiApi
    kunStorageRelocationRecovery: StorageRelocationRecoveryApi
    kunRuntimeDataRecovery: RuntimeDataRecoveryWindowApi
  }
}
