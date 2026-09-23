/**
 * Page-visibility helpers shared by background pollers. A hidden renderer
 * (phone lock screen, background tab) must not keep long-poll and interval
 * loops hot; `waitForPageVisible` parks a loop until the user comes back.
 */
export function isPageHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState !== 'visible'
}

/**
 * Only Remote Web (a phone browser) parks background polling while hidden:
 * there is no other host to notice missed work, and the browser may suspend
 * timers anyway. Desktop Electron keeps polling when the window is minimized
 * or fully occluded so background turns still produce notifications, unread
 * badges, and dock counts.
 */
export function shouldParkWhenHidden(): boolean {
  return typeof window !== 'undefined' &&
    window.kunGui?.isRemoteWeb === true &&
    isPageHidden()
}

/** Resolves once the page is visible again, or immediately when it already is. */
export function waitForPageVisible(signal?: AbortSignal): Promise<void> {
  if (!isPageHidden()) return Promise.resolve()
  return new Promise((resolve) => {
    const cleanup = (): void => {
      document.removeEventListener('visibilitychange', onChange)
      signal?.removeEventListener('abort', onAbort)
    }
    const onChange = (): void => {
      if (isPageHidden()) return
      cleanup()
      resolve()
    }
    const onAbort = (): void => {
      cleanup()
      resolve()
    }
    document.addEventListener('visibilitychange', onChange)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
