/** Stop waiting for a diagnostic probe when its HTTP client disconnects. */
export function raceProbeAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error('probe aborted'))
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(signal.reason ?? new Error('probe aborted'))
    signal.addEventListener('abort', abort, { once: true })
    operation.then(
      (value) => { signal.removeEventListener('abort', abort); resolve(value) },
      (error) => { signal.removeEventListener('abort', abort); reject(error) }
    )
  })
}
