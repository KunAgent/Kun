/**
 * Dock shortcut labels. macOS uses Command chords; elsewhere the dock uses
 * Ctrl+Shift so plain Ctrl keys (Ctrl+C, Ctrl+K, ...) stay with the shell.
 */
export function isMacPlatform(): boolean {
  return typeof window !== 'undefined' && window.kunGui?.platform === 'darwin'
}

export function dockShortcut(key: string, options: { shift?: boolean } = {}): string {
  if (isMacPlatform()) return `⌘${options.shift ? '⇧' : ''}${key}`
  return `Ctrl+Shift+${key}`
}

/** A plain Control chord sent to the shell (interrupt). */
export function controlShortcut(key: string): string {
  return isMacPlatform() ? `⌃${key}` : `Ctrl+${key}`
}

/** The workbench's terminal toggle (default binding Ctrl+`). */
export function toggleTerminalShortcut(): string {
  return isMacPlatform() ? '⌃`' : 'Ctrl+`'
}

export function submitShortcut(): string {
  return isMacPlatform() ? '⌘↩' : 'Ctrl+Enter'
}

export function withShortcut(label: string, shortcut: string): string {
  return `${label} (${shortcut})`
}
