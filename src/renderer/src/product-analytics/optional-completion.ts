/** Optional observation must never turn a successful user operation into an error. */
export function captureOptionalCompletion(start?: () => (() => void)): (() => void) | undefined {
  try {
    const complete = start?.()
    return complete ? () => { try { complete() } catch { /* Reporting is best effort. */ } } : undefined
  } catch { return undefined }
}
