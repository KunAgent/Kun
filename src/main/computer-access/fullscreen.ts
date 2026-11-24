import type { BrowserWindow } from 'electron'

/** macOS confirms the new state after its native Space transition. */
export function bindViewerFullscreen(window: BrowserWindow, changed: (active: boolean) => void) {
  let pending: Promise<boolean> | undefined
  let settle: ((active: boolean) => void) | undefined
  let active = window.isFullScreen()
  function confirmed(value: boolean) {
    active = value
    changed(value)
    settle?.(value)
  }
  window.on('enter-full-screen', () => confirmed(true))
  window.on('leave-full-screen', () => confirmed(false))
  return function toggle(requested?: boolean): Promise<boolean> {
    if (pending) return pending
    const target = requested ?? !active
    if (active === target) return Promise.resolve(active)
    let finish!: (value: boolean) => void, fail!: (reason: Error) => void
    const transition = new Promise<boolean>((resolve, reject) => { finish = resolve; fail = reject })
    const closed = () => fail(Error('DESKTOP_CANCELLED'))
    const timer = setTimeout(() => {
      if (!window.isDestroyed() && window.isFullScreen() === target) confirmed(target)
      else fail(Error('DESKTOP_FULLSCREEN_FAILED'))
    }, 4500)
    window.once('closed', closed)
    settle = value => { if (value === target) finish(value) }
    pending = transition.finally(() => {
      clearTimeout(timer)
      window.removeListener('closed', closed)
      pending = settle = undefined
    })
    try { window.setFullScreen(target) }
    catch { fail(Error('DESKTOP_FULLSCREEN_FAILED')) }
    return pending
  }
}
