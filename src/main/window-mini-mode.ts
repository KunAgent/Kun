import { screen, type BrowserWindow, type Rectangle } from 'electron'

const MINI_WINDOW_WIDTH = 380
const MINI_WINDOW_HEIGHT = 480
const MINI_WINDOW_MARGIN = 24

type SavedWindowState = {
  bounds: Rectangle
  maximized: boolean
  minimumSize: number[]
  alwaysOnTop: boolean
}

const savedWindows = new WeakMap<BrowserWindow, SavedWindowState>()
const transitionVersions = new WeakMap<BrowserWindow, number>()

export function fitWindowToWorkArea(bounds: Rectangle, area: Rectangle): Rectangle {
  const width = Math.min(bounds.width, area.width)
  const height = Math.min(bounds.height, area.height)
  return {
    width,
    height,
    x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height))
  }
}

export function isMiniWindowMode(window: BrowserWindow | null): boolean {
  return !!window && !window.isDestroyed() && savedWindows.has(window)
}

export function toggleMiniWindowMode(window: BrowserWindow | null): boolean {
  if (!window || window.isDestroyed()) return false
  const version = (transitionVersions.get(window) ?? 0) + 1
  transitionVersions.set(window, version)
  const previous = savedWindows.get(window)
  const entering = !previous
  const saved: SavedWindowState = previous ?? {
    bounds: window.getNormalBounds(),
    maximized: window.isMaximized(),
    minimumSize: window.getMinimumSize(),
    alwaysOnTop: window.isAlwaysOnTop()
  }
  if (entering) savedWindows.set(window, saved)
  else savedWindows.delete(window)

  // Pick the display before unmaximizing: its normal bounds may belong to
  // another monitor. On restore, Electron picks the nearest surviving display.
  const area = screen.getDisplayMatching(entering ? window.getBounds() : saved.bounds).workArea
  const bounds = fitWindowToWorkArea(entering ? {
    width: MINI_WINDOW_WIDTH,
    height: MINI_WINDOW_HEIGHT,
    x: area.x + area.width - MINI_WINDOW_WIDTH - MINI_WINDOW_MARGIN,
    y: area.y + area.height - MINI_WINDOW_HEIGHT - MINI_WINDOW_MARGIN
  } : saved.bounds, area)

  const apply = (): void => {
    if (window.isDestroyed() || transitionVersions.get(window) !== version) return
    window.setMinimumSize(
      Math.min(entering ? 320 : saved.minimumSize[0]!, area.width),
      Math.min(entering ? 360 : saved.minimumSize[1]!, area.height)
    )
    window.setBounds(bounds)
    window.setAlwaysOnTop(entering || saved.alwaysOnTop)
    if (!entering && saved.maximized) window.maximize()
  }

  // Windows completes unmaximize asynchronously. setBounds while maximized
  // can be ignored; a newer toggle must also invalidate this pending callback.
  if (window.isMaximized()) {
    // The native event can fire before the OS finishes restoring its frame.
    // Leave that callback before setting our bounds, or the OS can overwrite
    // them with the old mini frame after we have already resized the window.
    window.once('unmaximize', () => setImmediate(apply))
    window.unmaximize()
  } else {
    apply()
  }
  return entering
}
