import {
  ipcMain,
  shell
} from 'electron'
import {
  isAbsolute
} from 'node:path'
import {
  z
} from 'zod'
import type { RegisterAppIpcHandlersOptions } from './app-ipc-handler-options'
import {
  assertTrustedWorkbenchSender,
  parseIpcPayload
} from './app-ipc-handler-utils'

const extensionArtifactActionSchema = z.strictObject({
  artifactId: z.string().min(16).max(512).regex(/^[A-Za-z0-9_-]+$/),
  ownerExtensionId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}\.[a-z0-9][a-z0-9-]{0,63}$/),
  ownerExtensionVersion: z.string().min(1).max(64),
  workspaceId: z.string().regex(/^[a-f0-9]{64}$/),
  workspaceRoot: z.string().min(1).max(16_384).refine(isAbsolute),
  action: z.enum(['open', 'reveal'])
})
const extensionArtifactResolutionSchema = z.strictObject({
  artifactId: z.string().min(16).max(512),
  absolutePath: z.string().min(1).max(16_384).refine(isAbsolute),
  displayName: z.string().min(1).max(256),
  mimeType: z.string().min(3).max(128)
})

export function registerExtensionArtifactIpcHandlers(options: RegisterAppIpcHandlersOptions): void {
  const { getMainWindow } = options
  ipcMain.handle('extension:artifact:open', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    const input = parseIpcPayload(
      'extension:artifact:open',
      extensionArtifactActionSchema,
      payload
    )
    const result = await options.runtimeRequest(
      '/v1/extensions/media/artifacts/resolve',
      'POST',
      JSON.stringify({
        artifactId: input.artifactId,
        ownerExtensionId: input.ownerExtensionId,
        ownerExtensionVersion: input.ownerExtensionVersion,
        workspaceId: input.workspaceId,
        workspaceRoot: input.workspaceRoot
      })
    )
    if (!result.ok) {
      return { ok: false, message: 'Generated artifact is unavailable.' }
    }
    let decoded: unknown
    try {
      decoded = JSON.parse(result.body)
    } catch {
      return { ok: false, message: 'Generated artifact metadata is invalid.' }
    }
    const resolved = extensionArtifactResolutionSchema.safeParse(decoded)
    if (!resolved.success || resolved.data.artifactId !== input.artifactId) {
      return { ok: false, message: 'Generated artifact metadata is invalid.' }
    }
    if (input.action === 'reveal') {
      shell.showItemInFolder(resolved.data.absolutePath)
      return { ok: true }
    }
    const error = await shell.openPath(resolved.data.absolutePath)
    return error
      ? { ok: false, message: 'The generated artifact could not be opened.' }
      : { ok: true }
  })
}
