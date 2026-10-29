import { app, ipcMain, Notification, session, shell } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { resolveKunRuntimeSettings } from '../../shared/app-settings'
import { STORAGE_CLEANUP_MAX_DAYS, STORAGE_CLEANUP_MIN_DAYS } from '../../shared/storage-cleanup'
import { displayNotification } from '../notification-display'
import { formatBytes, StorageCleanupService } from '../services/storage-cleanup/service'
import type { SlimPreviewCandidate, SlimRuntimeClient } from '../services/storage-cleanup/planner'
import type { RegisterAppIpcHandlersOptions } from './app-ipc-handler-options'
import { parseIpcPayload } from './app-ipc-handler-utils'

export const STORAGE_CLEANUP_NOTICE_CLICKED_CHANNEL = 'storage-cleanup:notice-clicked'

const days = z.number().int().min(STORAGE_CLEANUP_MIN_DAYS).max(STORAGE_CLEANUP_MAX_DAYS)
const enableSchema = z.object({ olderThanDays: days })
const configPatchSchema = z.object({
  olderThanDays: days.optional(),
  notifyBefore: z.boolean().optional(),
  trashDays: z.number().int().min(1).max(90).optional()
}).strict()
const previewSchema = z.object({ olderThanDays: days.optional() }).optional()
const runSchema = z.object({ olderThanDays: days, itemIds: z.array(z.string().min(1).max(600)).max(10_000) })
const runIdSchema = z.string().min(1).max(200)
const revealSchema = z.enum(['agentRuntimes', 'toolchains', 'avatar3d', 'indexDatabase', 'migrationBackups', 'dataRoot'])

let service: StorageCleanupService | null = null

export function storageCleanupService(): StorageCleanupService | null {
  return service
}

/** Settings → Storage: usage scan, consented auto cleanup, trash and history. */
export function registerAppStorageCleanupIpcHandlers(options: RegisterAppIpcHandlersOptions): void {
  const request = async (path: string, body: unknown): Promise<unknown> => {
    const response = await options.runtimeRequest(path, 'POST', JSON.stringify(body), undefined, { priority: 'background' })
    if (!response.ok) throw new Error(`Kun runtime storage request failed (HTTP ${response.status}).`)
    return JSON.parse(response.body) as unknown
  }
  const runtime: SlimRuntimeClient = {
    preview: async (threadIds, idleBefore) =>
      ((await request('/v1/storage/threads/slim/preview', { threadIds, idleBefore })) as { candidates: SlimPreviewCandidate[] }).candidates,
    apply: async (threadIds, idleBefore) =>
      (await request('/v1/storage/threads/slim', { threadIds, idleBefore })) as Awaited<ReturnType<SlimRuntimeClient['apply']>>
  }
  const zh = async (): Promise<boolean> => String((await options.store.load()).locale ?? app.getLocale()).startsWith('zh')
  service?.stop()
  service = new StorageCleanupService({
    paths: async () => ({
      kunHome: join(homedir(), '.kun'),
      // Lazy: these modules boot app-wide state on import, which IPC tests do not provide.
      dataDir: (await import('../kun-process')).resolveKunDataDir(resolveKunRuntimeSettings(await options.store.load())),
      userData: app.getPath('userData')
    }),
    runtime,
    clearBrowserCaches: async () => {
      await session.defaultSession.clearCache()
      await session.defaultSession.clearCodeCaches({})
    },
    notify: ({ bytes, olderThanDays }) => {
      if (!Notification.isSupported()) return
      void Promise.all([zh(), import('../app-icon'), import('../main-app-context'), import('../main-tray')]).then(([chinese, icons, context, tray]) => {
        const notification = new Notification({
          title: chinese ? `明天将自动清理 ${formatBytes(bytes)}` : `Kun will clean ${formatBytes(bytes)} tomorrow`,
          body: chinese
            ? `${olderThanDays} 天没更新的旧会话会被瘦身，对话本身保留。点按查看清单或跳过本次。`
            : `Conversations idle for ${olderThanDays} days will be slimmed; their messages stay. Click to review or skip.`,
          ...icons.notificationIconOptions(context.appIcon)
        })
        notification.on('click', () => {
          tray.revealMainWindow()
          const window = options.getMainWindow()
          if (window && !window.isDestroyed()) window.webContents.send(STORAGE_CLEANUP_NOTICE_CLICKED_CHANNEL)
        })
        return displayNotification(notification)
      })
    }
  })
  const cleanup = service

  ipcMain.handle('storage-cleanup:status', () => cleanup.status())
  ipcMain.handle('storage-cleanup:scan', () => cleanup.scan())
  ipcMain.handle('storage-cleanup:enable', (_, payload: unknown) =>
    cleanup.enable(parseIpcPayload('storage-cleanup:enable', enableSchema, payload).olderThanDays))
  ipcMain.handle('storage-cleanup:disable', () => cleanup.disable())
  ipcMain.handle('storage-cleanup:update-config', (_, payload: unknown) =>
    cleanup.updateConfig(parseIpcPayload('storage-cleanup:update-config', configPatchSchema, payload)))
  ipcMain.handle('storage-cleanup:preview', (_, payload: unknown) =>
    cleanup.preview(parseIpcPayload('storage-cleanup:preview', previewSchema, payload)?.olderThanDays))
  ipcMain.handle('storage-cleanup:run', (_, payload: unknown) => {
    const input = parseIpcPayload('storage-cleanup:run', runSchema, payload)
    return cleanup.run(input.olderThanDays, input.itemIds)
  })
  ipcMain.handle('storage-cleanup:clear-caches', () => cleanup.clearCaches())
  ipcMain.handle('storage-cleanup:remove-migration-backups', () => cleanup.removeMigrationBackups())
  ipcMain.handle('storage-cleanup:skip-pending', () => cleanup.skipPendingRun())
  ipcMain.handle('storage-cleanup:history', () => cleanup.history())
  ipcMain.handle('storage-cleanup:restore-trash-run', (_, payload: unknown) =>
    cleanup.restoreTrashRun(parseIpcPayload('storage-cleanup:restore-trash-run', runIdSchema, payload)))
  ipcMain.handle('storage-cleanup:empty-trash', () => cleanup.emptyTrash())
  ipcMain.handle('storage-cleanup:reveal', async (_, payload: unknown) => {
    const target = parseIpcPayload('storage-cleanup:reveal', revealSchema, payload)
    const paths = await cleanup.dataPaths()
    const locations: Record<typeof target, string> = {
      dataRoot: paths.kunHome,
      agentRuntimes: join(paths.kunHome, 'agents'),
      toolchains: join(paths.kunHome, 'toolchains'),
      avatar3d: join(paths.kunHome, '3d-source'),
      indexDatabase: join(paths.dataDir, 'index.sqlite3'),
      migrationBackups: paths.dataDir
    }
    shell.showItemInFolder(locations[target])
  })
  cleanup.start()
}
