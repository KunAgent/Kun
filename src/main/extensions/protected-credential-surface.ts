import { BrowserWindow, ipcMain, screen, shell, type BrowserWindowConstructorOptions } from 'electron'
import { randomBytes } from 'node:crypto'
import { logWarn } from '../logger'
import {
  buildProtectedExtensionConsentDataUrl,
  type ProtectedExtensionConsentDocument
} from './protected-extension-prompt'

type CredentialSession = {
  id: string
  window: BrowserWindow
  resolve: (result: ProtectedCredentialResult) => void
}

type AuthorizationSession = {
  id: string
  window: BrowserWindow
  verificationUrl: string
  resolve: () => void
}

type ConsentSession = {
  id: string
  window: BrowserWindow
  resolve: (approved: boolean) => void
}

export type ProtectedCredentialResult =
  | { submitted: true; value: string; protectedWindowSessionId: string }
  | { submitted: false; protectedWindowSessionId: string }

export type ProtectedCredentialPrompt = {
  title: string
  message: string
  detail?: string
  label?: string
  placeholder?: string
  submitLabel?: string
  cancelLabel?: string
  /** Defaults to true so credential prompts never accidentally reveal input. */
  secret?: boolean
}

export type ProtectedAuthorizationPrompt = {
  title: string
  message: string
  detail?: string
  verificationUrl: string
  userCode?: string
  expiresAt?: string
  openLabel?: string
  closeLabel?: string
}

/**
 * A dedicated modal with no workbench preload, no Webviews and no extension
 * content. Extension supplied strings are escaped and rendered as plain text.
 */
export class ProtectedCredentialSurfaceController {
  private readonly sessions = new Map<string, CredentialSession>()
  private readonly authorizationSessions = new Map<string, AuthorizationSession>()
  private readonly consentSessions = new Map<string, ConsentSession>()
  private registered = false

  constructor(private readonly preloadPath: string) {}

  register(): void {
    if (this.registered) return
    this.registered = true
    ipcMain.on('extension:protected-surface:submit', (event, payload: unknown) => {
      const parsed = parseSurfacePayload(payload, true)
      if (!parsed) return
      const session = this.sessions.get(parsed.sessionId)
      if (!session || session.window.webContents.id !== event.sender.id) return
      const value = parsed.value.trim()
      if (!value || value.length > 64 * 1024) return
      this.finish(session, {
        submitted: true,
        value,
        protectedWindowSessionId: session.id
      })
    })
    ipcMain.on('extension:protected-surface:cancel', (event, payload: unknown) => {
      const parsed = parseSurfacePayload(payload, false)
      if (!parsed) return
      const session = this.sessions.get(parsed.sessionId)
      if (!session || session.window.webContents.id !== event.sender.id) return
      this.finish(session, { submitted: false, protectedWindowSessionId: session.id })
    })
    ipcMain.on('extension:protected-surface:open-external', (event, payload: unknown) => {
      const parsed = parseSurfacePayload(payload, false)
      if (!parsed) return
      const session = this.authorizationSessions.get(parsed.sessionId)
      if (!session || session.window.webContents.id !== event.sender.id) return
      void shell.openExternal(session.verificationUrl).catch(() => undefined)
    })
    ipcMain.on('extension:protected-surface:close', (event, payload: unknown) => {
      const parsed = parseSurfacePayload(payload, false)
      if (!parsed) return
      const session = this.authorizationSessions.get(parsed.sessionId)
      if (!session || session.window.webContents.id !== event.sender.id) return
      this.finishAuthorization(session)
    })
    ipcMain.on('extension:protected-surface:consent-approve', (event, payload: unknown) => {
      const parsed = parseSurfacePayload(payload, false)
      const session = parsed ? this.consentSessions.get(parsed.sessionId) : undefined
      if (!parsed || !session || session.window.webContents.id !== event.sender.id) {
        this.logDroppedSurfaceMessage('consent-approve', parsed?.sessionId, event.sender.id)
        return
      }
      this.finishConsent(session, true)
    })
    ipcMain.on('extension:protected-surface:consent-cancel', (event, payload: unknown) => {
      const parsed = parseSurfacePayload(payload, false)
      const session = parsed ? this.consentSessions.get(parsed.sessionId) : undefined
      if (!parsed || !session || session.window.webContents.id !== event.sender.id) {
        this.logDroppedSurfaceMessage('consent-cancel', parsed?.sessionId, event.sender.id)
        return
      }
      this.finishConsent(session, false)
    })
  }

