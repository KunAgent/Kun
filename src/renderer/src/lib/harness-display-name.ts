import type { AdeHarnessRow } from '@shared/ade-harnesses'
import { useHarnessStore } from '../store/harness-store'

const HARNESS_DISPLAY_NAMES: Record<string, string> = {
  kun: 'Kun',
  antigravity: 'Antigravity',
  'claude-code': 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  'cursor-cli': 'Cursor CLI',
  opencode: 'OpenCode',
  opencode2: 'OpenCode',
  gemini: 'Gemini CLI',
  grok: 'Grok',
  kimi: 'Kimi',
  devin: 'Devin',
  droid: 'Droid',
  goose: 'Goose',
  cline: 'Cline',
  copilot: 'GitHub Copilot',
  aider: 'Aider',
  continue: 'Continue'
}

/** Display name for Kun or an external Agent ("antigravity" -> "Antigravity"); unknown ids stay as-is. */
export function harnessDisplayName(
  id: string,
  rows: readonly AdeHarnessRow[] = useHarnessStore.getState().rows
): string {
  const normalized = id.trim()
  if (!normalized) return id
  return (
    rows.find((row) => row.definition.id === normalized)?.definition.displayName ??
    HARNESS_DISPLAY_NAMES[normalized] ??
    normalized
  )
}

/** Display names for external Agents ("devin" -> "Devin"); unknown ids are shown as-is. */
export function harnessDisplayNames(
  ids: readonly string[] | undefined,
  rows: readonly AdeHarnessRow[] = useHarnessStore.getState().rows
): string {
  if (!ids?.length) return ''
  return ids.map((id) => harnessDisplayName(id, rows)).join(', ')
}
