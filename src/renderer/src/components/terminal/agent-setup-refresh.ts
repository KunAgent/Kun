import type { AdeHarnessRow } from '@shared/ade-harnesses'

/** Login commands return to a shell; shell exit is not login completion. */
export function watchAgentSetupLogin(options: {
  probe: () => Promise<AdeHarnessRow | undefined>
  refresh: () => Promise<void>
  intervalMs?: number
  timeoutMs?: number
}): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = Date.now() + (options.timeoutMs ?? 120_000)
  const poll = async (): Promise<void> => {
    if (stopped || Date.now() >= deadline) return
    try {
      const row = await options.probe()
      if (stopped) return
      await options.refresh()
      if (row?.status.login === 'signed-in') return
    } catch { /* Retry a transient startup/login failure within the budget. */ }
    if (!stopped && Date.now() < deadline) timer = setTimeout(() => void poll(), options.intervalMs ?? 5_000)
  }
  timer = setTimeout(() => void poll(), options.intervalMs ?? 5_000)
  return () => { stopped = true; clearTimeout(timer) }
}
