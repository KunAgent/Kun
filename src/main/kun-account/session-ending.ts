import type { AccountSessionEnding } from '../art-assets/account-access'

/** Run main-only cleanup with the old identity without blocking local logout. */
export async function notifySessionEnding(
  listener: ((session: AccountSessionEnding) => Promise<void>) | undefined,
  session: AccountSessionEnding
): Promise<void> {
  if (!listener) return
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    // Call synchronously so consumers fence access before the public state changes.
    const cleanup = listener(session).catch(() => {})
    await Promise.race([
      cleanup,
      new Promise<void>((resolve) => { timer = setTimeout(resolve, 5000) })
    ])
  } catch {
    // Remote outages cannot keep an account signed in locally.
  } finally { clearTimeout(timer) }
}
