import { ExtensionManifestSchema } from '@kun/extension-api'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExtensionViewSessionRegistry } from '../extensions/extension-view-sessions'
import { NativeDialogCoordinator } from '../native-dialog-coordinator'
import {
  registerExtensionIpcHandlers,
  startExtensionNotificationPump,
  startExtensionSecretRevealConsentPump,
  type ExtensionWorkbenchEnvironment
} from './register-extension-ipc-handlers'

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>(),
  listeners: new Map<string, (event: unknown, payload?: unknown) => void>(),
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
  showMessageBox: vi.fn(),
  openPath: vi.fn(),
  showItemInFolder: vi.fn(),
  fromId: vi.fn()
}))

vi.mock('electron', () => ({
  protocol: {
    registerSchemesAsPrivileged: vi.fn()
  },
  dialog: {
    showOpenDialog: electronMock.showOpenDialog,
    showSaveDialog: electronMock.showSaveDialog,
    showMessageBox: electronMock.showMessageBox
  },
  shell: {
    openPath: electronMock.openPath,
    showItemInFolder: electronMock.showItemInFolder
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, payload?: unknown) => Promise<unknown>) => {
      electronMock.handlers.set(channel, handler)
    }),
    on: vi.fn((channel: string, listener: (event: unknown, payload?: unknown) => void) => {
      electronMock.listeners.set(channel, listener)
    })
  },
  webContents: {
    fromId: electronMock.fromId
  }
}))

vi.mock('../main-window', () => ({
  trustedWorkbenchRendererUrl: () => 'http://127.0.0.1:5173/index.html'
}))

