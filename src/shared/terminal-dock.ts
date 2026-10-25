import type { TerminalProcessInfo, TerminalShellOption } from './terminal'

/** Terminal-dock bridge methods. Spread into `window.kunGui`. */
export type KunGuiTerminalDockApi = {
  listTerminalShells: () => Promise<TerminalShellOption[]>
  getTerminalProcessInfo: (sessionId: string) => Promise<TerminalProcessInfo | null>
  openSystemTerminal: (cwd: string) => Promise<boolean>
}
