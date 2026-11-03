import type { ModelUtilityRequest, ModelUtilityResult } from '../../../kun/src/contracts/model-utility.js'

/** Transport options kept outside the strict request body sent to the Runtime. */
export type RuntimeModelRequestOptions = { signal?: AbortSignal }
export type RuntimeModelExecutor = (input: ModelUtilityRequest, options?: RuntimeModelRequestOptions) => Promise<ModelUtilityResult>
let executor: RuntimeModelExecutor | undefined

/** Bootstrap supplies this port before Main model consumers are registered. */
export function configureRuntimeModelExecutor(next: RuntimeModelExecutor): () => void {
  const previous = executor
  executor = next
  return () => { if (executor === next) executor = previous }
}
export function routesTextThroughRuntime(): boolean {
  // Production Main fails closed before bootstrap; standalone Node protocol fixtures may use the legacy transport.
  return executor !== undefined || (process as NodeJS.Process & { type?: string }).type === 'browser'
}
export async function requestRuntimeModelText(input: ModelUtilityRequest, options?: RuntimeModelRequestOptions): Promise<ModelUtilityResult> {
  if (!executor) return { ok: false, message: 'The model runtime is not ready.' }
  if (options?.signal?.aborted) return { ok: false, message: 'Model request cancelled.' }
  try { return await (options ? executor(input, options) : executor(input)) }
  catch {
    if (options?.signal?.aborted) return { ok: false, message: 'Model request cancelled.' }
    return { ok: false, message: 'The model runtime request failed. Check the provider connection and runtime availability.' }
  }
}
