import { homedir } from 'node:os'
import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import type { AppSettingsV1 } from '../../shared/app-settings'
import {
  StorageRelocationPreflightPlanSchema,
  type StorageRelocationOperationJournal,
  type StorageRelocationStatus
} from '../../shared/storage-relocation'
import { classifyCanonicalKunDataDir } from '../kun-data-dir-paths'
import { StorageRelocationEngine } from './engine'
import { trustedRendererSenderIsCurrent } from '../renderer-trust-policy'
import { trustedWorkbenchRendererUrl } from '../main-window'

const operationIdSchema = z.string().uuid()

export type StorageRelocationControllerOptions = {
  engine: StorageRelocationEngine
  getMainWindow: () => BrowserWindow | null
  loadSettings?: () => Promise<AppSettingsV1>
  prepareForRestart?: (journal: StorageRelocationOperationJournal) => Promise<void>
  recoveryMode?: boolean
}

export class StorageRelocationController {
  constructor(private readonly options: StorageRelocationControllerOptions) {}

  registerIpc(): void {
    const handle = <T>(channel: string, handler: (...args: unknown[]) => Promise<T>) => {
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, async (event, ...args) => {
        assertTrustedStorageRelocationSender(event, this.options.getMainWindow)
        try {
          return await handler(...args)
        } catch (error) {
          throw new Error(publicRelocationError(error))
        }
      })
    }

    handle('storage-relocation:status', () => this.options.engine.status())
    handle('storage-relocation:pick-destination', async (raw) => {
      this.assertNormalMode()
      const value = z.object({ defaultPath: z.string().max(32_767).optional() }).strict().parse(raw)
      const result = await dialog.showOpenDialog(this.windowOptions(), {
        title: 'Choose an empty folder for Kun data',
        defaultPath: value.defaultPath,
        properties: ['openDirectory', 'createDirectory']
      })
      return { canceled: result.canceled, path: result.filePaths[0] ?? null }
    })
    handle('storage-relocation:preflight', async (raw) => {
      this.assertNormalMode()
      await this.assertCanonicalManagedDataDir()
      const { destinationRoot } = z.object({ destinationRoot: z.string().min(1).max(32_767) }).strict().parse(raw)
      return this.options.engine.preflightMove(destinationRoot)
    })
    handle('storage-relocation:schedule', async (raw) => {
      this.assertNormalMode()
      await this.assertCanonicalManagedDataDir()
      const input = z.object({
        plan: StorageRelocationPreflightPlanSchema,
        interruptActiveWork: z.boolean()
      }).strict().parse(raw)
      return this.schedule(input.plan, input.interruptActiveWork)
    })
    handle('storage-relocation:restore-default', async (raw) => {
      this.assertNormalMode()
      await this.assertCanonicalManagedDataDir()
      const { interruptActiveWork } = z.object({ interruptActiveWork: z.boolean() }).strict().parse(raw)
      const plan = await this.options.engine.preflightRestoreDefault()
      return this.schedule(plan, interruptActiveWork)
    })
    handle('storage-relocation:cancel', async (raw) => {
      const { operationId } = z.object({ operationId: operationIdSchema }).strict().parse(raw)
      await this.options.engine.cancel(operationId)
      return this.options.engine.status()
    })
    handle('storage-relocation:retry', async (raw) => {
      const { operationId } = z.object({ operationId: operationIdSchema }).strict().parse(raw)
      const active = await this.options.engine.store.activeOperationId()
      if (active === operationId) {
        await this.options.engine.runPending()
      } else {
        const location = await this.options.engine.store.readLocation()
        if (location?.operationId !== operationId) {
          throw new Error('operation_conflict: The relocation operation is not active.')
        }
        await this.options.engine.repairLocation()
      }
      return this.options.engine.status()
    })
    handle('storage-relocation:rollback', async (raw) => {
      const { operationId } = z.object({ operationId: operationIdSchema }).strict().parse(raw)
      await this.options.engine.rollback(operationId)
      return this.options.engine.status()
    })
  }

  private async schedule(
    plan: z.infer<typeof StorageRelocationPreflightPlanSchema>,
    interruptActiveWork: boolean
  ): Promise<StorageRelocationStatus> {
    const journal = await this.options.engine.schedule(plan, interruptActiveWork)
    await this.options.engine.markDraining(journal.operationId)
    try {
      await this.options.prepareForRestart?.(journal)
    } catch (error) {
      await this.options.engine.cancel(journal.operationId).catch(() => undefined)
      throw error
    }
    return this.options.engine.status()
  }

  private async assertCanonicalManagedDataDir(): Promise<void> {
    const settings = await this.options.loadSettings?.()
    if (!settings) return
    if (classifyCanonicalKunDataDir(settings.agents.kun.dataDir, {
      homeDir: homedir(),
      platform: process.platform
    }) !== 'current') {
      throw new Error(
        'custom_data_dir: Managed storage relocation requires agents.kun.dataDir to use ~/.kun/data.'
      )
    }
  }

  private assertNormalMode(): void {
    if (this.options.recoveryMode) {
      throw new Error('operation_conflict: New relocations cannot be started from the recovery window.')
    }
  }

  private windowOptions(): BrowserWindow {
    const window = this.options.getMainWindow()
    if (!window || window.isDestroyed()) throw new Error('Storage relocation window is unavailable.')
    return window
  }
}

export function assertTrustedStorageRelocationSender(
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  getMainWindow: () => BrowserWindow | null
): void {
  const window = getMainWindow()
  const trusted = trustedRendererSenderIsCurrent(event, window, {
    trustedRendererUrl: trustedWorkbenchRendererUrl(),
    surface: 'storage-relocation'
  }) || trustedRendererSenderIsCurrent(event, window, {
    trustedRendererUrl: trustedWorkbenchRendererUrl(),
    surface: 'workbench'
  })
  if (!trusted) {
    throw new Error('Storage relocation IPC sender is not the trusted top-level frame')
  }
}

function publicRelocationError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 4_000)
}
