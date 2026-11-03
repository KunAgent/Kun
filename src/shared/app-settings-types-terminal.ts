/**
 * Built-in terminal settings. The dock reads appearance and behavior live;
 * the main process reads the color mode (env tuning) and the shell choice.
 */

/**
 * 'native' follows the app theme, 'none' is monochrome, 'contrast' is a fixed
 * high-contrast dark palette and 'custom' uses the user-defined colors.
 */
export type TerminalColorMode = 'native' | 'none' | 'contrast' | 'custom'

export type TerminalColorSettingsV1 = {
  colorMode: TerminalColorMode
  foreground: string
  background: string
  cursor: string
  selectionBackground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

export type TerminalCursorStyle = 'block' | 'bar' | 'underline'

export type TerminalAppearanceSettingsV1 = {
  /** CSS font-family list; blank means the system monospace stack. */
  fontFamily: string
  fontSize: number
  lineHeight: number
  cursorStyle: TerminalCursorStyle
  cursorBlink: boolean
}

export type TerminalStartDirectory = 'workspace' | 'home'

export type TerminalBehaviorSettingsV1 = {
  /** Absolute shell path, or '' for the system default. */
  shell: string
  startDirectory: TerminalStartDirectory
  scrollback: number
  /** Command marks, exit codes and running-command titles (zsh/bash/fish). */
  shellIntegration: boolean
  /** Reopen tabs, directories and recent output after Kun restarts. */
  restoreSessions: boolean
  /** List Kun's own background shells in the dock. */
  showKunProcesses: boolean
  /** Badge the top-bar terminal button and notify while the dock is hidden. */
  statusAlerts: boolean
  confirmClose: boolean
  copyOnSelect: boolean
  macOptionIsMeta: boolean
}

export type TerminalProfileEnvEntryV1 = {
  key: string
  value: string
}

/**
 * A user-defined command shown in the new-session menu. `args` is one string
 * split like a shell would; `{任务}` / `{task}` is replaced by the typed task
 * and a token that is only the placeholder is dropped when the task is empty.
 */
export type TerminalAgentProfileV1 = {
  id: string
  name: string
  command: string
  args: string
  /** Harness id whose icon to reuse, or 'terminal'. */
  icon: string
  /** Absolute start directory, or '' to follow where the session opens. */
  cwd: string
  env: TerminalProfileEnvEntryV1[]
}

export type TerminalSettingsV1 = {
  colors: TerminalColorSettingsV1
  appearance: TerminalAppearanceSettingsV1
  behavior: TerminalBehaviorSettingsV1
  profiles: TerminalAgentProfileV1[]
  /** Harness or profile ids hidden from the new-session menu. */
  hiddenAgentIds: string[]
  /** Preferred menu order of harness and profile ids; unknown ids sort last. */
  agentOrder: string[]
}

export type TerminalSettingsPatchV1 = {
  colors?: Partial<TerminalColorSettingsV1>
  appearance?: Partial<TerminalAppearanceSettingsV1>
  behavior?: Partial<TerminalBehaviorSettingsV1>
  profiles?: TerminalAgentProfileV1[]
  hiddenAgentIds?: string[]
  agentOrder?: string[]
}
