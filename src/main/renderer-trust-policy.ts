import type { BrowserWindow, IpcMainInvokeEvent, WebFrameMain } from 'electron'
import { isRemoteClientSender } from './remote/remote-sender'

export type RendererSurface = 'workbench' | 'storage-relocation' | 'runtime-data-recovery'

/** Compare only the immutable renderer origin and entry document; query/hash are UI state. */
export function isTrustedRendererUrl(candidate: string, trustedRendererUrl: string): boolean {
  try {
    const actual = new URL(candidate)
    const expected = new URL(trustedRendererUrl)
    return actual.protocol === expected.protocol &&
      actual.username === expected.username &&
      actual.password === expected.password &&
      actual.host === expected.host &&
      normalizeRendererPathname(actual.pathname) === normalizeRendererPathname(expected.pathname)
  } catch {
    return false
  }
}

export function normalizeRendererPathname(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
}

export function rendererSurfaceForUrl(candidate: string): RendererSurface | null {
  try {
    const url = new URL(candidate)
    const storage = url.searchParams.get('storageRelocation') === '1'
    const runtimeRecovery = url.searchParams.get('runtimeMigrationRecovery') === '1'
    if (storage && runtimeRecovery) return null
    if (storage) return 'storage-relocation'
    if (runtimeRecovery) return 'runtime-data-recovery'
    return 'workbench'
  } catch {
    return null
  }
}

export function isTrustedRendererSurfaceUrl(
  candidate: string,
  trustedRendererUrl: string,
  surface: RendererSurface
): boolean {
  return isTrustedRendererUrl(candidate, trustedRendererUrl) &&
    rendererSurfaceForUrl(candidate) === surface
}

/**
 * Auxiliary workbench windows (e.g. the Mission Control popout) load the
 * same trusted renderer bundle as the main window, so their main frame may
 * invoke workbench IPC. Registration is main-process controlled and the
 * entry is removed when the window closes.
 */
const auxiliaryWorkbenchWindows = new Set<BrowserWindow>()

export function registerAuxiliaryWorkbenchWindow(window: BrowserWindow): void {
  auxiliaryWorkbenchWindows.add(window)
  window.once('closed', () => auxiliaryWorkbenchWindows.delete(window))
}

export function trustedRendererSenderIsCurrent(
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  window: BrowserWindow | null,
  options: {
    trustedRendererUrl: string
    surface: RendererSurface
  }
): boolean {
  // Remote clients are authenticated by the Remote gateway and bridged in as
  // workbench-equivalent senders; the invoke allowlist still gates channels.
  if (isRemoteClientSender(event.sender)) return options.surface === 'workbench'
  if (senderMatchesWindow(event, window, options)) return true
  if (options.surface === 'workbench') {
    for (const auxiliary of auxiliaryWorkbenchWindows) {
      if (senderMatchesWindow(event, auxiliary, options)) return true
    }
  }
  return false
}

function senderMatchesWindow(
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  window: BrowserWindow | null,
  options: {
    trustedRendererUrl: string
    surface: RendererSurface
  }
): boolean {
  const senderFrame = event.senderFrame
  const mainFrame = window?.webContents.mainFrame
  return Boolean(
    window &&
    !window.isDestroyed() &&
    event.sender.id === window.webContents.id &&
    senderFrame &&
    senderFrame.detached !== true &&
    mainFrame &&
    mainFrame.detached !== true &&
    senderFrame.processId === mainFrame.processId &&
    senderFrame.routingId === mainFrame.routingId &&
    frameHasTrustedSurfaceUrl(senderFrame, options)
  )
}

export function frameHasTrustedSurfaceUrl(
  frame: Pick<WebFrameMain, 'url'>,
  options: {
    trustedRendererUrl: string
    surface: RendererSurface
  }
): boolean {
  const url = typeof frame.url === 'string' ? frame.url : ''
  return Boolean(url) && isTrustedRendererSurfaceUrl(url, options.trustedRendererUrl, options.surface)
}
