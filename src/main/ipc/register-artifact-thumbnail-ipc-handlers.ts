import { app, ipcMain } from 'electron'
import { z } from 'zod'
import { resolveOfficeCliBinary } from '../officecli-resources'
import { renderArtifactThumbnail } from '../services/artifact-thumbnail-service'
import type { RegisterAppIpcHandlersOptions } from './app-ipc-handler-options'
import { assertTrustedWorkbenchSender, parseIpcPayload } from './app-ipc-handler-utils'

const artifactThumbnailRequestSchema = z.strictObject({
  workspaceRoot: z.string().min(1).max(16_384),
  path: z.string().min(1).max(16_384),
  source: z.enum(['design-html', 'office'])
})

export function registerArtifactThumbnailIpcHandlers(options: RegisterAppIpcHandlersOptions): void {
  ipcMain.handle('artifacts:render-thumbnail', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const request = parseIpcPayload('artifacts:render-thumbnail', artifactThumbnailRequestSchema, payload)
    const binaryPath = resolveOfficeCliBinary({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appRoot: app.getAppPath(),
      explicitPath: process.env.KUN_OFFICECLI_BINARY
    })
    if (request.source === 'office' && !binaryPath) {
      return { ok: false as const, message: 'The bundled OfficeCLI binary was not found.' }
    }
    return renderArtifactThumbnail(request, { office: { binaryPath: binaryPath ?? undefined } })
  })
}