  async prompt(
    parent: BrowserWindow | null,
    prompt: ProtectedCredentialPrompt
  ): Promise<ProtectedCredentialResult> {
    this.register()
    const id = randomBytes(24).toString('base64url')
    const webPreferences: NonNullable<BrowserWindowConstructorOptions['webPreferences']> = {
      preload: this.preloadPath,
      additionalArguments: [`--kun-protected-surface-session=${id}`],
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      partition: `temp:kun-protected-${id}`
    }
    const window = new BrowserWindow({
      width: 520,
      height: 360,
      minWidth: 460,
      minHeight: 320,
      show: false,
      modal: Boolean(parent),
      parent: parent && !parent.isDestroyed() ? parent : undefined,
      title: prompt.title,
      autoHideMenuBar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      acceptFirstMouse: true,
      webPreferences
    })
    window.setMenu(null)
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false)
    })
    window.webContents.session.setPermissionCheckHandler(() => false)

    const result = new Promise<ProtectedCredentialResult>((resolve) => {
      const session: CredentialSession = { id, window, resolve }
      this.sessions.set(id, session)
      this.bindSurfaceHealth(window, () =>
        this.finish(session, { submitted: false, protectedWindowSessionId: session.id }))
      if (parent && !parent.isDestroyed()) {
        parent.once('closed', () =>
          this.finish(session, { submitted: false, protectedWindowSessionId: session.id }))
      }
      window.once('closed', () => {
        if (this.sessions.get(id) !== session) return
        this.sessions.delete(id)
        resolve({ submitted: false, protectedWindowSessionId: id })
      })
    })
    try {
      await window.loadURL(buildProtectedCredentialDataUrl(prompt))
    } catch (error) {
      logWarn('protected-surface', 'Credential window failed to load.', {
        message: error instanceof Error ? error.message : String(error)
      })
      if (!window.isDestroyed()) window.destroy()
    }
    if (!window.isDestroyed()) {
      window.show()
      window.focus()
    }
    return result
  }

  async presentAuthorization(
    parent: BrowserWindow | null,
    prompt: ProtectedAuthorizationPrompt
  ): Promise<void> {
    this.register()
    const verificationUrl = safeAuthorizationUrl(prompt.verificationUrl)
    const id = randomBytes(24).toString('base64url')
    const window = this.createWindow(parent, id, prompt.title, 560, 430)
    const result = new Promise<void>((resolve) => {
      const session: AuthorizationSession = { id, window, verificationUrl, resolve }
      this.authorizationSessions.set(id, session)
      this.bindSurfaceHealth(window, () => this.finishAuthorization(session))
      if (parent && !parent.isDestroyed()) {
        parent.once('closed', () => this.finishAuthorization(session))
      }
      window.once('closed', () => {
        if (this.authorizationSessions.get(id) !== session) return
        this.authorizationSessions.delete(id)
        resolve()
      })
    })
    try {
      await window.loadURL(buildProtectedAuthorizationDataUrl(prompt))
    } catch (error) {
      logWarn('protected-surface', 'Authorization window failed to load.', {
        message: error instanceof Error ? error.message : String(error)
      })
      if (!window.isDestroyed()) window.destroy()
    }
    if (!window.isDestroyed()) {
      window.show()
      window.focus()
    }
    return result
  }

  async promptConsent(
    parent: BrowserWindow | null,
    prompt: ProtectedExtensionConsentDocument
  ): Promise<boolean> {
    this.register()
    const id = randomBytes(24).toString('base64url')
    const display = parent && !parent.isDestroyed()
      ? screen.getDisplayMatching(parent.getBounds())
      : screen.getPrimaryDisplay()
    const available = display.workAreaSize
    const width = Math.max(460, Math.min(680, available.width - 48))
    const height = Math.max(520, Math.min(760, Math.round(available.height * 0.78), available.height - 48))
    const window = this.createWindow(parent, id, prompt.title, width, height)
    const result = new Promise<boolean>((resolve) => {
      const session: ConsentSession = { id, window, resolve }
      this.consentSessions.set(id, session)
      this.bindSurfaceHealth(window, () => this.finishConsent(session, false))
      if (parent && !parent.isDestroyed()) {
        parent.once('closed', () => this.finishConsent(session, false))
      }
      window.once('closed', () => {
        if (this.consentSessions.get(id) !== session) return
        this.consentSessions.delete(id)
        resolve(false)
      })
    })
    try {
      await window.loadURL(buildProtectedExtensionConsentDataUrl(prompt))
    } catch (error) {
      logWarn('protected-surface', 'Consent window failed to load.', {
        message: error instanceof Error ? error.message : String(error)
      })
      if (!window.isDestroyed()) window.destroy()
    }
    if (!window.isDestroyed()) {
      window.show()
      window.focus()
    }
    return result
  }

  dispose(): void {
    for (const session of [...this.sessions.values()]) {
      this.finish(session, { submitted: false, protectedWindowSessionId: session.id })
    }
    for (const session of [...this.authorizationSessions.values()]) {
      this.finishAuthorization(session)
    }
    for (const session of [...this.consentSessions.values()]) {
      this.finishConsent(session, false)
    }
  }

  private finish(session: CredentialSession, result: ProtectedCredentialResult): void {
    if (this.sessions.get(session.id) !== session) return
    this.sessions.delete(session.id)
    session.resolve(result)
    if (!session.window.isDestroyed()) session.window.close()
  }

  private finishAuthorization(session: AuthorizationSession): void {
    if (this.authorizationSessions.get(session.id) !== session) return
    this.authorizationSessions.delete(session.id)
    session.resolve()
    if (!session.window.isDestroyed()) session.window.close()
  }

  private finishConsent(session: ConsentSession, approved: boolean): void {
    if (this.consentSessions.get(session.id) !== session) return
    this.consentSessions.delete(session.id)
    session.resolve(approved)
    if (!session.window.isDestroyed()) session.window.close()
  }

  /**
   * A protected surface whose preload or renderer died would otherwise stay
   * open as a permanently unresponsive modal. `before-input-event` keeps an
   * Escape dismissal working even when the in-page listeners never attached.
   */
  private bindSurfaceHealth(window: BrowserWindow, finish: () => void): void {
    window.webContents.once('preload-error', (_event, preloadPath, error) => {
      logWarn('protected-surface', 'Protected window preload failed.', {
        preloadPath,
        message: error instanceof Error ? error.message : String(error)
      })
      finish()
    })
    window.webContents.on('render-process-gone', (_event, details) => {
      logWarn('protected-surface', 'Protected window renderer exited unexpectedly.', {
        reason: details.reason
      })
      finish()
    })
    window.webContents.on('before-input-event', (_event, input) => {
      if (input.type !== 'keyDown' || input.key !== 'Escape') return
      finish()
    })
  }

  private logDroppedSurfaceMessage(
    channel: string,
    sessionId: string | undefined,
    senderId: number
  ): void {
    logWarn('protected-surface', 'Ignored protected surface message.', {
      channel,
      sessionId: sessionId ?? null,
      senderId
    })
  }

  private createWindow(
    parent: BrowserWindow | null,
    id: string,
    title: string,
    width: number,
    height: number
  ): BrowserWindow {
    const webPreferences: NonNullable<BrowserWindowConstructorOptions['webPreferences']> = {
      preload: this.preloadPath,
      additionalArguments: [`--kun-protected-surface-session=${id}`],
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      partition: `temp:kun-protected-${id}`
    }
    const window = new BrowserWindow({
      width,
      height,
      minWidth: Math.min(width, 460),
      minHeight: Math.min(height, 320),
      show: false,
      modal: Boolean(parent),
      parent: parent && !parent.isDestroyed() ? parent : undefined,
      title,
      autoHideMenuBar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      acceptFirstMouse: true,
      webPreferences
    })
    window.setMenu(null)
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false)
    })
    window.webContents.session.setPermissionCheckHandler(() => false)
    return window
  }
}

