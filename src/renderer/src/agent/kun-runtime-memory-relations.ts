import { KUN_MEMORY_RELATIONS_ANALYZE_PATH, KUN_MEMORY_RELATIONS_PATH } from '@shared/kun-endpoints'
import { MemoryRelationResult, type MemoryRelationAnalyzeRequest, type MemoryRelationCommand } from '@shared/memory-relations'
import { rendererRuntimeClient } from './runtime-client'

export async function requestMemoryRelations(
  input: Exclude<MemoryRelationCommand, { action: 'propose' }>,
  signal?: AbortSignal
): Promise<MemoryRelationResult> {
  return request(KUN_MEMORY_RELATIONS_PATH, input, signal)
}

export async function analyzeRuntimeMemoryRelations(
  input: MemoryRelationAnalyzeRequest,
  signal?: AbortSignal
): Promise<MemoryRelationResult> {
  return request(KUN_MEMORY_RELATIONS_ANALYZE_PATH, input, signal)
}

async function request(path: string, input: unknown, signal?: AbortSignal): Promise<MemoryRelationResult> {
  const response = await rendererRuntimeClient.runtimeRequest(path, 'POST', JSON.stringify(input), { signal })
  if (!response.ok) throw new Error('Memory relation request failed')
  try { return MemoryRelationResult.parse(JSON.parse(response.body)) }
  catch { throw new Error('Invalid memory relation response') }
}
