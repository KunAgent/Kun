import { join } from 'node:path'
import { DEFAULT_KUN_CAPABILITIES_CONFIG } from '../contracts/capabilities.js'
import { mergeBuiltinSubagentProfiles } from '../delegation/builtin-profiles.js'
import { MemoryCapabilityConfig } from '../contracts/capabilities.js'
import { createPersistentMemoryStore } from './runtime-factory-storage.js'
import { RemoteRoomStore } from '../manager/remote-room-store.js'
import { RoomExecutionLease } from '../manager/room-execution-lease.js'
import { RoomRuntime } from '../rooms/room-runtime.js'
import { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import type { RoomRuntimeDeps } from '../rooms/room-runtime-types.js'
import type { KunServeRuntimeOptions } from './runtime-factory-types.js'
import { activeModelConnectionProviderId, agentSdkProviderIdsForOptions,
  antigravityProviderIdsForOptions, cursorSdkProviderIdsForOptions } from './runtime-factory-model.js'

export function createRuntimeRoomComposition(input: {
  options: () => KunServeRuntimeOptions
  services: Omit<RoomRuntimeDeps, 'store' | 'dataDir' | 'model' | 'profiles' | 'assertOwnership'>
}) {
  const options = input.options()
  const manager = options.serviceManager
  const lease = manager ? new RoomExecutionLease({ manager,
    flavor: options.runtimeFlavor ?? 'production', instanceId: options.instanceId ?? 'embedded' }) : undefined
  const localStore = manager ? undefined : new SqliteRoomStore({ path: join(options.dataDir, 'rooms', 'rooms.sqlite') })
  const apiStore = manager ? new RemoteRoomStore(manager) : localStore!
  const executionStore = manager
    ? new RemoteRoomStore(manager, { getFence: () => lease!.getFence(), ready: () => lease!.ready() })
    : localStore!
  // Agent-owned records share the canonical Manager repository, with their own
  // explicit feature policy. Code's legacy memory toggle is a separate surface.
  const ownedAgentMemory = manager || !input.services.memoryStore ? createPersistentMemoryStore({
    ...options, capabilities: { ...(options.capabilities ?? DEFAULT_KUN_CAPABILITIES_CONFIG),
      memory: MemoryCapabilityConfig.parse({ enabled: true, maxInjectedRecords: 8 }) }
  }, () => new Date().toISOString()) : undefined
  const rooms = new RoomRuntime({
    ...input.services,
    memoryStore: ownedAgentMemory ?? input.services.memoryStore,
    memoryEnabled: () => true,
    store: executionStore,
    dataDir: options.dataDir,
    model: () => ({ model: input.options().model, providerId: activeModelConnectionProviderId(input.options()) }),
    unsupportedProviderIds: () => [...new Set([...agentSdkProviderIdsForOptions(input.options()),
      ...antigravityProviderIdsForOptions(input.options()), ...cursorSdkProviderIdsForOptions(input.options())])],
    profiles: () => mergeBuiltinSubagentProfiles(
      (input.options().capabilities ?? DEFAULT_KUN_CAPABILITIES_CONFIG).subagents
    ).profiles,
    assertOwnership: () => executionStore.assertOwnership()
  }, () => lease?.held ?? true, apiStore)
  let stopped = false
  let starting: Promise<unknown> | undefined
  return {
    rooms,
    start(): void {
      if (stopped || starting) return
      // Called only after HTTP listen and successful Manager Runtime registration.
      starting = Promise.resolve(lease?.start()).then(() => {
        if (!stopped) rooms.start()
      }).catch((error) => {
        console.warn('[kun] room coordinator startup failed:', error instanceof Error ? error.message : String(error))
      })
    },
    async close(): Promise<void> {
      stopped = true
      await starting
      try { await rooms.close(); await ownedAgentMemory?.shutdown?.() } finally {
        try { await lease?.close() } finally { await localStore?.close() }
      }
    }
  }
}