function parseSurfacePayload(
  payload: unknown,
  requireValue: boolean
): { sessionId: string; value: string } | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const record = payload as Record<string, unknown>
  if (typeof record.sessionId !== 'string' || record.sessionId.length < 16 || record.sessionId.length > 256) {
    return undefined
  }
  if (requireValue && typeof record.value !== 'string') return undefined
  return { sessionId: record.sessionId, value: typeof record.value === 'string' ? record.value : '' }
}

export function buildProtectedCredentialDataUrl(prompt: ProtectedCredentialPrompt): string {
  const title = escapeHtml(prompt.title)
  const message = escapeHtml(prompt.message)
  const detail = prompt.detail ? `<p class="detail">${escapeHtml(prompt.detail)}</p>` : ''
  const label = escapeHtml(prompt.label ?? 'Credential')
  const placeholder = escapeHtml(prompt.placeholder ?? '')
  const submitLabel = escapeHtml(prompt.submitLabel ?? 'Save')
  const cancelLabel = escapeHtml(prompt.cancelLabel ?? 'Cancel')
  const inputType = prompt.secret === false ? 'text' : 'password'
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'"><meta name="color-scheme" content="light dark"><title>${title}</title><style>
:root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:light dark}body{margin:0;padding:28px;background:Canvas;color:CanvasText}h1{font-size:20px;margin:0 0 12px}p{font-size:14px;line-height:1.45;margin:0 0 12px}.detail{opacity:.75}label{display:block;font-size:13px;margin:18px 0 7px}input{box-sizing:border-box;width:100%;font:inherit;padding:10px;border:1px solid GrayText;border-radius:6px;background:Field;color:FieldText}.actions{display:flex;justify-content:flex-end;gap:10px;margin-top:22px}button{font:inherit;padding:8px 16px;border-radius:6px;border:1px solid GrayText;background:ButtonFace;color:ButtonText}button[type=submit]{font-weight:600}</style></head><body><h1>${title}</h1><p>${message}</p>${detail}<form id="credential-form"><label for="credential-value">${label}</label><input id="credential-value" type="${inputType}" autocomplete="off" spellcheck="false" placeholder="${placeholder}" maxlength="65536" required><div class="actions"><button id="credential-cancel" type="button">${cancelLabel}</button><button type="submit">${submitLabel}</button></div></form></body></html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

