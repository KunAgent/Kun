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

export type ManagerRequestSignalHandle = {
  readonly signal: AbortSignal
  /** Clears the timer and detaches from the source signals once the request settles. */
  dispose(): void
}

/**
 * Disposable request signal. `AbortSignal.timeout()` combined through
 * `AbortSignal.any()` stays strongly referenced by Node until its timer fires,
 * so at a few Manager RPCs per second the 30-120 s data-plane timeouts kept
 * thousands of settled signals and timers alive. This signal is a plain
 * controller whose timer and listeners are released by `dispose()`.
 */
export function openManagerRequestSignal(
  signal?: AbortSignal,
  timeoutMs = 5_000,
  options: { admission?: boolean } = {}
): ManagerRequestSignalHandle {
  const controller = new AbortController()
  const sources = [
    ...(options.admission === false || !admission ? [] : [admission.signal]),
    ...(signal ? [signal] : [])
  ]
  const detach: Array<() => void> = []
  const timer = setTimeout(() => {
    controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))
  }, timeoutMs)
  timer.unref?.()
  const dispose = (): void => {
    clearTimeout(timer)
    for (const remove of detach.splice(0)) remove()
  }
  for (const source of sources) {
    if (source.aborted) {
      controller.abort(source.reason)
      break
    }
    const forward = (): void => controller.abort(source.reason)
    source.addEventListener('abort', forward, { once: true })
    detach.push(() => source.removeEventListener('abort', forward))
  }
  controller.signal.addEventListener('abort', dispose, { once: true })
  if (controller.signal.aborted) {
    dispose()
    controller.signal.throwIfAborted()
  }
  return { signal: controller.signal, dispose }
}

/** Run one request (including its body read) under a disposable request signal. */
export async function withManagerRequestSignal<T>(
  signal: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 5_000
): Promise<T> {
  const request = openManagerRequestSignal(signal, timeoutMs)
  try {
    return await run(request.signal)
  } finally {
    request.dispose()
  }
}
