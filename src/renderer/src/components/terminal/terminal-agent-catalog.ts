import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { TerminalAgentProfileV1, TerminalSettingsV1 } from '@shared/app-settings'
import { profileTakesTask } from '@shared/app-settings-terminal-dock'

/**
 * Agents the new-session menu can start in a terminal: installed harness
 * CLIs with terminal support (launched through Kun's admission, so they can
 * report back), Kun's own TUI, and the user's custom commands.
 */
export const KUN_TUI_AGENT_ID = 'kun-tui'

export type TerminalAgentEntry = {
  id: string
  kind: 'harness' | 'profile'
  name: string
  /** Harness id whose icon to show; 'kun' for Kun's mark; 'terminal' otherwise. */
  icon: string
  /** Version for harnesses, the command for profiles. */
  detail?: string
  takesTask: boolean
  needsLogin: boolean
  loginCommand?: string
  hidden: boolean
  builtin: boolean
  harness?: AdeHarnessRow
  profile?: TerminalAgentProfileV1
}

function loginCommand(row: AdeHarnessRow): string | undefined {
  const login = row.definition.setup?.login
  return login ? [login.command, ...login.args].join(' ') : undefined
}

export const KUN_TUI_PROFILE: TerminalAgentProfileV1 = {
  id: KUN_TUI_AGENT_ID,
  name: 'Kun TUI',
  command: 'kun',
  args: '',
  icon: 'kun',
  cwd: '',
  env: []
}

export function terminalAgentEntries(rows: readonly AdeHarnessRow[], settings: TerminalSettingsV1): TerminalAgentEntry[] {
  const hidden = new Set(settings.hiddenAgentIds)
  const entries: TerminalAgentEntry[] = []
  for (const row of rows) {
    if (!row.definition.terminal || row.status.installed !== 'yes') continue
    entries.push({
      id: row.definition.id,
      kind: 'harness',
      name: row.definition.displayName,
      icon: row.definition.id,
      ...(row.status.version ? { detail: row.status.version } : {}),
      takesTask: true,
      needsLogin: row.status.login === 'signed-out',
      ...(loginCommand(row) ? { loginCommand: loginCommand(row) } : {}),
      hidden: hidden.has(row.definition.id),
      builtin: true,
      harness: row
    })
  }
  entries.push({
    id: KUN_TUI_AGENT_ID, kind: 'profile', name: KUN_TUI_PROFILE.name, icon: 'kun', detail: 'kun',
    takesTask: false, needsLogin: false, hidden: hidden.has(KUN_TUI_AGENT_ID), builtin: true, profile: KUN_TUI_PROFILE
  })
  for (const profile of settings.profiles) {
    entries.push({
      id: profile.id,
      kind: 'profile',
      name: profile.name,
      icon: profile.icon,
      detail: [profile.command, profile.args].filter(Boolean).join(' '),
      takesTask: profileTakesTask(profile),
      needsLogin: false,
      hidden: hidden.has(profile.id),
      builtin: false,
      profile
    })
  }
  const order = new Map(settings.agentOrder.map((id, index) => [id, index]))
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => (order.get(a.entry.id) ?? 1_000 + a.index) - (order.get(b.entry.id) ?? 1_000 + b.index))
    .map(({ entry }) => entry)
}

/** Move one entry up/down and return the new full order of ids. */
export function moveAgent(entries: readonly TerminalAgentEntry[], id: string, direction: -1 | 1): string[] {
  const ids = entries.map((entry) => entry.id)
  const index = ids.indexOf(id)
  const target = index + direction
  if (index < 0 || target < 0 || target >= ids.length) return ids
  ;[ids[index], ids[target]] = [ids[target]!, ids[index]!]
  return ids
}
