import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import type { AppSettingsV1 } from '../../shared/app-settings'
import {
  UninstallOptionsSchema,
  type UninstallPerformResult,
  type UninstallStatus
} from '../../shared/uninstall'
import { writeCleanupScripts, type CleanupScriptOutput } from './cleanup-script'
import {
  assertSafeUninstallPath,
  collectUninstallPaths,
  markExistingPaths,
  resolveAppRemovalTarget
} from './paths'
import { trustedRendererSenderIsCurrent } from '../renderer-trust-policy'
import { trustedWorkbenchRendererUrl } from '../main-window'

export type UninstallControllerOptions = {
  getMainWindow: () => BrowserWindow | null
  getUserDataPath: () => string
  getExecPath: () => string
  isPackaged: () => boolean
  getAppImageEnv?: () => string | undefined
  loadSettings?: () => Promise<AppSettingsV1>
  /** Stop the Kun runtime, service manager, and any active background work. */
  prepareForUninstall?: () => Promise<void>
}

export class UninstallController {
  private uninstallInProgress = false
  private recoveryScheduled = false
  constructor(private readonly options: UninstallControllerOptions) {}

  registerIpc(): void {
    const handle = <T>(channel: string, handler: (...args: unknown[]) => Promise<T>) => {
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, async (event, ...args) => {
        assertTrustedUninstallSender(event, this.options.getMainWindow)
        try {
          return await handler(...args)
        } catch (error) {
          throw new Error(publicUninstallError(error))
        }
      })
    }

    handle('uninstall:status', () => this.status())
    handle('uninstall:perform', async (raw) => {
      const input = UninstallOptionsSchema.strict().parse(raw)
      return this.perform(input)
    })
  }

  private async status(): Promise<UninstallStatus> {
    const settings = await this.options.loadSettings?.()
    const paths = await markExistingPaths(
      collectUninstallPaths({
        userDataPath: this.options.getUserDataPath(),
        settings: settings ?? null,
        platform: process.platform
      })
    )
    const appRemoval = await resolveAppRemovalTarget({
      execPath: this.options.getExecPath(),
      isPackaged: this.options.isPackaged(),
      platform: process.platform,
      appImageEnv: this.options.getAppImageEnv?.()
    })
    return {
      schemaVersion: 1,
      platform: process.platform,
      isPackaged: this.options.isPackaged(),
      canRemoveApp: appRemoval.mode !== 'none',
      removeAppMode: appRemoval.mode,
      removeAppTarget: appRemoval.target,
      appInstallPath: appRemoval.installPath,
      appRemovalHint: appRemoval.hint,
      paths
    }
  }

  private async perform(input: z.infer<typeof UninstallOptionsSchema>): Promise<UninstallPerformResult> {
    if (this.uninstallInProgress || this.recoveryScheduled) throw new Error('uninstall_in_progress: An uninstall operation is already in progress.')
    this.uninstallInProgress = true
    try { return await this.performOnce(input) } catch (error) {
      this.uninstallInProgress = false
      throw error
    }
  }

  private async performOnce(input: z.infer<typeof UninstallOptionsSchema>): Promise<UninstallPerformResult> {
    const { deleteAllData, removeApp } = input
    if (!deleteAllData && !removeApp) {
      throw new Error('nothing_to_do: Choose at least one of "delete data" or "remove the app".')
    }

    let deleteDataPaths: string[] = []
    if (deleteAllData) {
      const settings = await this.options.loadSettings?.()
      const collected = collectUninstallPaths({
        userDataPath: this.options.getUserDataPath(),
        settings: settings ?? null,
        platform: process.platform
      })
      // Re-assert every path right before it is written into the cleanup script.
      deleteDataPaths = collected.map((item) =>
        assertSafeUninstallPath(item.path, { platform: process.platform })
      )
    }

    let appRemovalMode: UninstallPerformResult['removeAppMode'] = 'none'
    let appRemovalTarget: string | undefined
    if (removeApp) {
      const appRemoval = await resolveAppRemovalTarget({
        execPath: this.options.getExecPath(),
        isPackaged: this.options.isPackaged(),
        platform: process.platform,
        appImageEnv: this.options.getAppImageEnv?.()
      })
      if (appRemoval.mode === 'none') {
        throw new Error(
          `cannot_remove_app: ${appRemoval.hint ?? 'Application removal is not supported here.'}`
        )
      }
      appRemovalMode = appRemoval.mode
      appRemovalTarget = appRemoval.target
    }

    const operationId = randomUUID()
    let output: CleanupScriptOutput | undefined
    let preparationStarted = false
    try {
      // Do not arm a detached deletion plan until the old service stack has
      // actually released its writers. Failed preparation must delete nothing.
      preparationStarted = Boolean(this.options.prepareForUninstall)
      await this.options.prepareForUninstall?.()
      output = await writeCleanupScripts({
        operationId, mainPid: process.pid, guardCommandSubstring: this.options.getExecPath(),
        deleteDataPaths, appRemovalMode, appRemovalTarget, platform: process.platform,
        tempRoot: app.getPath('temp')
      })
      await spawnCleanupScript(process.platform, output.scriptPath)
    } catch (error) {
      if (output) await rm(output.markerDir, { recursive: true, force: true }).catch(() => undefined)
      // Preparation may have closed Main admission even when it threw. A new
      // normal application session restores the GUI without replaying deletion.
      if (preparationStarted && !this.recoveryScheduled) {
        this.recoveryScheduled = true
        try { app.relaunch() } finally { app.quit() }
      }
      throw error
    }
    app.quit()

    return {
      scheduled: true,
      operationId,
      pathCount: deleteDataPaths.length,
      removeAppMode: appRemovalMode,
      cleanupScriptPath: output.scriptPath
    }
  }
}

export function spawnCleanupScript(
  platform: NodeJS.Platform,
  scriptPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = platform === 'win32'
      ? spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
        { detached: true, stdio: 'ignore', windowsHide: true })
      : spawn('sh', [scriptPath], { detached: true, stdio: 'ignore' })
    child.once('error', reject)
    child.once('spawn', () => { child.unref(); resolve() })
  })
}

export function assertTrustedUninstallSender(
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  getMainWindow: () => BrowserWindow | null
): void {
  if (!trustedRendererSenderIsCurrent(event, getMainWindow(), {
    trustedRendererUrl: trustedWorkbenchRendererUrl(),
    surface: 'workbench'
  })) {
    throw new Error('Uninstall IPC sender is not the trusted top-level frame')
  }
}

function publicUninstallError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 4_000)
}
