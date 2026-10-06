import { mkdir } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { ipcMain } from 'electron'
import { openPathWithShell } from '../services/workspace-editors'
import type { AgentWiringAction, AgentWiringResult } from '../../shared/agent-wiring'
import { parseAgentWiringAction } from '../services/agent-wiring-actions'
import { AgentWiringBridge } from '../services/agent-wiring-bridge'
import type { RegisterAppIpcHandlersOptions } from './app-ipc-handler-options'
import { assertTrustedWorkbenchSender } from './app-ipc-handler-utils'

/** Desktop-only bridge: agent gateway keys go from the runtime into agent configs, never to the renderer. */
export function registerAgentWiringIpc(options: Pick<RegisterAppIpcHandlersOptions, 'getMainWindow' | 'assertRendererRuntimeReady' | 'runtimeRequest'>): void {
  const bridge = new AgentWiringBridge((path, method, body) => options.runtimeRequest(path, method, body))
  ipcMain.handle('agent-wiring', async (event, input: unknown): Promise<AgentWiringResult> => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    options.assertRendererRuntimeReady()
    let action: AgentWiringAction
    try { action = parseAgentWiringAction(input) } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Invalid agent action' }
    }
    return bridge.handle(action)
  })

  // The folder comes from the runtime, never from the renderer, so this can only open Kun's own middleware folder.
  ipcMain.handle('gateway-middleware:open-dir', async (event): Promise<{ ok: boolean; message?: string }> => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    options.assertRendererRuntimeReady()
    try {
      const response = await options.runtimeRequest('/v1/model-gateway/middleware', 'GET')
      const directory = response.ok ? (JSON.parse(response.body) as { directory?: unknown }).directory : undefined
      if (typeof directory !== 'string' || !isAbsolute(directory) || !/[\\/]gateway-middleware$/.test(directory)) {
        return { ok: false, message: 'The runtime did not report its middleware folder.' }
      }
      await mkdir(directory, { recursive: true, mode: 0o700 })
      return openPathWithShell(directory)
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })
}
