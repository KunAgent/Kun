// Compatibility exports for provider UI consumers. Flush ownership lives at
// application scope and is independent of settings view mount/unmount.
import { useEffect } from 'react'
import { configureProviderMutationFlushOperations, type ProviderMutationFlushOperations } from '../services/provider-mutation-flush-service'

export * from '../services/provider-mutation-flush-service'

export function useProviderMutationFlushOperations(operations: ProviderMutationFlushOperations): void {
  useEffect(() => { configureProviderMutationFlushOperations(operations) }, [operations])
}
