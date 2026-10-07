import { GENERIC_ACP_BASE, TERMINAL_BASE } from '../../kun/src/config/kun-config-harness-providers.js'
import type { KunHarnessCustomEntryV1, KunHarnessProviderOverrideV1 } from './app-settings-types-kun-runtime'

/**
 * Edits on `agents.kun.harnesses.providers` (docs/ade/17 §4.3) shared by the
 * Agent Center entries: command path, launch patch and user Agents.
 */
type Providers = Readonly<Record<string, KunHarnessProviderOverrideV1>>

/** A generic ACP or terminal Agent exists only through its own command. */
function ownsCommand(entry: KunHarnessProviderOverrideV1 | undefined): boolean {
  return entry?.extends === GENERIC_ACP_BASE || entry?.extends === TERMINAL_BASE
}

function withEntry(providers: Providers, id: string, entry: KunHarnessProviderOverrideV1): Record<string, KunHarnessProviderOverrideV1> {
  const next = { ...providers }
  if (Object.keys(entry).length) next[id] = entry
  else delete next[id]
  return next
}

/** The command path set for an Agent, if any. */
export function agentCommandPath(providers: Providers, id: string): string | undefined {
  return providers[id]?.command
}

/** Set or clear an Agent's command path; a generic user Agent keeps its command when cleared. */
export function withAgentCommandPath(providers: Providers, id: string, path: string): Record<string, KunHarnessProviderOverrideV1> {
  const { command: _command, ...rest } = providers[id] ?? {}
  const trimmed = path.trim()
  if (!trimmed && ownsCommand(providers[id])) return { ...providers }
  return withEntry(providers, id, trimmed ? { ...rest, command: trimmed } : rest)
}

/** Extra arguments appended to an engine's own, as edited in the Agent Center. */
export function agentExtraArgs(providers: Providers, id: string): string[] {
  const args = providers[id]?.args
  return args?.mode === 'append' ? [...args.values] : []
}

/** Set the appended arguments, environment and credential-store variables of an Agent (empty clears them). */
export function withAgentLaunchPatch(
  providers: Providers,
  id: string,
  patch: { args?: readonly string[]; env?: Readonly<Record<string, string>>; secretEnv?: readonly { name: string; secretRef: string }[] }
): Record<string, KunHarnessProviderOverrideV1> {
  const entry: KunHarnessProviderOverrideV1 = { ...providers[id] }
  if (patch.args) {
    if (patch.args.length) entry.args = { mode: 'append', values: [...patch.args] }
    else if (entry.args?.mode === 'append') delete entry.args
  }
  if (patch.env) {
    if (Object.keys(patch.env).length) entry.env = { ...patch.env }
    else delete entry.env
  }
  if (patch.secretEnv) {
    if (patch.secretEnv.length) entry.secretEnv = patch.secretEnv.map((row) => ({ ...row }))
    else delete entry.secretEnv
  }
  return withEntry(providers, id, entry)
}

/** Whether an Agent was added by the user (and can be exported or removed). */
export function isUserAgent(providers: Providers, id: string): boolean {
  return Boolean(providers[id]?.extends)
}

/** Portable definition of a user ACP Agent; undefined for builtins and terminal Agents. */
export function userAgentEntry(providers: Providers, id: string): KunHarnessCustomEntryV1 | undefined {
  const entry = providers[id]
  if (!entry?.extends || entry.extends === TERMINAL_BASE) return undefined
  return {
    id,
    ...(entry.extends !== GENERIC_ACP_BASE ? { extends: entry.extends } : {}),
    displayName: entry.label ?? id,
    command: entry.command ?? '',
    args: [...entry.args?.values ?? []],
    env: { ...entry.env },
    ...(entry.secretEnv?.length ? { secretEnv: entry.secretEnv.map((row) => ({ ...row })) } : {})
  }
}

/**
 * The `providers` entry for a portable user Agent. A derived Agent without
 * its own arguments or command keeps its base engine's.
 */
export function userAgentOverride(entry: KunHarnessCustomEntryV1): KunHarnessProviderOverrideV1 {
  return {
    extends: entry.extends ?? GENERIC_ACP_BASE,
    label: entry.displayName,
    ...(entry.command.trim() ? { command: entry.command.trim() } : {}),
    ...(entry.args.length ? { args: { mode: 'replace' as const, values: [...entry.args] } } : {}),
    ...(Object.keys(entry.env).length ? { env: { ...entry.env } } : {}),
    ...(entry.secretEnv?.length ? { secretEnv: entry.secretEnv.map((row) => ({ ...row })) } : {})
  }
}
