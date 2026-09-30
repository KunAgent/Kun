import { defaultKunControlDir } from '../manager/manager-discovery.js'
import { readGuiSharedSettings } from './gui-settings-bridge.js'
import { resolveCliRuntimeFlavor } from './runtime-flavor.js'
import { runtimeDataDir } from './shared-runtime-support.js'
import { PersistentHost } from './persistent-host.js'

export async function runHostCommand(argv: readonly string[], io: {
  stdout: { write(value: string): unknown }; stderr: { write(value: string): unknown }
  env?: NodeJS.ProcessEnv; fetch?: typeof fetch
}): Promise<number> {
  const command = argv[0]
  if (!command || command === '--help' || command === '-h') {
    io.stdout.write('kun host <start|stop|status> [--data-dir <path>] [--json]\n' +
      'Opt-in independent persistent owner. Close the GUI first. Connect with kun tui --no-start.\n' +
      'The default GUI cannot attach to this host. No login service or remote push is installed.\n')
    return 0
  }
  if (!['start', 'stop', 'status'].includes(command)) { io.stderr.write('kun host: unknown command\n'); return 64 }
  const env = io.env ?? process.env
  const data = runtimeDataDir(argv.slice(1).filter((arg) => arg !== '--json'), env)
  if (!data.ok) { io.stderr.write(`kun host: ${data.message}\n`); return 64 }
  try {
    const gui = data.source === 'default' ? await readGuiSharedSettings({ env }) : null
    const host = new PersistentHost({ dataDir: gui?.dataDir ?? data.dataDir,
      controlDir: env.KUN_MANAGER_CONTROL_DIR?.trim() || defaultKunControlDir(),
      runtimeFlavor: resolveCliRuntimeFlavor({ env }),
      env: { ...env, ...(gui && !env.KUN_MANAGER_SETTINGS_PATH ? { KUN_MANAGER_SETTINGS_PATH: gui.settingsPath } : {}) }, fetch: io.fetch })
    const result = command === 'start' ? await host.start() : command === 'stop' ? await host.stop() : await host.status()
    io.stdout.write(argv.includes('--json') ? JSON.stringify(result) + '\n' :
      [`Kun persistent host: ${result.status}`, `Data directory: ${result.dataDir}`,
        ...(result.url ? [`URL: ${result.url}`] : []), ...(result.logPath ? [`Logs: ${result.logPath}`] : []),
        ...(result.lastError ? [`Last startup error: ${result.lastError}`] : []),
        'Overdue reminders reconcile on startup under their saved lateness policy.',
        'The computer must remain awake. GUI attachment and OS autostart are not enabled.', ''].join('\n'))
    return 0
  } catch (error) { io.stderr.write(`kun host: ${error instanceof Error ? error.message : String(error)}\n`); return 70 }
}
