import type { AdeHarnessSetup } from '@shared/ade-harnesses'

/**
 * Setup commands for the Agent Center: the install command for this platform and
 * the sign-in command that is prefilled into a Kun terminal for the user to run.
 * What an Agent shows and offers next comes from
 * `agentPresentation`.
 */

/** Install entries prefer an exact platform match over the 'any' fallback. */
export function setupInstallCommand(
  setup: AdeHarnessSetup | undefined,
  platform: string
): { command: string; note?: string } | null {
  const entries = setup?.install ?? []
  const exact = entries.find((entry) => entry.platform === platform)
  const any = entries.find((entry) => entry.platform === 'any')
  const picked = exact ?? any
  return picked ? { command: picked.command, note: picked.note } : null
}

export function setupLoginCommand(
  setup: AdeHarnessSetup | undefined,
  resolvedCommand?: string,
  platform = 'darwin'
): { command: string; note?: string } | null {
  const login = setup?.login
  if (!login) return null
  const executable = resolvedCommand || login.command
  const quote = (value: string): string => /^[a-z0-9_./:-]+$/i.test(value) ? value
    : platform === 'win32' ? `'${value.replaceAll("'", "''")}'` : `'${value.replaceAll("'", "'\\''")}'`
  const command = [executable, ...login.args].map(quote).join(' ')
  return { command: platform === 'win32' && quote(executable) !== executable ? `& ${command}` : command, note: login.note }
}
