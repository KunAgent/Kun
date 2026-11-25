import type { BrowserWindow, WebContents } from 'electron'
import { widgetAppFromArg } from '../../shared/widget-apps'

const pending = new Set<string>()
const windows = new Map<string, BrowserWindow>()
let activate: ((id: string) => void) | undefined
let runtimeReady = false
export const widgetAppStartup = { launcherOnly: false }

export function acceptWidgetAppLaunch(value: string): boolean {
  const id = widgetAppFromArg(value)
  if (!id) return false
  if (activate && runtimeReady) activate(id)
  else if (pending.size < 32) pending.add(id)
  return true
}

export function hasPendingWidgetLaunch(): boolean { return pending.size > 0 }

export function registerWidgetActivation(open: (id: string) => void): void {
  activate = open
  drain()
}

export function widgetAppRuntimeReady(): void {
  runtimeReady = true
  drain()
}

function drain(): void {
  if (!activate || !runtimeReady) return
  for (const id of pending) activate(id)
  pending.clear()
}

export function widgetWindow(id: string): BrowserWindow | undefined { return windows.get(id) }

export function widgetAppForContents(contents: WebContents): string | undefined {
  for (const [id, window] of windows) {
    if (!window.isDestroyed() && window.webContents === contents) return id
  }
  return undefined
}

export function trackWidgetWindow(id: string, window: BrowserWindow, onLastClose: () => void): void {
  windows.set(id, window)
  window.once('closed', () => {
    windows.delete(id)
    if (!windows.size) onLastClose()
  })
}
