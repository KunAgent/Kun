import type { AppSettingsV1 } from '../../shared/app-settings'

/** Early startup failures have neither a settings store nor Browser authority to revoke. */
export async function revokeBrowserBindingBeforeQuit(input: {
  store?: { load(): Promise<AppSettingsV1> }
  hasBinding: boolean
  runtimeIsLive: boolean
  deadline?: number
  revoke(settings: AppSettingsV1, timeoutMs?: number): Promise<unknown>
}): Promise<void> {
  if (!input.store || !input.hasBinding || !input.runtimeIsLive) return
  if (input.deadline === undefined) {
    await input.revoke(await input.store.load())
    return
  }
  // The local Browser host is already fenced. Bound the remote best-effort
  // revoke; the later shutdown steps still have to prove the owned Runtime exited.
  if (Date.now() >= input.deadline) return
  const settings = await withinDeadline(input.store.load(), input.deadline)
  const remaining = input.deadline - Date.now()
  if (!settings || remaining <= 0) return
  await withinDeadline(input.revoke(settings, remaining), input.deadline)
}

async function withinDeadline<T>(operation: Promise<T>, deadline: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<undefined>(resolve => {
        timer = setTimeout(() => resolve(undefined), Math.max(0, deadline - Date.now()))
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