export function fixture() {
  const mainFrame = {
    processId: 100,
    routingId: 200,
    url: 'http://127.0.0.1:5173/index.html'
  }
  let mainDestroyedListener: (() => void) | undefined
  const mainContents = {
    id: 1,
    mainFrame,
    once: vi.fn((event: string, listener: () => void) => {
      if (event === 'destroyed') mainDestroyedListener = listener
    }),
    send: vi.fn(),
    isDestroyed: () => false
  }
  const mainWindow = { isDestroyed: () => false, webContents: mainContents }
  const runtimeRequest = vi.fn(async (
    _path: string,
    _method?: string,
    _body?: string,
    _headers?: Record<string, string>
  ) => ({
    ok: true,
    status: 200,
    body: JSON.stringify({ result: { ok: true } })
  }))
  const viewSessions = new ExtensionViewSessionRegistry(() => 1_000)
  const viewProtocols = {
    prepare: vi.fn(),
    assertPrepared: vi.fn(),
    isPreparedInitialNavigation: vi.fn(() => false),
    dispose: vi.fn(() => true),
    disposeAll: vi.fn()
  }
  const mediaProtocols = {
    createLease: vi.fn(async (input: { handleId: string; mimeType?: string }) => ({
      leaseId: 'lease_123456789012',
      handleId: input.handleId,
      url: 'kun-media://lease/opaque-lease-token',
      mimeType: input.mimeType ?? 'application/octet-stream',
      expiresAt: '2026-07-13T00:05:00.000Z'
    })),
    revokeLease: vi.fn(() => true)
  }
  const externalBrowserState = {
    sessionId: 'view_123456789012',
    siteId: 'bilibili',
    presentation: 'mobile' as const,
    url: 'https://www.bilibili.com/',
    title: 'Bilibili',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    zoomFactor: 1
  }
  const externalBrowsers = {
    mount: vi.fn(() => externalBrowserState),
    activate: vi.fn(() => externalBrowserState),
    updateBounds: vi.fn(() => externalBrowserState),
    navigate: vi.fn(() => externalBrowserState),
    command: vi.fn(() => externalBrowserState),
    state: vi.fn(() => externalBrowserState),
    disposeAll: vi.fn()
  }
  const contentScripts = {
    sync: vi.fn(async (_sender: unknown, request: { protectedSurface?: string }) =>
      request.protectedSurface
        ? {
            ok: false as const,
            code: 'EXTENSION_PROTECTED_SURFACE_DENIED',
            message: 'Host content scripts cannot run in a protected surface.',
            reloadScheduled: false
          }
        : { ok: true as const, active: [] }),
    bootstrap: vi.fn(() => ({ version: 1, generation: 'test', bindings: [] })),
    handleBridgeRequest: vi.fn(),
    clearFrame: vi.fn(async () => undefined),
    disposeFrame: vi.fn(async () => undefined),
    revokeExtension: vi.fn(async () => true),
    recentDiagnostics: vi.fn(() => [{
      code: 'HOST_DOM_EXTENSION_DIAGNOSTIC',
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      contributionId: 'dom',
      workspaceScope: 'global',
      message: 'Selector missing.',
      at: '2026-07-11T00:00:00.000Z'
    }])
  }
  const descriptors = {
    resolvePackage: vi.fn(),
    resolveView: vi.fn(),
    resolveHostContentScript: vi.fn()
  }
  const protectedActions = {
    revokeSender: vi.fn(),
    authorize: vi.fn(),
    consume: vi.fn(),
    authorizeAndPerform: vi.fn(async (
      _binding: unknown,
      _copy: unknown,
      perform: () => Promise<unknown>
    ) => perform()),
    performAfterProtectedDecision: vi.fn(async (
      _binding: unknown,
      _protectedWindowSessionId: string,
      perform: () => Promise<unknown>
    ) => perform())
  }
  const credentialSurface = { prompt: vi.fn(), presentAuthorization: vi.fn() }
  let workbenchEnvironment: ExtensionWorkbenchEnvironment = {
    theme: {
      kind: 'light' as const,
      tokens: { foreground: '#233659' },
      zoomFactor: 1,
      reducedMotion: false
    },
    locale: { language: 'en', direction: 'ltr' as const, messages: {} }
  }
  const options = {
    getMainWindow: () => mainWindow as never,
    runtimeRequest,
    descriptors: descriptors as never,
    viewSessions,
    viewProtocols: viewProtocols as never,
    externalBrowsers: externalBrowsers as never,
    mediaProtocols: mediaProtocols as never,
    protectedActions: protectedActions as never,
    credentialSurface: credentialSurface as never,
    contentScripts: contentScripts as never,
    getWorkbenchEnvironment: async () => workbenchEnvironment
  }
  const registration = registerExtensionIpcHandlers(options)
  return {
    runtimeRequest,
    mainContents,
    viewSessions,
    viewProtocols,
    mediaProtocols,
    externalBrowsers,
    contentScripts,
    descriptors,
    protectedActions,
    credentialSurface,
    registration,
    options,
    setWorkbenchEnvironment(environment: typeof workbenchEnvironment) {
      workbenchEnvironment = environment
    },
    triggerMainDestroyed() {
      mainDestroyedListener?.()
    },
    trustedEvent: { sender: mainContents, senderFrame: mainFrame },
    untrustedEvent: { sender: { id: 99 }, senderFrame: { processId: 999, routingId: 999 } }
  }
}

export function resetExtensionIpcHandlerTestState(): void {
  electronMock.handlers.clear()
  electronMock.listeners.clear()
  electronMock.showOpenDialog.mockReset()
  electronMock.showSaveDialog.mockReset()
  electronMock.showMessageBox.mockReset()
  electronMock.openPath.mockReset()
  electronMock.openPath.mockResolvedValue('')
  electronMock.showItemInFolder.mockReset()
  electronMock.showMessageBox.mockResolvedValue({ response: 0 })
  electronMock.fromId.mockReset()
}

export function getExtensionIpcElectronMock(): typeof electronMock {
  return electronMock
}

export {
  ExtensionManifestSchema,
  NativeDialogCoordinator,
  createHash,
  join,
  registerExtensionIpcHandlers,
  resolve,
  startExtensionNotificationPump,
  startExtensionSecretRevealConsentPump
}
export type { ExtensionWorkbenchEnvironment }
