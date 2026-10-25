import { ipcRenderer } from 'electron'
import type { KunGuiTerminalDockApi } from '../shared/terminal-dock'

/** Terminal dock helpers. Spread into the main `kunGui` api object in `index.ts`. */
export const terminalDockApi: KunGuiTerminalDockApi = {
  listTerminalShells: () => ipcRenderer.invoke('terminal:shells'),
  getTerminalProcessInfo: (sessionId) => ipcRenderer.invoke('terminal:process-info', sessionId),
  openSystemTerminal: (cwd) => ipcRenderer.invoke('terminal:open-system', cwd)
}
