/** Closing Settings must cancel immediately, before an asynchronous save/navigation. */
const checks = new Set<() => void>()
export function registerAgentEnablementCancellation(cancel: () => void): () => void {
  checks.add(cancel)
  return () => { checks.delete(cancel) }
}
export function cancelAgentEnablementChecks(): void {
  for (const cancel of checks) cancel()
}
