import { z } from 'zod'
import { HarnessIdSchema } from '../contracts/harness.js'

const EnvNameSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/)

export const HarnessSecretEnvRowSchema = z.object({
  name: EnvNameSchema,
  secretRef: z.string().min(1).max(256)
}).strict()

/**
 * Per-Agent launch override. On a builtin id it patches
 * that engine. Any other id is a user Agent and `extends` names its base: a
 * builtin ACP engine (same protocol behaviour, its own command), `acp` (a
 * generic ACP agent) or `terminal` (an interactive CLI for terminal tabs).
 * Secrets are credential-store refs; values never enter config.
 */
export const HarnessProviderOverrideSchema = z.object({
  extends: HarnessIdSchema.optional(),
  label: z.string().trim().min(1).max(64).optional(),
  /** Executable name or path; replaces the engine binary and keeps its arguments. */
  command: z.string().trim().min(1).max(4_096).optional(),
  args: z.object({
    mode: z.enum(['append', 'replace']),
    values: z.array(z.string().max(1_024)).max(32)
  }).strict().optional(),
  /** Non-sensitive variables only. */
  env: z.record(EnvNameSchema, z.string().max(1_024)).optional(),
  secretEnv: z.array(HarnessSecretEnvRowSchema).max(32).optional(),
  /** Terminal-tab launch details for `extends: 'terminal'`. */
  terminal: z.object({
    taskFlag: z.string().min(1).max(64).optional(),
    resumeArgs: z.array(z.string().max(1_024)).max(32).optional(),
    hooks: z.enum(['none', 'claude-settings']).optional()
  }).strict().optional()
}).strict()
export type HarnessProviderOverride = z.infer<typeof HarnessProviderOverrideSchema>

/** Bases that are not engines: a generic ACP agent and a terminal CLI. */
export const GENERIC_ACP_BASE = 'acp'
export const TERMINAL_BASE = 'terminal'

type LegacyCustomEntry = {
  id: string
  displayName: string
  command: string
  args: readonly string[]
  env?: Readonly<Record<string, string>>
  secretEnv?: readonly { name: string; secretRef: string }[]
}

type LegacyTerminalEntry = {
  id: string
  displayName: string
  command: string
  args: readonly string[]
  taskFlag?: string
  resumeArgs?: readonly string[]
  hooks?: 'none' | 'claude-settings'
}

/** Legacy settings that `providers` replaces: command paths, custom ACP and terminal Agents. */
export type LegacyHarnessLaunchSettings = {
  providers?: Readonly<Record<string, HarnessProviderOverride>>
  binaryPaths?: Readonly<Record<string, string>>
  custom?: readonly LegacyCustomEntry[]
  terminalAgents?: readonly LegacyTerminalEntry[]
}

/**
 * Every per-Agent override in one view. Explicit `providers` entries win;
 * legacy custom and terminal Agents fill ids they do not name, and a legacy
 * command path applies wherever no explicit command was set (it used to
 * override the custom Agent's own command at launch as well).
 */
export function harnessProviderOverrides(
  settings: LegacyHarnessLaunchSettings | undefined
): Record<string, HarnessProviderOverride> {
  const out: Record<string, HarnessProviderOverride> = { ...settings?.providers }
  for (const entry of settings?.custom ?? []) {
    if (out[entry.id]) continue
    out[entry.id] = {
      extends: GENERIC_ACP_BASE, label: entry.displayName, command: entry.command,
      ...(entry.args.length ? { args: { mode: 'replace', values: [...entry.args] } } : {}),
      ...(entry.env && Object.keys(entry.env).length ? { env: { ...entry.env } } : {}),
      ...(entry.secretEnv?.length ? { secretEnv: entry.secretEnv.map((row) => ({ ...row })) } : {})
    }
  }
  for (const entry of settings?.terminalAgents ?? []) {
    if (out[entry.id]) continue
    const terminal = {
      ...(entry.taskFlag ? { taskFlag: entry.taskFlag } : {}),
      ...(entry.resumeArgs?.length ? { resumeArgs: [...entry.resumeArgs] } : {}),
      ...(entry.hooks ? { hooks: entry.hooks } : {})
    }
    out[entry.id] = {
      extends: TERMINAL_BASE, label: entry.displayName, command: entry.command,
      ...(entry.args.length ? { args: { mode: 'replace', values: [...entry.args] } } : {}),
      ...(Object.keys(terminal).length ? { terminal } : {})
    }
  }
  for (const [id, path] of Object.entries(settings?.binaryPaths ?? {})) {
    if (path.trim() && !settings?.providers?.[id]?.command) out[id] = { ...out[id], command: path.trim() }
  }
  return out
}

/** The executable a user chose for an Agent, if any. */
export function harnessCommandOverride(
  settings: LegacyHarnessLaunchSettings | undefined,
  id: string
): string | undefined {
  return harnessProviderOverrides(settings)[id]?.command
}
