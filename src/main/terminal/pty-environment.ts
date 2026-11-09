import type { TerminalColorMode } from '../../shared/app-settings-terminal'
import { resolveWindowsShellCandidates, type WindowsShellResolverOptions } from '../../../kun/src/adapters/tool/windows-shell-resolver.js'

/**
 * Environment shared by the desktop terminal tabs and the phone terminal.
 *
 * Extracted from `terminal-pty-ipc.ts` so both callers spawn with the same
 * shell candidates, UTF-8 locale and color environment. `node-pty` stays lazily
 * loaded: a missing native build disables terminals instead of crashing startup.
 */
let nodePty: typeof import('node-pty') | null | undefined

export async function loadNodePty(): Promise<typeof import('node-pty') | null> {
  if (nodePty !== undefined) return nodePty
  try {
    nodePty = await import('node-pty')
  } catch (error) {
    console.warn('[terminal] node-pty failed to load; terminals disabled:', error)
    nodePty = null
  }
  return nodePty
}

/**
 * Pick default shells for the current platform.
 *
 * macOS: respects $SHELL, falling back to zsh. Linux: $SHELL, falling back to
 * bash. Windows: Git Bash, PowerShell 7, Windows PowerShell, then COMSPEC.
 */
export function resolveTerminalShellCandidates(
  platform: NodeJS.Platform = process.platform,
  options: WindowsShellResolverOptions = {}
): Array<{ file: string; args: string[]; gitBash: boolean }> {
  if (platform === 'win32') {
    return resolveWindowsShellCandidates(options).map((candidate) => ({
      file: candidate.file,
      args: [...candidate.terminalArgs],
      gitBash: candidate.kind === 'git-bash'
    }))
  }
  const env = options.env ?? process.env
  const fallback = platform === 'darwin' ? '/bin/zsh' : '/bin/bash'
  return [{ file: env.SHELL || fallback, args: [], gitBash: false }]
}

function isUtf8Locale(value: string | undefined): value is string {
  if (!value) return false
  return /utf-?8/i.test(value)
}

/** POSIX precedence is LC_ALL > LC_CTYPE > LANG. */
function resolveLocale(): string {
  if (isUtf8Locale(process.env.LC_ALL)) return process.env.LC_ALL
  if (isUtf8Locale(process.env.LC_CTYPE)) return process.env.LC_CTYPE
  if (isUtf8Locale(process.env.LANG)) return process.env.LANG
  if (process.platform === 'darwin') return 'en_US.UTF-8'
  if (process.platform === 'win32') return 'C.UTF-8'
  return 'en_US.UTF-8'
}

export function buildShellEnv(colorMode: TerminalColorMode): NodeJS.ProcessEnv {
  const locale = resolveLocale()
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TERM: 'xterm-256color',
    LANG: locale,
    LC_ALL: locale
  }
  // Monochrome tabs must not advertise truecolor, or tools bypass the palette.
  if (colorMode === 'none') {
    delete env.COLORTERM
  } else {
    env.COLORTERM = 'truecolor'
  }
  return env
}
