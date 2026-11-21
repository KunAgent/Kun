import { join } from 'node:path'
import { app, Notification, safeStorage, shell } from 'electron'
import { defaultKunColabSettings, normalizeKunColabSettings } from '../../shared/app-settings-colab'
import type { KunColabSettingsV1 } from '../../shared/app-settings-colab'
import { resolveKunRuntimeSettings, type AppSettingsV1 } from '../../shared/app-settings'
import { ColabBridgeServer, type ColabBridgeLaunch } from './colab-bridge-server'
import type { ColabNotebookAgentRelay } from './colab-notebook-agent-relay'
import { ColabService } from './colab-service'

let colabService: ColabService | null = null
let colabBridge: ColabBridgeServer | null = null
let cachedColabSettings: KunColabSettingsV1 = defaultKunColabSettings()
let settingsGetter: (() => KunColabSettingsV1) | null = null
const subsystemShutdownHooks = new Set<() => Promise<void> | void>()
let notebookAgentRelay: ColabNotebookAgentRelay | null = null

export function setColabNotebookAgentRelay(relay: ColabNotebookAgentRelay | null): void {
  notebookAgentRelay = relay
}

export function getColabNotebookAgentRelay(): ColabNotebookAgentRelay | null {
  return notebookAgentRelay
}

export function registerColabSubsystemShutdown(hook: () => Promise<void> | void): void {
  subsystemShutdownHooks.add(hook)
}

export function configureColabHost(options: {
  getSettings: () => AppSettingsV1 | Promise<AppSettingsV1>
  colabRootDir?: string
}): ColabService {
  const refreshCached = (): void => {
    try {
      const maybePromise = options.getSettings()
      if (maybePromise && typeof (maybePromise as Promise<AppSettingsV1>).then === 'function') {
        void (maybePromise as Promise<AppSettingsV1>)
          .then((loaded) => {
            cachedColabSettings = normalizeKunColabSettings(resolveKunRuntimeSettings(loaded).colab)
          })
          .catch(() => undefined)
      } else {
        cachedColabSettings = normalizeKunColabSettings(
          resolveKunRuntimeSettings(maybePromise as AppSettingsV1).colab
        )
      }
    } catch {
      // Keep last known settings on transient load error.
    }
  }
  settingsGetter = () => {
    refreshCached()
    return cachedColabSettings
  }
  if (!colabService) {
    const rootDir = options.colabRootDir ?? join(app.getPath('userData'), 'colab')
    colabService = new ColabService({
      colabRootDir: rootDir,
      safeStorage,
      openExternal: async (url) => {
        await shell.openExternal(url)
      },
      getColabSettings: () => settingsGetter?.() ?? defaultKunColabSettings(),
      onLowBalanceNotice: (connectionName, balanceCu) => {
        try {
          if (Notification.isSupported()) {
            new Notification({
              title: 'Colab 算力余额提醒',
              body: `连接「${connectionName}」剩余 ${balanceCu} CU，已低于提醒阈值。`
            }).show()
          }
        } catch {
          // Ignore notification errors on unsupported hosts.
        }
      }
    })
  }
  return colabService
}

export function getColabHostService(): ColabService | null {
  return colabService
}

export async function prepareColabHostForKunLaunch(
  settings: AppSettingsV1
): Promise<ColabBridgeLaunch> {
  cachedColabSettings = normalizeKunColabSettings(resolveKunRuntimeSettings(settings).colab)
  const service =
    colabService ??
    configureColabHost({
      getSettings: () => settings
    })
  if (!colabBridge) {
    colabBridge = new ColabBridgeServer(
      service,
      () => settingsGetter?.() ?? normalizeKunColabSettings(resolveKunRuntimeSettings(settings).colab),
      () => notebookAgentRelay
    )
  }
  return colabBridge.start()
}

export async function shutdownColabHost(): Promise<void> {
  const hooks = [...subsystemShutdownHooks]
  subsystemShutdownHooks.clear()
  await Promise.allSettled(hooks.map((hook) => Promise.resolve().then(hook)))
  notebookAgentRelay?.shutdown()
  notebookAgentRelay = null
  const bridge = colabBridge
  colabBridge = null
  await bridge?.stop().catch(() => undefined)
  const service = colabService
  colabService = null
  await service?.shutdown().catch(() => undefined)
}
