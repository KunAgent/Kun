import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  mergeScheduleSettings,
  defaultClawSettings,
  defaultDesignSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  defaultTerminalSettings,
  mergeKunRuntimeSettings,
  type AppSettingsPatch,
  type AppSettingsV1
} from '../../shared/app-settings'
import { registerAppIpcHandlers } from './register-app-ipc-handlers'
import {
  ApprovalConsentVerifier,
  KUN_APPROVAL_CONSENT_HEADER
} from '../../../kun/src/server/approval-consent.js'

export const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()

export function createGate(): { promise: Promise<void>; release: () => void } {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}

const electronMock = vi.hoisted(() => ({
  showMessageBox: vi.fn(),
  openPath: vi.fn(async () => ''),
  showItemInFolder: vi.fn(),
  appLocale: 'en-US',
  userDataPath: '/tmp/kun-user-data',
  setBadgeCount: vi.fn(() => true),
  writeText: vi.fn()
}))
const uiPluginMocks = vi.hoisted(() => ({
  ensureBundledUiPlugins: vi.fn(async () => undefined),
  installUiPluginFromDirectory: vi.fn(),
  listUiPlugins: vi.fn(),
  loadUiPluginFigures: vi.fn(),
  removeUiPlugin: vi.fn(),
  activate: vi.fn(async (_pluginId: string, _css: string) => undefined),
  deactivate: vi.fn(async () => undefined)
}))
const protectedProviderMocks = vi.hoisted(() => ({
  probeClaudeSubscription: vi.fn(async () => ({ ok: true as const, latencyMs: 1 })),
  fetchSdkModels: vi.fn(async () => ['claude-model']),
  discoverCursorSubscription: vi.fn(async () => ({
    account: { apiKeyName: 'registry-key' },
    models: [{ id: 'cursor-model', displayName: 'Cursor Model' }]
  }))
}))
const telegramMocks = vi.hoisted(() => ({
  verifyTelegramBotToken: vi.fn(async () => ({
    ok: true as const,
    botId: 123,
    botUsername: 'kun_test_bot',
    botFirstName: 'Kun'
  }))
}))

vi.mock('electron', () => ({
  protocol: {
    registerSchemesAsPrivileged: vi.fn()
  },
  app: {
    quit: vi.fn(),
    getPath: vi.fn(() => electronMock.userDataPath),
    getAppPath: vi.fn(() => '/tmp/kun-app'),
    getLocale: vi.fn(() => electronMock.appLocale),
    isPackaged: false,
    setBadgeCount: electronMock.setBadgeCount
  },
  dialog: { showMessageBox: electronMock.showMessageBox },
  clipboard: { writeText: electronMock.writeText },
  shell: {
    openPath: electronMock.openPath,
    showItemInFolder: electronMock.showItemInFolder
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, payload?: unknown) => Promise<unknown>) => {
      handlers.set(channel, handler)
    })
  }
}))

vi.mock('../services/ui-plugin-service', () => ({
  installUiPluginFromDirectory: uiPluginMocks.installUiPluginFromDirectory,
  listUiPlugins: uiPluginMocks.listUiPlugins,
  loadUiPluginFigures: uiPluginMocks.loadUiPluginFigures,
  removeUiPlugin: uiPluginMocks.removeUiPlugin
}))

vi.mock('../ui-plugin-bundled', () => ({
  ensureBundledUiPlugins: uiPluginMocks.ensureBundledUiPlugins
}))

vi.mock('../services/ui-plugin-cdp-theme-controller', () => ({
  UiPluginCdpThemeController: class {
    activePluginId: string | null = null

    async activate(pluginId: string, css: string): Promise<void> {
      await uiPluginMocks.activate(pluginId, css)
      this.activePluginId = pluginId
    }

    async deactivate(): Promise<void> {
      await uiPluginMocks.deactivate()
      this.activePluginId = null
    }
  }
}))

vi.mock('../claude-subscription-auth', async () => ({
  ...await vi.importActual<typeof import('../claude-subscription-auth')>('../claude-subscription-auth'),
  probeClaudeSubscription: protectedProviderMocks.probeClaudeSubscription
}))

vi.mock('../claude-subscription-models', async () => ({
  ...await vi.importActual<typeof import('../claude-subscription-models')>('../claude-subscription-models'),
  fetchSdkModels: protectedProviderMocks.fetchSdkModels
}))

