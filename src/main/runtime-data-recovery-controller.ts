import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { ZodError } from 'zod'
import {
  RuntimeDataRecoveryExecuteInputSchema,
  type RuntimeDataRecoveryStatus
} from '../shared/runtime-data-recovery'
import {
  RuntimeDataDirRecovery,
  RuntimeDataRecoveryError
} from './runtime-data-dir-recovery'
import { trustedRendererSenderIsCurrent } from './renderer-trust-policy'
import { trustedWorkbenchRendererUrl } from './main-window'

export type RuntimeDataRecoveryControllerOptions = {
  recovery: RuntimeDataDirRecovery
  getMainWindow: () => BrowserWindow | null
  onCompleted?: (status: RuntimeDataRecoveryStatus) => void | Promise<void>
}

export class RuntimeDataRecoveryController {
  constructor(private readonly options: RuntimeDataRecoveryControllerOptions) {}

  registerIpc(): void {
    this.handle('runtime-data-recovery:status', async () => this.options.recovery.getStatus())
    this.handle('runtime-data-recovery:execute', async (raw) => {
      const input = RuntimeDataRecoveryExecuteInputSchema.parse(raw)
      const status = await this.options.recovery.execute(input)
      if (status.state === 'completed') await this.options.onCompleted?.(status)
      return status
    })
  }

  private handle<T>(channel: string, handler: (...args: unknown[]) => Promise<T>): void {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (event, ...args) => {
      assertTrustedRuntimeDataRecoverySender(event, this.options.getMainWindow)
      try {
        return await handler(...args)
      } catch (error) {
        throw new Error(publicRuntimeDataRecoveryError(error))
      }
    })
  }
}

export function assertTrustedRuntimeDataRecoverySender(
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  getMainWindow: () => BrowserWindow | null
): void {
  if (!trustedRendererSenderIsCurrent(event, getMainWindow(), {
    trustedRendererUrl: trustedWorkbenchRendererUrl(),
    surface: 'runtime-data-recovery'
  })) {
    throw new Error('Runtime data recovery IPC sender is not the trusted top-level frame')
  }
}

export function publicRuntimeDataRecoveryError(error: unknown): string {
  if (error instanceof RuntimeDataRecoveryError) return `${error.code}: ${error.message}`
  if (error instanceof ZodError) return 'invalid_request: The recovery request was rejected.'
  return 'recovery_failed: Runtime data recovery failed without changing preserved evidence.'
}
