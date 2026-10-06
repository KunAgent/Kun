import { ipcMain } from 'electron'
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
}