vi.mock('../cursor-subscription-models', async () => ({
  ...await vi.importActual<typeof import('../cursor-subscription-models')>('../cursor-subscription-models'),
  discoverCursorSubscription: protectedProviderMocks.discoverCursorSubscription
}))

vi.mock('../telegram-runtime', () => ({
  verifyTelegramBotToken: telegramMocks.verifyTelegramBotToken
}))

export function settings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 0.82,
    chatContentMaxWidthPx: 896,
    composerSendKey: 'enter',
    provider: defaultModelProviderSettings(),
    agents: {
      kun: defaultKunRuntimeSettings()
    },
    workspaceRoot: '/tmp/workspace',
    conversationWorkspaceRoot: '~/Documents/Kun',
    log: { enabled: false, retentionDays: 7 },
    checkpointCleanup: { createEnabled: false, enabled: false, intervalDays: 3 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    design: defaultDesignSettings(),
    terminal: defaultTerminalSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: '',
    chatWelcomeMessage: '',
    codeAgentPresets: [],
    disabledSkillIds: []
  }
}

export function settingsWithProtectedSubscriptionCredentials(): AppSettingsV1 {
  const current = settings()
  const defaultProfile = current.provider.providers[0]!
  return {
    ...current,
    provider: {
      ...current.provider,
      providers: [
        defaultProfile,
        {
          ...defaultProfile,
          id: 'claude-subscription',
          name: 'Claude subscription',
          kind: 'agent-sdk',
          apiKey: 'registry-claude-secret'
        },
        {
          ...defaultProfile,
          id: 'cursor-subscription',
          name: 'Cursor subscription',
          kind: 'cursor-sdk',
          apiKey: 'registry-cursor-secret'
        }
      ]
    }
  }
}

export function settingsWithPlaintextModelCredentials(): AppSettingsV1 {
  const current = settings()
  return {
    ...current,
    provider: {
      ...current.provider,
      apiKey: 'legacy-provider-secret',
      providers: current.provider.providers.map((provider, index) => ({
        ...provider,
        apiKey: `provider-secret-${index}`
      }))
    },
    agents: {
      ...current.agents,
      kun: {
        ...current.agents.kun,
        apiKey: 'runtime-model-secret',
        runtimeToken: 'runtime-auth-token',
        imageGeneration: {
          ...current.agents.kun.imageGeneration,
          apiKey: 'image-secret'
        },
        speechToText: {
          ...current.agents.kun.speechToText,
          apiKey: 'speech-to-text-secret'
        },
        textToSpeech: {
          ...current.agents.kun.textToSpeech,
          apiKey: 'text-to-speech-secret'
        },
        musicGeneration: {
          ...current.agents.kun.musicGeneration,
          apiKey: 'music-secret'
        },
        videoGeneration: {
          ...current.agents.kun.videoGeneration,
          apiKey: 'video-secret'
        }
      }
    }
  }
}

export function expectRendererModelCredentialsRedacted(value: unknown): void {
  const projected = value as AppSettingsV1
  expect(projected.provider.apiKey).toBe('')
  expect(projected.provider.providers.every((provider) => provider.apiKey === '')).toBe(true)
  expect(projected.agents.kun.apiKey).toBe('')
  expect(projected.agents.kun.imageGeneration.apiKey).toBe('')
  expect(projected.agents.kun.imageGeneration.apiKeyConfigured).toBe(true)
  expect(projected.agents.kun.speechToText.apiKey).toBe('')
  expect(projected.agents.kun.speechToText.apiKeyConfigured).toBe(true)
  expect(projected.agents.kun.textToSpeech.apiKey).toBe('')
  expect(projected.agents.kun.textToSpeech.apiKeyConfigured).toBe(true)
  expect(projected.agents.kun.musicGeneration.apiKey).toBe('')
  expect(projected.agents.kun.musicGeneration.apiKeyConfigured).toBe(true)
  expect(projected.agents.kun.videoGeneration.apiKey).toBe('')
  expect(projected.agents.kun.videoGeneration.apiKeyConfigured).toBe(true)
  expect(projected.agents.kun.runtimeToken).toBe('')
}

