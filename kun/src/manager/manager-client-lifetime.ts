// Opt-in process-local admission for desktop data consumers. The Manager
// physical writer and standalone clients retain their own lifecycle policy.
let admission: AbortController | undefined

export function openManagerClientAdmission(): void {
  if (!admission || admission.signal.aborted) admission = new AbortController()
}

export function closeManagerClientAdmission(): void {
  admission ??= new AbortController()
  admission.abort(new Error('Application data consumers have stopped'))
}

export function managerClientRequestSignal(signal?: AbortSignal, timeoutMs = 5_000): AbortSignal {
  const signals = [AbortSignal.timeout(timeoutMs)]
  if (admission) signals.push(admission.signal)
  if (signal) signals.push(signal)
  const combined = AbortSignal.any(signals)
  combined.throwIfAborted()
  return combined
}
