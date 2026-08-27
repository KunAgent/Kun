import type { UserInputRequest, UserInputResolveResult } from '../ports/user-input-gate.js'

/**
 * Await a gate that has already been registered with its external resolver.
 * Registering before publishing the corresponding SSE event is important: a
 * renderer may submit a decision synchronously while handling that event.
 */
export function awaitAbortableGate<T>(
  pending: Promise<T>,
  signal: AbortSignal,
  onAbort: () => void,
  abortMessage: string
): Promise<T> {
  if (signal.aborted) {
    onAbort()
    return Promise.reject(new Error(abortMessage))
  }
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort)
    const abort = () => {
      cleanup()
      onAbort()
      reject(new Error(abortMessage))
    }
    signal.addEventListener('abort', abort, { once: true })
    pending.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error) => {
        cleanup()
        reject(error)
      }
    )
  })
}

export function userInputRequestWithDeadline(
  request: UserInputRequest,
  nowMs: () => number = Date.now
): UserInputRequest {
  return {
    ...request,
    ...(request.timeoutSeconds !== undefined && request.timeoutSeconds > 0
      ? { deadlineAtMs: nowMs() + request.timeoutSeconds * 1000 }
      : {})
  }
}

/**
 * Arm the optional self-resolution timer for a pending user-input request.
 * When the budget elapses, the gate resolves with status "timeout" so the
 * model can proceed on its own instead of blocking the turn forever. Duplicate
 * resolution is a no-op; the gate already settles exclusively by input id.
 */
export function armUserInputTimeout(
  resolve: (resolution: { status: 'timeout' }) => UserInputResolveResult,
  inputId: string,
  timeoutSeconds: number | undefined
): () => void {
  if (timeoutSeconds === undefined || !(timeoutSeconds > 0)) return () => undefined
  const timer = setTimeout(() => {
    // 'claimed' means a submission is being durably persisted. The request
    // deadline remains in the gate so releasing a failed claim can settle the
    // expired request instead of leaving the turn blocked forever.
    resolve({ status: 'timeout' })
  }, timeoutSeconds * 1000)
  timer.unref?.()
  return () => clearTimeout(timer)
}