export function registerOptions(overrides: Partial<Parameters<typeof import('./register-app-ipc-handlers').registerAppIpcHandlers>[0]> = {}) {
  const applySettingsPatch = vi.fn(async () => settings())
  const saveSettingsPatch = vi.fn(async () => settings())
  return {
    store: { load: vi.fn(async () => settings()) } as never,
    getMainWindow: () => null,
    assertRendererRuntimeReady: () => undefined,
    applySettingsPatch,
    saveSettingsPatch,
    resetUnreadableCredentials: vi.fn(async () => ({
      reset: true as const,
      backupPath: '/tmp/credential-recovery',
      movedItems: ['secret.key']
    })),
    runtimeRequest: vi.fn() as never,
    acquireRuntimeRequestLease: vi.fn(async () => ({
      runtimeToken: 'runtime-auth-token',
      request: vi.fn(async () => ({ ok: true, status: 200, body: '{}' }))
    })),
    getRuntimeSettingsSyncStatus: () => ({
      state: 'idle' as const,
      generation: 0,
      at: '2026-07-22T00:00:00.000Z'
    }),
    restartRuntime: vi.fn(async () => undefined),
    restartKunServe: vi.fn(async () => undefined),
    fetchUpstreamModels: vi.fn() as never,
    getClawRuntime: () => null,
    getScheduleRuntime: () => null,
    getDaemonRuntime: () => null,
    getWorkflowRuntime: () => null,
    startFeishuInstallQrcode: vi.fn() as never,
    pollFeishuInstall: vi.fn() as never,
    startWeixinInstallQrcode: vi.fn() as never,
    pollWeixinInstall: vi.fn() as never,
    resolveKunConfigPath: () => '/tmp/kun.json',
    resolveSettingsConfigPath: () => '/tmp/kun-settings.json',
    showTurnCompleteNotification: vi.fn() as never,
    getAppVersion: () => '0.1.0',
    readGuiUpdateState: vi.fn() as never,
    loadGuiUpdaterModule: vi.fn() as never,
    resolveLogDirectory: () => '/tmp/logs',
    logError: vi.fn(),
    workspacePreviewProtocols: {
      createLease: vi.fn(async () => ({ ok: false, message: 'unavailable' })),
      release: vi.fn(() => ({ ok: true }))
    } as never,
    ...overrides
  }
}


export function resetAppIpcHandlerTestState(): void {
    handlers.clear()
    electronMock.appLocale = 'en-US'
    electronMock.userDataPath = '/tmp/kun-user-data'
    electronMock.showMessageBox.mockReset()
    electronMock.openPath.mockClear()
    electronMock.showItemInFolder.mockClear()
    electronMock.setBadgeCount.mockClear()
    electronMock.writeText.mockClear()
    uiPluginMocks.ensureBundledUiPlugins.mockClear()
    uiPluginMocks.installUiPluginFromDirectory.mockReset()
    uiPluginMocks.listUiPlugins.mockReset()
    uiPluginMocks.loadUiPluginFigures.mockReset()
    uiPluginMocks.removeUiPlugin.mockReset()
    uiPluginMocks.activate.mockClear()
    uiPluginMocks.deactivate.mockClear()
    protectedProviderMocks.probeClaudeSubscription.mockClear()
    protectedProviderMocks.fetchSdkModels.mockClear()
    protectedProviderMocks.discoverCursorSubscription.mockClear()
    telegramMocks.verifyTelegramBotToken.mockClear()
}

export function cleanupAppIpcHandlerTestState(): void {
  vi.unstubAllEnvs()
}

export function getAppIpcElectronMock(): typeof electronMock {
  return electronMock
}

export function getUiPluginMocks(): typeof uiPluginMocks {
  return uiPluginMocks
}

export function getProtectedProviderMocks(): typeof protectedProviderMocks {
  return protectedProviderMocks
}

export function getTelegramMocks(): typeof telegramMocks {
  return telegramMocks
}

export {
  ApprovalConsentVerifier,
  EventEmitter,
  KUN_APPROVAL_CONSENT_HEADER,
  existsSync,
  join,
  mergeKunRuntimeSettings,
  mergeScheduleSettings,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  registerAppIpcHandlers,
  renameSync,
  rmSync,
  tmpdir,
  writeFileSync
}
export type { AppSettingsPatch, AppSettingsV1 }
