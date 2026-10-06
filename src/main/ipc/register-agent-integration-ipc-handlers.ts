import { ipcMain, shell } from 'electron'
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import { HarnessIntegrationOpenRequest } from '../../../kun/src/contracts/harness-integration.js'
import type { HarnessIntegrationOpenResult } from '../../../kun/src/contracts/harness-integration.js'
import type { RegisterAppIpcHandlersOptions } from './app-ipc-handler-options'
import { assertTrustedWorkbenchSender, parseIpcPayload } from './app-ipc-handler-utils'

const Target = z.object({ path: z.string().min(1).max(4096).refine(isAbsolute), exists: z.literal(true),
  kind: z.enum(['application', 'file', 'directory']) }).strict()
export function registerAgentIntegrationIpcHandlers(options: RegisterAppIpcHandlersOptions): void {
  ipcMain.handle('agent:open-integration', async (event, payload: unknown): Promise<HarnessIntegrationOpenResult> => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const input = parseIpcPayload('agent:open-integration', HarnessIntegrationOpenRequest, payload)
    const response = await options.runtimeRequest(`/v1/harnesses/${encodeURIComponent(input.harnessId)}/integration/resolve`, 'POST', JSON.stringify(input))
    if (!response.ok) return { ok: false, message: 'The Agent application or configuration is unavailable. Refresh its installation status.' }
    let body: unknown
    try { body = JSON.parse(response.body) } catch { return { ok: false, message: 'The Agent returned an invalid integration target.' } }
    const target = Target.safeParse(body)
    if (!target.success || (input.action === 'application') !== (target.data.kind === 'application')) {
      return { ok: false, message: 'The selected Agent target could not be verified.' }
    }
    const error = await shell.openPath(target.data.path)
    return error ? { ok: false, message: error } : { ok: true }
  })
}
