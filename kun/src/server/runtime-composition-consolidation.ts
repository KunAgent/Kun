import type { MemoryStore } from '../memory/memory-store.js'
import type { MemoryDistillationCoordinator } from '../memory/memory-distillation-coordinator.js'
import { ConsolidationJobStore } from '../services/consolidation-job-store.js'
import type { ThreadSnapshotStore } from '../services/thread-snapshot-store.js'
import type { TurnService } from '../services/turn-service-core.js'
import { SessionConsolidationService } from '../services/session-consolidation-service.js'
import type { createRuntimeModelComposition } from './runtime-composition-model.js'
import { DEFAULT_KUN_CAPABILITIES_CONFIG } from '../contracts/capabilities.js'

type RuntimeModel = Awaited<ReturnType<typeof createRuntimeModelComposition>>

export function createSessionConsolidationService(input: {
  model: RuntimeModel
  turnService: TurnService
  threadSnapshots: ThreadSnapshotStore
  memoryStore: MemoryStore | undefined
  memoryDistillation: MemoryDistillationCoordinator
}): SessionConsolidationService {
  const { model, turnService, threadSnapshots, memoryStore, memoryDistillation } = input
  const { core } = model
  const { threadStore, sessionStore, threadService, approvalGate, userInputGate, artifactStore } = core
  const jobStore = new ConsolidationJobStore({ dataDir: core.activeOptions.dataDir, nowIso: core.nowIso })
  return new SessionConsolidationService({
    config: () => core.activeOptions.capabilities?.memory?.consolidation ??
      DEFAULT_KUN_CAPABILITIES_CONFIG.memory.consolidation,
    dataDir: core.activeOptions.dataDir,
    threadStore,
    sessionStore,
    threadService,
    turnService,
    snapshots: threadSnapshots,
    jobStore,
    memoryStore: () => memoryStore,
    modelClient: model.timedModelClient,
    defaultModel: () => core.activeOptions.model,
    roles: () => core.activeOptions.roles,
    immutablePrefix: () => core.prefix,
    nowIso: core.nowIso,
    artifactStore,
    hasPendingInteractions: (threadId) =>
      approvalGate.pending(threadId).length > 0 || userInputGate.pending(threadId).length > 0,
    queueDurableCandidates: (threadId, turnId) =>
      memoryDistillation.schedule({ threadId, turnId, status: 'completed' })
  })
}
