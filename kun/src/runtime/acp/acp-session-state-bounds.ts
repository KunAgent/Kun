/**
 * `harness_session_state` is informational: it mirrors controls an ACP Agent
 * publishes so the composer can refresh. Its schema (contracts/events.ts,
 * contracts/harness-session-settings.ts) bounds every list and string, while
 * Agents do not: a CodeMaker gateway offers more than 128 models, and its
 * full list arrives in every config_option_update. Building the event within
 * those bounds keeps a large catalog from failing the turn. Nothing reads the
 * value list (the composer's models come from the model probe), so trimming
 * it loses no choice; the current value is always kept.
 */
import { acpConfigOptionValues, type AcpConfigOption } from './acp-schema.js'
import type { RuntimeEventDraft } from '../../services/runtime-event-recorder.js'

export const SESSION_STATE_BOUNDS = {
  configOptions: 32, values: 128, commands: 200,
  id: 256, name: 256, category: 64, value: 1_024, description: 4_096
} as const

const clip = (text: string, max: number): string => text.length > max ? text.slice(0, max) : text

export type BoundedConfigOption = { id: string; name?: string; category?: string; currentValue?: string | boolean; values?: string[] }

export function boundedConfigOptions(options: readonly AcpConfigOption[]): BoundedConfigOption[] {
  return options.filter((option) => typeof option.id === 'string' && option.id.length > 0)
    .slice(0, SESSION_STATE_BOUNDS.configOptions).map((option) => {
      const current = typeof option.currentValue === 'string' ? clip(option.currentValue, SESSION_STATE_BOUNDS.value)
        : typeof option.currentValue === 'boolean' ? option.currentValue : undefined
      return {
        id: clip(option.id, SESSION_STATE_BOUNDS.id),
        ...(option.name ? { name: clip(option.name, SESSION_STATE_BOUNDS.name) } : {}),
        ...(option.category ? { category: clip(option.category, SESSION_STATE_BOUNDS.category) } : {}),
        ...(current !== undefined ? { currentValue: current } : {}),
        ...(option.type === 'select' ? { values: boundedValues(acpConfigOptionValues(option), current) } : {})
      }
    })
}

/** At most the bound, unique, and the current value first when it would fall off the end. */
function boundedValues(values: readonly string[], current: string | boolean | undefined): string[] {
  const unique = [...new Set(values.map((value) => clip(value, SESSION_STATE_BOUNDS.value)))]
  if (unique.length <= SESSION_STATE_BOUNDS.values) return unique
  const head = unique.slice(0, SESSION_STATE_BOUNDS.values)
  return typeof current === 'string' && !head.includes(current) && unique.includes(current)
    ? [current, ...head.slice(0, SESSION_STATE_BOUNDS.values - 1)] : head
}

export function boundedCommands(commands: ReadonlyArray<{ name: string; description?: string | null; input?: { hint?: string | null } | null }>):
  Array<{ name: string; description?: string; inputHint?: string }> {
  return commands.filter((command) => typeof command.name === 'string' && command.name.length > 0)
    .slice(0, SESSION_STATE_BOUNDS.commands).map((command) => ({
      name: clip(command.name, SESSION_STATE_BOUNDS.name),
      ...(command.description ? { description: clip(command.description, SESSION_STATE_BOUNDS.description) } : {}),
      ...(command.input?.hint ? { inputHint: clip(command.input.hint, SESSION_STATE_BOUNDS.description) } : {})
    }))
}

/** Drafts that only mirror Agent-side state: its controls and its plan. */
const MIRROR_DRAFT_KINDS: ReadonlySet<string> = new Set(['harness_session_state', 'todos_updated'])

/**
 * Emit mapped drafts in order. A mirror draft the recorder still rejects is
 * dropped with a note: a mirror of Agent state must never fail the turn. Any
 * other failure propagates.
 */
export async function emitTolerantSessionState(
  drafts: readonly RuntimeEventDraft[],
  emit: (draft: RuntimeEventDraft) => Promise<void>,
  onDropped: (error: unknown, kind: string) => void
): Promise<void> {
  for (const draft of drafts) {
    if (!MIRROR_DRAFT_KINDS.has(draft.kind)) { await emit(draft); continue }
    try { await emit(draft) } catch (error) { onDropped(error, draft.kind) }
  }
}
