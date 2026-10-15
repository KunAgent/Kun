import { app, Notification, ipcMain, type BrowserWindow } from 'electron'
import { z } from 'zod'
import { MAX_APP_BADGE_COUNT } from '../shared/kun-gui-api'
import { USER_ATTENTION_CHANNEL } from '../shared/user-attention'
import { assertTrustedWorkbenchSender, parseIpcPayload } from './ipc/app-ipc-handler-utils'
import { displayNotification } from './notification-display'

const requestSchema = z
  .object({
    key: z.string().trim().min(1).max(256),
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().max(240),
    badge: z.number().int().min(0).max(MAX_APP_BADGE_COUNT)
  })
  .strict()

let rendererBadge = 0
let attentionBadge = 0
const notified = new Set<string>()

/** Writes the renderer's unread badge plus anything waiting for attention. */
export function applyAppBadge(nextRendererBadge = rendererBadge): boolean {
  rendererBadge = nextRendererBadge
  if (process.platform !== 'darwin' && process.platform !== 'linux') return false
  try {
    return app.setBadgeCount(Math.min(rendererBadge + attentionBadge, MAX_APP_BADGE_COUNT))
  } catch {
    return false
  }
}

export function registerUserAttentionIpc(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle(USER_ATTENTION_CHANNEL, async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    const request = parseIpcPayload(USER_ATTENTION_CHANNEL, requestSchema, payload)
    attentionBadge = request.badge
    applyAppBadge()
    if (request.badge === 0) {
      notified.clear()
      return { shown: false }
    }
    const window = getMainWindow()
    if (window && !window.isDestroyed() && window.isFocused()) return { shown: false }
    if (process.platform === 'darwin') app.dock?.bounce('informational')
    else if (window && !window.isDestroyed()) window.flashFrame(true)
    if (notified.has(request.key) || !Notification.isSupported()) return { shown: false }
    notified.add(request.key)
    const notification = new Notification({ title: request.title, body: request.body })
    notification.on('click', () => {
      const target = getMainWindow()
      if (!target || target.isDestroyed()) return
      if (target.isMinimized()) target.restore()
      target.show()
      target.focus()
    })
    const result = await displayNotification(notification)
    return { shown: result.ok && result.shown }
  })
}
