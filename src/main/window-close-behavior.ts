export type MainWindowCloseDecision = 'allow' | 'quit-app'

export type MainWindowCloseState = {
  /** Ignored legacy preferences: the main window always owns application lifetime. */
  closeAction?: unknown
  isQuitting: boolean
  isUpdateInstallQuitting: boolean
  trayAvailable?: boolean
}

export function resolveMainWindowCloseDecision(state: MainWindowCloseState): MainWindowCloseDecision {
  if (state.isQuitting || state.isUpdateInstallQuitting) return 'allow'
  return 'quit-app'
}
