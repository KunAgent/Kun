import {
  MAX_HARNESS_SESSION_SETTINGS,
  type HarnessSessionSetting,
  type HarnessSettingValues
} from '../../contracts/harness-session-settings.js'
import type { AcpConnection } from './acp-connection.js'
import { ACP_AGENT_METHODS, type AcpConfigOption } from './acp-schema.js'

/** Categories Kun maps to its own composer controls: model, permission mode, reasoning. */
const KUN_CONTROLLED_CATEGORIES = new Set(['model', 'mode', 'thought_level'])

function controlledByKun(option: AcpConfigOption, permissionOptionId: string | undefined): boolean {
  return Boolean(option.category && KUN_CONTROLLED_CATEGORIES.has(option.category)) || option.id === permissionOptionId
}

/** Select choices with their native labels, flattening grouped options. */
function selectChoices(option: AcpConfigOption): { value: string; label: string }[] {
  const entries = 'options' in option && Array.isArray(option.options) ? option.options : []
  const out: { value: string; label: string }[] = []
  const visit = (list: readonly unknown[]): void => {
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue
      const entry = raw as { value?: unknown; name?: unknown; options?: unknown }
      if (Array.isArray(entry.options)) { visit(entry.options); continue }
      if (typeof entry.value !== 'string' || out.some((choice) => choice.value === entry.value)) continue
      const label = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : entry.value
      out.push({ value: entry.value.slice(0, 1_024), label: label.slice(0, 256) })
    }
  }
  visit(entries)
  return out.slice(0, 128)
}

/**
 * Session controls an ACP Agent publishes beyond what Kun maps itself.
 * `permissionOptionId` is the option a definition's
 * `acpPermission` already drives.
 */
export function acpSessionSettings(
  options: readonly AcpConfigOption[] | null | undefined,
  permissionOptionId?: string
): HarnessSessionSetting[] {
  const settings: HarnessSessionSetting[] = []
  for (const option of options ?? []) {
    if (settings.length >= MAX_HARNESS_SESSION_SETTINGS) break
    if (controlledByKun(option, permissionOptionId)) continue
    const label = (option.name?.trim() || option.id).slice(0, 256)
    if (option.type === 'boolean') {
      settings.push({ kind: 'toggle', id: option.id, label, value: option.currentValue })
      continue
    }
    const choices = selectChoices(option)
    if (choices.length) settings.push({ kind: 'select', id: option.id, label, value: option.currentValue, options: choices })
  }
  return settings
}

/**
 * Apply a turn's chosen values before the prompt. A value for a setting the
 * session does not publish, or one it does not offer, keeps the Agent's own.
 */
export async function applyAcpSessionSettings(
  conn: AcpConnection,
  session: { sessionId: string; configOptions?: AcpConfigOption[] | null },
  values: HarnessSettingValues | undefined,
  permissionOptionId?: string
): Promise<void> {
  if (!values || !Object.keys(values).length) return
  for (const setting of acpSessionSettings(session.configOptions, permissionOptionId)) {
    const wanted = values[setting.id]
    if (wanted === undefined || wanted === setting.value) continue
    const offered = setting.kind === 'toggle'
      ? typeof wanted === 'boolean'
      : typeof wanted === 'string' && setting.options.some((choice) => choice.value === wanted)
    if (!offered) continue
    await conn.rpc.request(ACP_AGENT_METHODS.sessionSetConfigOption, {
      sessionId: session.sessionId,
      configId: setting.id,
      value: wanted
    })
  }
}
