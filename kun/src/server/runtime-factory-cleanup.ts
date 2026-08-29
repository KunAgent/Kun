export async function settleCleanupSteps(
  steps: readonly (() => void | Promise<void>)[]
): Promise<void> {
  let firstError: unknown
  for (const step of steps) {
    try {
      await step()
    } catch (error) {
      if (firstError === undefined) firstError = error
    }
  }
  if (firstError !== undefined) throw firstError
}

export async function settleCleanupBeforeDeadline(
  cleanup: () => void | Promise<void>,
  timeoutMs: number
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve().then(cleanup).then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs)
        timer.unref?.()
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Composition root for serve mode. This is intentionally the only
 * place that wires concrete adapters to ports; domain, services, loop,
 * and HTTP handlers stay constructor-injected and testable.
 */
