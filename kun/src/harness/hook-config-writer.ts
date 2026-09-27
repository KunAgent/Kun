import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { adeRootDir } from '../ade/ade-paths.js'

/**
 * Managed hooks for terminal agents (05 §6.2): per-launch config lives in
 * `dataDir/ade/hooks/<unitId>/` and is deleted when the unit exits — the
 * user's global agent configuration is never touched. Each hook event runs
 * `<kun> worker hook <event>`, which POSTs the trimmed payload to
 * `/v1/activity/hooks`.
 */

export type TerminalHooksDef = { kind: string; events: string[] }

export type HookLaunchExtras = {
  /** Extra argv the launcher appends (e.g. `--settings <file>`). */
  args: string[]
  /** Extra environment for the spawned process. */
  env: Record<string, string>
  /** Temporary config directory; removed on unit exit. */
  dir: string
}

function safeUnitId(unitId: string): string {
  return unitId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 128) || 'unknown'
}

/** Shell-safe quoting for paths inside a harness command string. */
function shQuote(value: string): string {
  return `"${value.replace(/["$`\\]/g, '')}"`
}

/**
 * How `kun` is invoked inside a spawned PTY. Packaged desktop runtimes set
 * KUN_PACKAGED_RUNTIME_EXECUTABLE to the bundled CLI; development/standalone
 * falls back to `node <serve-entry.js>`.
 */
export function kunHookCommand(env: NodeJS.ProcessEnv = process.env): string {
  const packaged = env.KUN_PACKAGED_RUNTIME_EXECUTABLE?.trim()
  if (packaged) return shQuote(packaged)
  const entry = fileURLToPath(new URL('../cli/serve-entry.js', import.meta.url))
  return `${shQuote(process.execPath)} ${shQuote(entry)}`
}

/**
 * Write the temporary hook config for one execution unit and return the
 * launch additions. `null` means the harness kind has no managed-hook
 * mechanism — the unit still launches, with weaker state fidelity.
 */
export async function writeHookConfig(
  dataDir: string,
  unitId: string,
  hooks: TerminalHooksDef,
  command: string
): Promise<HookLaunchExtras | null> {
  if (hooks.kind !== 'claude-settings' || hooks.events.length === 0) return null
  const dir = join(adeRootDir(dataDir), 'hooks', safeUnitId(unitId))
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'settings.json')
  const hookEntries = Object.fromEntries(
    hooks.events.map((event) => [
      event,
      [{ matcher: '*', hooks: [{ type: 'command', command: `${command} worker hook ${event}` }] }]
    ])
  )
  await writeFile(file, `${JSON.stringify({ hooks: hookEntries }, null, 2)}\n`, 'utf8')
  return {
    args: ['--settings', file],
    env: { KUN_HOOK_DIR: dir },
    dir
  }
}

/** Unit exit removes its temporary hook directory (05 §6.2). */
export async function cleanupHookConfig(dataDir: string, unitId: string): Promise<void> {
  await rm(join(adeRootDir(dataDir), 'hooks', safeUnitId(unitId)), { recursive: true, force: true })
    .catch(() => undefined)
}
