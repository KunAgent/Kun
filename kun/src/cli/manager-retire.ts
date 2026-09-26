import { defaultKunControlDir, defaultProductionSettingsPath } from '../manager/manager-discovery.js'
import { retireVerifiablyIdleLegacyManager } from '../manager/legacy-manager-retire.js'
import { runtimeDataDir } from './shared-runtime-support.js'

/** Explicit operator command for old Managers that predate atomic idle retirement.
 * Application startup performs this same verified idle shutdown automatically;
 * this command remains the explicit operator fallback when takeover was not safe. */
export async function runManagerRetireCommand(argv: readonly string[], io: {
  stdout: { write(value: string): unknown }
  stderr: { write(value: string): unknown }
  env?: NodeJS.ProcessEnv
  fetch?: typeof fetch
}): Promise<number> {
  if (argv[0] !== 'retire') {
    io.stdout.write('kun manager retire [--data-dir <path>]\nRetire an idle legacy Manager after closing its clients. Live application owners and live Runtime slots cannot be retired.\n')
    return argv[0] && argv[0] !== '--help' && argv[0] !== '-h' ? 64 : 0
  }
  const env = io.env ?? process.env
  const data = runtimeDataDir(argv.slice(1), env)
  if (!data.ok) { io.stderr.write(`kun manager: ${data.message}\n`); return 64 }
  const controlDir = env.KUN_MANAGER_CONTROL_DIR?.trim() || defaultKunControlDir()
  try {
    const result = await retireVerifiablyIdleLegacyManager({
      controlDir,
      dataDir: data.dataDir,
      settingsPath: env.KUN_MANAGER_SETTINGS_PATH?.trim() || defaultProductionSettingsPath(),
      fetch: io.fetch
    })
    if (result === 'absent') { io.stdout.write('No legacy Service Manager is running.\n'); return 0 }
    if (result === 'already-exited') { io.stdout.write('Legacy Manager has already exited.\n'); return 0 }
    io.stdout.write('Legacy Service Manager exited. Existing data is preserved.\n')
    return 0
  } catch (error) {
    io.stderr.write(`kun manager: ${error instanceof Error ? error.message : String(error)}\n`)
    return 70
  }
}
