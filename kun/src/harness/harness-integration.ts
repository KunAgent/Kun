import { stat, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, isAbsolute, dirname, extname } from 'node:path'
import type { HarnessDefinition } from '../contracts/harness.js'
import type { HarnessIntegrationInfo, HarnessIntegrationTarget, HarnessIntegrationOpenRequest } from '../contracts/harness-integration.js'
import { resolveExecutable } from '../process/owned-process.js'
import { harnessExecutableEnv } from './harness-executable-env.js'

export type IntegrationHost = {
  home?: string; platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv
  resolve?: (command: string) => Promise<string | undefined>
}
type Location = NonNullable<HarnessDefinition['configurationLocations']>[number]
function roots(location: Location, host: IntegrationHost): string[] {
  const home = host.home ?? homedir(), platform = host.platform ?? process.platform, env = host.env ?? process.env
  const absolute = (value: string | undefined, fallback: string) => value && isAbsolute(value) ? value : fallback
  switch (location.root) {
    case 'home': return [home]
    case 'config': return [absolute(platform === 'win32' ? env.APPDATA : env.XDG_CONFIG_HOME,
      platform === 'win32' ? join(home, 'AppData/Roaming') : join(home, '.config'))]
    case 'app-data': return [platform === 'darwin' ? join(home, 'Library/Application Support')
      : absolute(platform === 'win32' ? env.APPDATA : env.XDG_CONFIG_HOME, platform === 'win32' ? join(home, 'AppData/Roaming') : join(home, '.config'))]
    case 'local-app-data': return [absolute(platform === 'win32' ? env.LOCALAPPDATA : env.XDG_DATA_HOME,
      platform === 'win32' ? join(home, 'AppData/Local') : join(home, '.local/share'))]
    case 'program-files': return [absolute(env.ProgramFiles ?? env.PROGRAMFILES, 'C:/Program Files')]
    case 'applications': return platform === 'darwin' ? ['/Applications', join(home, 'Applications')]
      : platform === 'win32' ? [absolute(env.ProgramFiles ?? env.PROGRAMFILES, 'C:/Program Files')]
        : ['/usr/share/applications', join(home, '.local/share/applications')]
  }
}
async function targets(locations: readonly Location[], host: IntegrationHost, application = false): Promise<HarnessIntegrationTarget[]> {
  const platform = host.platform ?? process.platform
  return Promise.all(locations.filter((location) => location.platform === 'any' || location.platform === platform)
    .flatMap((location) => roots(location, host).map(async (root) => {
      const path = join(root, location.path)
      const info = await stat(path).catch(() => undefined)
      return { path, exists: Boolean(info), kind: application ? 'application' as const : info ? info.isDirectory() ? 'directory' as const : 'file' as const
        : !extname(path) ? 'directory' as const : 'file' as const }
    })))
}
async function productMatches(path: string, productName?: string): Promise<boolean> {
  if (!productName) return true
  for (const file of [join(path, 'Contents/Resources/app/product.json'), join(dirname(path), 'resources/app/product.json')]) {
    try {
      if ((await stat(file)).size > 256 * 1024) continue
      const value = JSON.parse(await readFile(file, 'utf8'))
      if (value.nameShort === productName || value.nameLong === productName) return true
    } catch { /* A similarly named application is not proof of this product. */ }
  }
  return false
}

/** Only curated root-relative locations are inspected; scanning never starts an application. */
export async function harnessIntegrationInfo(definition: HarnessDefinition, options: IntegrationHost & { binaryPath?: string } = {}): Promise<HarnessIntegrationInfo> {
  const configs = definition.application?.configLocations ?? definition.configurationLocations ?? []
  const configurations = [...new Map((await targets(configs, options)).map((value) => [value.path, value])).values()].slice(0, 16)
  let application: HarnessIntegrationTarget | undefined
  if (definition.transport === 'application') {
    const candidates = options.binaryPath ? [{ path: options.binaryPath, exists: Boolean(await stat(options.binaryPath).catch(() => undefined)), kind: 'application' as const }]
      : await targets(definition.application?.locations ?? [], options, true)
    for (const target of candidates) if (target.exists && await productMatches(target.path, definition.application?.productName)) {
      application = target; break
    }
    if (!application && !options.binaryPath && definition.detect && !definition.application?.productName) {
      const resolve = options.resolve ?? ((command: string) => resolveExecutable(command, { env: harnessExecutableEnv(options.env) }))
      for (const command of [definition.detect.command, ...definition.detect.aliases]) {
        const path = await resolve(command)
        if (path) { application = { path, exists: true, kind: 'application' }; break }
      }
    }
  }
  return { harnessId: definition.id, kind: definition.transport === 'application' ? 'application' : definition.transport === 'terminal' ? 'terminal' : 'chat',
    ...(application ? { application } : {}), configurations,
    docsUrl: definition.application?.configurationDocsUrl ?? definition.setup?.docsUrl }
}

export async function resolveHarnessIntegrationTarget(definition: HarnessDefinition, request: HarnessIntegrationOpenRequest,
  host: IntegrationHost & { binaryPath?: string } = {}): Promise<HarnessIntegrationTarget | undefined> {
  const info = await harnessIntegrationInfo(definition, host)
  const target = request.action === 'application' ? info.application : info.configurations[request.index ?? 0]
  if (!target?.exists) return undefined
  // Configuration actions cannot execute an arbitrary script or settings database.
  if (request.action === 'configuration' && target.kind === 'file' && !/^(?:\.(?:jsonc?|toml|ya?ml|ini|env)|)$/i.test(extname(target.path))) {
    return { path: dirname(target.path), exists: true, kind: 'directory' }
  }
  return target
}
