/**
 * Keeps the `run_workflow` tool description (the workflow catalog the agent
 * reads) in sync with the GUI, without ever blocking MCP initialize.
 */

export type WorkflowCatalogRefresher = {
  refresh: () => Promise<void>
  start: () => void
  stop: () => void
}

export function createWorkflowCatalogRefresher(input: {
  readCatalog: () => Promise<string>
  updateDescription: (catalog: string) => void
  logError: (message: string) => void
  intervalMs?: number
}): WorkflowCatalogRefresher {
  let applied: string | undefined
  let lastError = ''
  let inFlight = false
  let timer: NodeJS.Timeout | undefined

  const refresh = async (): Promise<void> => {
    // One refresh at a time: a slow bridge must not stack overlapping requests.
    if (inFlight) return
    inFlight = true
    try {
      const catalog = await input.readCatalog()
      lastError = ''
      if (catalog === applied) return
      // Record only after the update really happened, so a failed update is
      // retried on the next tick instead of being remembered as applied.
      input.updateDescription(catalog)
      applied = catalog
    } catch (error) {
      // The bridge is optional for the schedule tools to work. Log transitions
      // only; repeating the same failure every tick would flood the stderr log.
      const message = error instanceof Error ? error.message : String(error)
      if (message !== lastError) {
        lastError = message
        input.logError(message)
      }
    } finally {
      inFlight = false
    }
  }

  return {
    refresh,
    start: () => {
      if (timer) return
      timer = setInterval(() => void refresh(), input.intervalMs ?? 30_000)
      // A pending catalog refresh must not keep the child process alive.
      timer.unref?.()
      void refresh()
    },
    stop: () => {
      if (!timer) return
      clearInterval(timer)
      timer = undefined
    }
  }
}
