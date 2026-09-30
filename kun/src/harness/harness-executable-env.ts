import { delimiter, join } from 'node:path'
import { homedir } from 'node:os'

/** Keep explicit PATH precedence while finding CLIs installed after the app was opened. */
export function harnessExecutableEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const home = base.HOME || base.USERPROFILE || homedir()
  const pathKey = Object.keys(base).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
  const extra = process.platform === 'win32'
    ? [base.APPDATA ? join(base.APPDATA, 'npm') : '', join(home, '.local', 'bin'), join(home, '.bun', 'bin'),
      join(base.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'agy', 'bin')]
    : ['/opt/homebrew/bin', '/usr/local/bin', join(home, '.local', 'bin'), join(home, '.opencode', 'bin'),
      join(home, '.npm-global', 'bin'), join(home, '.bun', 'bin')]
  const env = { ...base }
  if (pathKey !== 'PATH') delete env[pathKey]
  return { ...env, PATH: [...new Set([...(base[pathKey] ?? '').split(delimiter), ...extra].filter(Boolean))].join(delimiter) }
}
