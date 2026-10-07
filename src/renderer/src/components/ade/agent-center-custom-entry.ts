import type { KunHarnessCustomEntryV1, KunHarnessSecretEnvEntryV1 } from '@shared/app-settings'

export const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/
export const AGENT_ID = /^[a-z][a-z0-9-]{1,47}$/

export function customAgentId(displayName: string): string {
  return `custom-${displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agent'}`
}

export function parseEnvLines(text: string): Record<string, string> | null {
  const env: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) return null
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return env
}

/** Minimal shape validation for an imported definition JSON. */
export function parseCustomEntryJson(text: string): KunHarnessCustomEntryV1 | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const entry = raw as Record<string, unknown>
  // A derived Agent may keep its base engine's command.
  const base = typeof entry.extends === 'string' && AGENT_ID.test(entry.extends.trim()) ? entry.extends.trim() : undefined
  if (
    typeof entry.displayName !== 'string' ||
    !entry.displayName.trim() ||
    typeof entry.command !== 'string' ||
    (!entry.command.trim() && !base)
  ) {
    return null
  }
  const env = typeof entry.env === 'object' && entry.env !== null && !Array.isArray(entry.env)
    ? Object.fromEntries(
        Object.entries(entry.env as Record<string, unknown>).filter(
          ([k, v]) => ENV_NAME.test(k) && typeof v === 'string'
        ) as [string, string][]
      )
    : {}
  const secretEnv = Array.isArray(entry.secretEnv)
    ? (entry.secretEnv as unknown[]).flatMap((row): KunHarnessSecretEnvEntryV1[] => {
        if (typeof row !== 'object' || row === null) return []
        const r = row as Record<string, unknown>
        return typeof r.name === 'string' && ENV_NAME.test(r.name) &&
          typeof r.secretRef === 'string' && r.secretRef.trim()
          ? [{ name: r.name, secretRef: r.secretRef.trim() }]
          : []
      })
    : []
  return {
    id: typeof entry.id === 'string' && AGENT_ID.test(entry.id.trim())
      ? entry.id.trim()
      : customAgentId(entry.displayName),
    ...(base ? { extends: base } : {}),
    displayName: entry.displayName.trim(),
    command: entry.command.trim(),
    args: Array.isArray(entry.args)
      ? (entry.args as unknown[]).filter((a): a is string => typeof a === 'string')
      : [],
    env,
    secretEnv
  }
}

/**
 * Serialize a saved custom entry as the portable JSON definition (p4 §3.7).
 * `secretEnv` refs are machine-local credential-store ids — they export
 * verbatim so a same-profile re-import keeps working.
 */
export function exportCustomEntryJson(entry: KunHarnessCustomEntryV1): string {
  return `${JSON.stringify(
    {
      id: entry.id,
      ...(entry.extends ? { extends: entry.extends } : {}),
      displayName: entry.displayName,
      command: entry.command,
      args: entry.args,
      env: entry.env,
      secretEnv: entry.secretEnv ?? []
    },
    null,
    2
  )}\n`
}

/** Save-as-dialog export for one custom entry (reuses file:save-as). */
export async function exportCustomEntry(entry: KunHarnessCustomEntryV1): Promise<void> {
  const dataBase64 = window.btoa(unescape(encodeURIComponent(exportCustomEntryJson(entry))))
  await window.kunGui?.saveWorkspaceFileAs?.({
    suggestedName: `${entry.id}.json`,
    dataBase64,
    mimeType: 'application/json'
  })
}