export function buildProtectedAuthorizationDataUrl(prompt: ProtectedAuthorizationPrompt): string {
  const title = escapeHtml(prompt.title)
  const message = escapeHtml(prompt.message)
  const detail = prompt.detail ? `<p class="detail">${escapeHtml(prompt.detail)}</p>` : ''
  const verificationUrl = escapeHtml(safeAuthorizationUrl(prompt.verificationUrl))
  const userCode = prompt.userCode
    ? `<div class="field"><span>User code</span><strong>${escapeHtml(prompt.userCode)}</strong></div>`
    : ''
  const expiresAt = prompt.expiresAt
    ? `<p class="detail">Expires: ${escapeHtml(prompt.expiresAt)}</p>`
    : ''
  const openLabel = escapeHtml(prompt.openLabel ?? 'Open in browser')
  const closeLabel = escapeHtml(prompt.closeLabel ?? 'Done')
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'"><meta name="color-scheme" content="light dark"><title>${title}</title><style>
:root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:light dark}body{margin:0;padding:28px;background:Canvas;color:CanvasText}h1{font-size:20px;margin:0 0 12px}p{font-size:14px;line-height:1.45;margin:0 0 12px}.detail{opacity:.75}.url{word-break:break-all;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;padding:10px;border:1px solid GrayText;border-radius:6px;background:Field;color:FieldText}.field{margin-top:14px}.field span{display:block;font-size:12px;opacity:.7}.field strong{display:inline-block;margin-top:6px;padding:8px 12px;border-radius:6px;background:Field;font:600 18px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em}.actions{display:flex;justify-content:flex-end;gap:10px;margin-top:22px}button{font:inherit;padding:8px 16px;border-radius:6px;border:1px solid GrayText;background:ButtonFace;color:ButtonText}button.primary{font-weight:600}</style></head><body><h1>${title}</h1><p>${message}</p>${detail}<div class="url">${verificationUrl}</div>${userCode}${expiresAt}<div class="actions"><button id="authorization-close" type="button">${closeLabel}</button><button id="authorization-open" class="primary" type="button">${openLabel}</button></div></body></html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

function safeAuthorizationUrl(value: string): string {
  const url = new URL(value)
  if (url.username || url.password) throw new Error('Authorization URL must not contain credentials.')
  if (url.protocol === 'https:') return url.toString()
  if (
    url.protocol === 'http:' &&
    ['127.0.0.1', 'localhost', '::1'].includes(url.hostname.toLowerCase())
  ) return url.toString()
  throw new Error('Authorization URL must use HTTPS (loopback HTTP is allowed).')
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]!)
}
