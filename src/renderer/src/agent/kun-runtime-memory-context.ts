import { KUN_MEMORY_CONTEXT_PREVIEW_PATH } from '@shared/kun-endpoints'
import { MemoryWorkingContextPreview } from '@shared/memory-working-context'
import { rendererRuntimeClient } from './runtime-client'

export async function previewRuntimeMemoryContext(
  input: { query: string; workspace: string }, signal?: AbortSignal
): Promise<MemoryWorkingContextPreview> {
  const response = await rendererRuntimeClient.runtimeRequest(
    KUN_MEMORY_CONTEXT_PREVIEW_PATH, 'POST', JSON.stringify(input), { signal }
  )
  if (!response.ok) throw new Error('Memory context preview is unavailable')
  try { return MemoryWorkingContextPreview.parse(JSON.parse(response.body)) }
  catch { throw new Error('Invalid memory context preview response') }
}
