import type { ModelUtilityRequest, ModelUtilityResult } from '../../../kun/src/contracts/model-utility.js'

export type RuntimeModelExecutor = (input: ModelUtilityRequest) => Promise<ModelUtilityResult>
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
export async function requestRuntimeModelText(input: ModelUtilityRequest): Promise<ModelUtilityResult> {
  if (!executor) return { ok: false, message: 'The model runtime is not ready.' }
  try { return await executor(input) }
  catch { return { ok: false, message: 'The model runtime request failed. Check the provider connection and runtime availability.' } }
}
