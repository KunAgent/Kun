import type {
  CoreMemoryRecordJson,
  CorePendingMemoryCandidateJson,
  CoreRuntimeInfoJson,
  CoreRuntimeToolDiagnosticsJson
} from '../agent/kun-contract'
import type { AgentProvider } from '../agent/types'
import { describeRuntimeError } from './format-runtime-error'

type DiagnosticsProvider = Pick<
  AgentProvider,
  'getRuntimeInfo' | 'getToolDiagnostics' | 'listMemories' |
  'listMemoryDistillationCandidates'
>

export type LoadedKunDiagnostics = {
  runtimeInfo?: CoreRuntimeInfoJson | null
  toolDiagnostics?: CoreRuntimeToolDiagnosticsJson | null
  memoryRecords?: CoreMemoryRecordJson[]
  memoryCandidates?: CorePendingMemoryCandidateJson[]
  errors: string[]
}

export async function loadKunDiagnostics(
  provider: DiagnosticsProvider,
  options: { listAllMemories?: boolean; workspace?: string } = {}
): Promise<LoadedKunDiagnostics> {
  const listAllMemories = options.listAllMemories !== false
  const [runtimeInfo, toolDiagnostics, memoryRecords, memoryCandidates] = await Promise.allSettled([
    provider.getRuntimeInfo ? provider.getRuntimeInfo() : Promise.resolve(null),
    provider.getToolDiagnostics ? provider.getToolDiagnostics() : Promise.resolve(null),
    provider.listMemories
      ? provider.listMemories(
          listAllMemories
            ? { all: true, includeDeleted: false }
            : { includeDeleted: false }
        )
      : Promise.resolve([]),
    provider.listMemoryDistillationCandidates && options.workspace
      ? provider.listMemoryDistillationCandidates(options.workspace)
      : Promise.resolve([])
  ])

  const loaded: LoadedKunDiagnostics = { errors: [] }

  if (runtimeInfo.status === 'fulfilled') {
    loaded.runtimeInfo = runtimeInfo.value ?? null
  } else {
    loaded.errors.push(`Runtime: ${errorMessage(runtimeInfo.reason)}`)
  }

  if (toolDiagnostics.status === 'fulfilled') {
    loaded.toolDiagnostics = toolDiagnostics.value ?? null
  } else {
    loaded.errors.push(`Tools: ${errorMessage(toolDiagnostics.reason)}`)
  }

  if (memoryRecords.status === 'fulfilled') {
    loaded.memoryRecords = memoryRecords.value ?? []
  } else {
    loaded.errors.push(`Memory: ${errorMessage(memoryRecords.reason)}`)
  }

  if (memoryCandidates.status === 'fulfilled') {
    loaded.memoryCandidates = memoryCandidates.value ?? []
  } else {
    loaded.errors.push(`Memory candidates: ${errorMessage(memoryCandidates.reason)}`)
  }

  loaded.errors = [...new Set(loaded.errors)]
  return loaded
}

function errorMessage(error: unknown): string {
  return describeRuntimeError(error).summary
}
