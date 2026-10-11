import {
  CURRENT_MANIFEST_VERSION,
  SUPPORTED_EXTENSION_API_VERSIONS
} from '@kun/extension-api'
import { open, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import { redactSecrets, redactSecretText } from '../config/secret-redaction.js'
import {
  ExtensionError,
  ExtensionIndexClient,
  ExtensionManager,
  ExtensionPackageManager,
  ExtensionPaths,
  ExtensionRegistry,
  ExtensionStateMigrationCoordinator,
  ExtensionStateStore,
  inspectDevelopmentDirectory,
  inspectKunxArchive,
  packKunx,
  verifyExtractedExtension,
  type ExtensionCompatibility,
  type ExtensionRegistryEntry
} from '../extensions/index.js'
import { ServeExitCode } from './serve.js'
import { KUN_VERSION } from '../version.js'
import { defaultKunDataDir } from './kun-data-dir.js'
import { migrateLegacyExtensionRoots } from './extension-cli-migration.js'

import {
  errorExitCode,
  errorMessage,
  extensionId,
  loadScaffolder,
  normalizeCliError,
  parseArguments,
  parseBoundedInteger,
  projectEntry,
  projectInspection,
  projectInstalled,
  readRotatedLogTail,
  requireEntry,
  requirePermissionAcceptance,
  requiredExtensionId,
  resolveFromCwd,
  resolvePackOutput,
  usageError,
  writeCommandError,
  writeJson,
  writeResult
} from './extension-cli-support.js'

export const KUN_EXTENSION_CLI_SCHEMA_VERSION = 1
export const DEFAULT_KUN_VERSION = KUN_VERSION
export const DEFAULT_LOG_BYTES = 256 * 1024
export const MAX_LOG_BYTES = 1024 * 1024

export const KUN_EXTENSION_CLI_USAGE = `kun extension <command> [options]

Commands:
  create <directory>          Scaffold a node, webview, or React extension
  validate <path>            Validate a source directory or .kunx archive
  pack <directory>           Build a deterministic .kunx archive
  install <path>             Install a .kunx, development directory, or exact Index version
  list                       List installed and development extensions
  enable <extension-id>      Enable globally or for one workspace
  disable <extension-id>     Disable globally or for one workspace
  uninstall <extension-id>   Remove package code while preserving extension data
  rollback <extension-id>    Select the retained previous version
  doctor [extension-id]      Validate package integrity and host health
  logs <extension-id>        Show bounded, redacted extension host logs
  reload <extension-id>      Explicitly validate and reload a development directory

Common options:
  --json                     Emit schema-versioned machine-readable output
  --data-dir <path>          Extension profile root (default: ~/.kun/data)
  --extension-root <path>    Override immutable extension package root
  --extension-data-root <p>  Override extension state/log root
  --help                     Show help

Create options:
  --publisher <publisher>    Lowercase extension publisher
  --name <name>              Lowercase extension name
  --template <shape>         node | webview | react (default: node)
  --display-name <name>      Human-readable extension name

Pack/source-validation options:
  --output <path>            .kunx file or output directory
  --overwrite                Replace an existing pack output
  --include <relative-path>  Add a release file/directory (repeatable)
  --ignore <relative-path>   Exclude a selected file/directory (repeatable)

Install options:
  --development <path>       Register a mutable development directory
  --index <https-url>        Install one exact Index v1 version
  --id <extension-id>        Extension ID for an Index install
  --version <semver>         Exact Index/uninstall version
  --accept-permissions       Explicitly accept the exact requested permission set
  --no-select                Install without selecting the version
  --no-enable                Install without enabling the extension

Scope/log options:
  --workspace <path>         Apply enablement to one workspace
  --bytes <count>            Maximum log bytes (default ${DEFAULT_LOG_BYTES})
`

export type WritableLike = { write(chunk: string): unknown }

export type ExtensionCliIo = {
  stdout: WritableLike
  stderr: WritableLike
  env?: Record<string, string | undefined>
  cwd?: () => string
  homeDir?: () => string
  scaffold?: (options: {
    targetDirectory: string
    publisher: string
    name: string
    template: string
    displayName?: string
  }) => Promise<unknown>
}

export type ExtensionCliServices = {
  paths: ExtensionPaths
  registry: ExtensionRegistry
  packageManager: ExtensionPackageManager
  manager: ExtensionManager
  indexClient: ExtensionIndexClient
  compatibility: ExtensionCompatibility
}

export type ParsedArguments = {
  command: string
  positionals: string[]
  values: Map<string, string>
  repeatedValues: Map<string, string[]>
  flags: Set<string>
  json: boolean
}

export const VALUE_OPTIONS = new Set([
  'publisher',
  'name',
  'template',
  'display-name',
  'output',
  'include',
  'ignore',
  'development',
  'index',
  'id',
  'version',
  'workspace',
  'bytes',
  'data-dir',
  'extension-root',
  'extension-data-root'
])
export const REPEATABLE_VALUE_OPTIONS = new Set(['include', 'ignore'])
export const BOOLEAN_OPTIONS = new Set([
  'json',
  'help',
  'overwrite',
  'accept-permissions',
  'no-select',
  'no-enable',
  'development-validation'
])
export const COMMANDS = new Set([
  'create',
  'validate',
  'pack',
  'install',
  'list',
  'enable',
  'disable',
  'uninstall',
  'rollback',
  'doctor',
  'logs',
  'reload'
])

export function createExtensionCliServices(options: {
  dataDir?: string
  packageRoot?: string
  extensionDataRoot?: string
  kunVersion?: string
  runnerPath?: string
  homeDir?: string
} = {}): ExtensionCliServices {
  const profileRoot = resolve(options.dataDir ?? defaultKunDataDir(options.homeDir))
  const paths = new ExtensionPaths({
    packageRoot: options.packageRoot ?? join(profileRoot, 'extensions'),
    dataRoot: options.extensionDataRoot ?? join(profileRoot, 'extension-data')
  })
  const compatibility: ExtensionCompatibility = {
    kunVersion: options.kunVersion ?? DEFAULT_KUN_VERSION,
    supportedManifestVersions: [CURRENT_MANIFEST_VERSION],
    supportedApiVersions: SUPPORTED_EXTENSION_API_VERSIONS
  }
  const registry = new ExtensionRegistry(paths)
  const packageManager = new ExtensionPackageManager(paths, registry, { compatibility })
  const manager = new ExtensionManager({
    packageManager,
    paths,
    ...(options.runnerPath === undefined ? {} : { runnerPath: options.runnerPath })
  })
  const state = new ExtensionStateStore(paths)
  const migrations = new ExtensionStateMigrationCoordinator(state, manager, registry)
  packageManager.setLifecycle(migrations.lifecycle())
  return {
    paths,
    registry,
    packageManager,
    manager,
    indexClient: new ExtensionIndexClient(),
    compatibility
  }
}

/**
 * Runs argv following the `kun extension` prefix. The top-level CLI dispatcher
 * only needs to pass `argv.slice(1)` here when it recognizes `extension`.
 */
export async function runExtensionCommand(
  argv: readonly string[],
  io: ExtensionCliIo,
  suppliedServices?: ExtensionCliServices
): Promise<number> {
  let parsed: ParsedArguments
  try {
    parsed = parseArguments(argv)
  } catch (error) {
    io.stderr.write(`kun extension: ${errorMessage(error)}\n`)
    io.stderr.write(KUN_EXTENSION_CLI_USAGE)
    return ServeExitCode.usage
  }
  if (parsed.command === 'help' || parsed.flags.has('help')) {
    io.stdout.write(KUN_EXTENSION_CLI_USAGE)
    return ServeExitCode.ok
  }
  if (!COMMANDS.has(parsed.command)) {
    io.stderr.write(`kun extension: unknown command: ${parsed.command}\n`)
    io.stderr.write(KUN_EXTENSION_CLI_USAGE)
    return ServeExitCode.usage
  }

  let ownedServices: ExtensionCliServices | undefined
  try {
    if (parsed.command === 'create') {
      return await runCreate(parsed, io)
    }
    const homeDir = io.homeDir?.()
    const dataDirOption = parsed.values.get('data-dir')?.trim()
    if (parsed.values.has('data-dir') && !dataDirOption) {
      throw usageError('--data-dir requires a non-empty path')
    }
    const services = suppliedServices ?? createExtensionCliServices({
      dataDir: dataDirOption || io.env?.KUN_DATA_DIR?.trim() || undefined,
      packageRoot: parsed.values.get('extension-root'),
      extensionDataRoot: parsed.values.get('extension-data-root'),
      homeDir
    })
    if (suppliedServices === undefined) ownedServices = services
    await migrateLegacyExtensionRoots({
      packageRoot: services.paths.packageRoot,
      dataRoot: services.paths.dataRoot,
      homeDir,
      warn: (message) => io.stderr.write(`kun extension: ${message}\n`)
    })
    await services.packageManager.recover()
    switch (parsed.command) {
      case 'validate':
        return await runValidate(parsed, io, services)
      case 'pack':
        return await runPack(parsed, io, services)
      case 'install':
        return await runInstall(parsed, io, services)
      case 'list':
        return await runList(parsed, io, services)
      case 'enable':
        return await runEnablement(parsed, io, services, true)
      case 'disable':
        return await runEnablement(parsed, io, services, false)
      case 'uninstall':
        return await runUninstall(parsed, io, services)
      case 'rollback':
        return await runRollback(parsed, io, services)
      case 'doctor':
        return await runDoctor(parsed, io, services)
      case 'logs':
        return await runLogs(parsed, io, services)
      case 'reload':
        return await runReload(parsed, io, services)
      default:
        return ServeExitCode.usage
    }
  } catch (error) {
    writeCommandError(parsed, io, error)
    return errorExitCode(error)
  } finally {
    await ownedServices?.manager.shutdown().catch((error: unknown) => {
      io.stderr.write(`kun extension: shutdown failed: ${errorMessage(error)}\n`)
    })
  }
}

export async function runCreate(parsed: ParsedArguments, io: ExtensionCliIo): Promise<number> {
  const [target] = parsed.positionals
  const publisher = parsed.values.get('publisher')
  const name = parsed.values.get('name')
  if (target === undefined || publisher === undefined || name === undefined) {
    throw usageError('create requires <directory>, --publisher, and --name')
  }
  const scaffold = io.scaffold ?? await loadScaffolder()
  const result = await scaffold({
    targetDirectory: resolveFromCwd(target, io),
    publisher,
    name,
    template: parsed.values.get('template') ?? 'node',
    ...(parsed.values.get('display-name') === undefined
      ? {}
      : { displayName: parsed.values.get('display-name') })
  })
  writeResult(parsed, io, 'Created extension project', result)
  return ServeExitCode.ok
}

export async function runValidate(
  parsed: ParsedArguments,
  io: ExtensionCliIo,
  services: ExtensionCliServices
): Promise<number> {
  const [input = '.'] = parsed.positionals
  const path = resolveFromCwd(input, io)
  const details = await stat(path)
  if (details.isFile()) {
    const inspection = await inspectKunxArchive(path, { compatibility: services.compatibility })
    writeResult(parsed, io, 'Extension archive is valid', projectInspection(inspection))
    return ServeExitCode.ok
  }
  if (!details.isDirectory()) throw new ExtensionError('EXTENSION_PACKAGE_SOURCE_INVALID', 'Validation path must be a directory or .kunx file')
  if (parsed.flags.has('development-validation')) {
    const development = await inspectDevelopmentDirectory(path, { compatibility: services.compatibility })
    writeResult(parsed, io, 'Development extension is valid', {
      id: extensionId(development.manifest),
      version: development.manifest.version,
      path: development.path,
      digest: development.digest,
      mode: 'development'
    })
    return ServeExitCode.ok
  }
  const temporary = await mkdtemp(join(tmpdir(), 'kun-extension-validate-'))
  try {
    const inspection = await packKunx(path, join(temporary, 'validation.kunx'), {
      compatibility: services.compatibility,
      include: parsed.repeatedValues.get('include'),
      ignore: parsed.repeatedValues.get('ignore')
    })
    writeResult(parsed, io, 'Extension source is valid', {
      ...projectInspection(inspection),
      archivePath: undefined,
      sourcePath: path
    })
    return ServeExitCode.ok
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

export async function runPack(
  parsed: ParsedArguments,
  io: ExtensionCliIo,
  services: ExtensionCliServices
): Promise<number> {
  const [input = '.'] = parsed.positionals
  const source = resolveFromCwd(input, io)
  const development = await inspectDevelopmentDirectory(source, { compatibility: services.compatibility })
  const requestedOutput = parsed.values.get('output')
  const defaultName = `${extensionId(development.manifest)}-${development.manifest.version}.kunx`
  const output = requestedOutput === undefined
    ? join(source, 'dist', defaultName)
    : resolvePackOutput(resolveFromCwd(requestedOutput, io), defaultName)
  const inspection = await packKunx(source, output, {
    compatibility: services.compatibility,
    overwrite: parsed.flags.has('overwrite'),
    include: parsed.repeatedValues.get('include'),
    ignore: parsed.repeatedValues.get('ignore')
  })
  writeResult(parsed, io, `Packed ${basename(output)}`, projectInspection(inspection))
  return ServeExitCode.ok
}

export async function runInstall(
  parsed: ParsedArguments,
  io: ExtensionCliIo,
  services: ExtensionCliServices
): Promise<number> {
  const select = !parsed.flags.has('no-select')
  const enable = !parsed.flags.has('no-enable')
  const indexUrl = parsed.values.get('index')
  const developmentPath = parsed.values.get('development')
  if (indexUrl !== undefined) {
    const id = parsed.values.get('id')
    const version = parsed.values.get('version')
    if (id === undefined || version === undefined) {
      throw usageError('Index install requires --index, --id, and --version')
    }
    const index = await services.indexClient.load(indexUrl)
    const selected = index.extensions.find((entry) => entry.id === id)
      ?.versions.find((entry) => entry.version === version)
    if (selected === undefined) {
      throw new ExtensionError('EXTENSION_INDEX_VERSION_NOT_FOUND', 'Exact extension version is not in the index', { id, version })
    }
    requirePermissionAcceptance(parsed, io, id, selected.permissions)
    const installed = await services.indexClient.installExact(indexUrl, id, version, services.packageManager, {
      grantedPermissions: selected.permissions,
      select,
      enable
    })
    writeResult(parsed, io, `Installed ${id}@${version}`, projectInstalled(installed))
    return ServeExitCode.ok
  }
  if (developmentPath !== undefined) {
    const path = resolveFromCwd(developmentPath, io)
    const inspection = await inspectDevelopmentDirectory(path, { compatibility: services.compatibility })
    const id = extensionId(inspection.manifest)
    requirePermissionAcceptance(parsed, io, id, inspection.manifest.permissions)
    const registered = await services.packageManager.registerDevelopment(path, {
      grantedPermissions: inspection.manifest.permissions,
      select,
      enable
    })
    writeResult(parsed, io, `Registered development extension ${id}`, {
      id,
      version: registered.manifest.version,
      path: registered.path,
      digest: registered.digest,
      generation: registered.generation,
      mutable: true
    })
    return ServeExitCode.ok
  }
  const [input] = parsed.positionals
  if (input === undefined) throw usageError('install requires a .kunx path or --development/--index')
  const archivePath = resolveFromCwd(input, io)
  const inspection = await inspectKunxArchive(archivePath, { compatibility: services.compatibility })
  const id = extensionId(inspection.manifest)
  requirePermissionAcceptance(parsed, io, id, inspection.manifest.permissions)
  const installed = await services.packageManager.installArchive(archivePath, {
    grantedPermissions: inspection.manifest.permissions,
    select,
    enable
  })
  writeResult(parsed, io, `Installed ${id}@${installed.version}`, projectInstalled(installed))
  return ServeExitCode.ok
}

export async function runList(
  parsed: ParsedArguments,
  io: ExtensionCliIo,
  services: ExtensionCliServices
): Promise<number> {
  const registry = await services.registry.read()
  const diagnostics = await services.manager.listDiagnostics()
  const health = new Map(diagnostics.map((item) => [item.extensionId, item]))
  const extensions = Object.values(registry.extensions)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((entry) => ({
      ...projectEntry(entry),
      health: redactSecrets(health.get(entry.id) ?? { lifecycleState: 'inactive', active: false })
    }))
  if (parsed.json) {
    writeJson(io.stdout, { schemaVersion: KUN_EXTENSION_CLI_SCHEMA_VERSION, revision: registry.revision, extensions })
  } else if (extensions.length === 0) {
    io.stdout.write('No Kun extensions installed.\n')
  } else {
    io.stdout.write(`${extensions.map((extension) => [
      extension.id,
      extension.useDevelopment ? `${extension.development?.version ?? '-'} (development)` : extension.selectedVersion ?? '-',
      extension.globallyEnabled ? 'enabled' : 'disabled',
      extension.health.lifecycleState
    ].join('\t')).join('\n')}\n`)
  }
  return ServeExitCode.ok
}

export async function runEnablement(
  parsed: ParsedArguments,
  io: ExtensionCliIo,
  services: ExtensionCliServices,
  enabled: boolean
): Promise<number> {
  const id = requiredExtensionId(parsed)
  const workspace = parsed.values.get('workspace')
  if (workspace === undefined) {
    await services.packageManager.setGlobalEnabled(id, enabled)
  } else {
    const workspaceRoot = resolveFromCwd(workspace, io)
    await services.packageManager.setWorkspaceEnabled(
      id,
      services.paths.workspaceKey(workspaceRoot),
      enabled,
      workspaceRoot
    )
  }
  const entry = await requireEntry(services.registry, id)
  writeResult(parsed, io, `${enabled ? 'Enabled' : 'Disabled'} ${id}`, projectEntry(entry))
  return ServeExitCode.ok
}

export async function runUninstall(
  parsed: ParsedArguments,
  io: ExtensionCliIo,
  services: ExtensionCliServices
): Promise<number> {
  const id = requiredExtensionId(parsed)
  const version = parsed.values.get('version')
  if (version === undefined) await services.packageManager.uninstall(id)
  else await services.packageManager.uninstallVersion(id, version)
  writeResult(parsed, io, `Uninstalled ${id}${version ? `@${version}` : ''}`, {
    extensionId: id,
    version,
    dataPreserved: true
  })
  return ServeExitCode.ok
}

export async function runRollback(
  parsed: ParsedArguments,
  io: ExtensionCliIo,
  services: ExtensionCliServices
): Promise<number> {
  const id = requiredExtensionId(parsed)
  const entry = await requireEntry(services.registry, id)
  const requested = parsed.values.get('version')
  if (requested !== undefined && requested !== entry.previousSelectedVersion) {
    throw new ExtensionError(
      'EXTENSION_ROLLBACK_VERSION_INVALID',
      'Rollback --version must match the retained previous selected version',
      { requested, previousSelectedVersion: entry.previousSelectedVersion }
    )
  }
  await services.packageManager.rollback(id)
  writeResult(parsed, io, `Rolled back ${id}`, projectEntry(await requireEntry(services.registry, id)))
  return ServeExitCode.ok
}

export async function runDoctor(
  parsed: ParsedArguments,
  io: ExtensionCliIo,
  services: ExtensionCliServices
): Promise<number> {
  const [requestedId] = parsed.positionals
  const registry = await services.registry.read()
  const ids = requestedId === undefined ? Object.keys(registry.extensions).sort() : [requestedId]
  if (requestedId !== undefined && registry.extensions[requestedId] === undefined) {
    throw new ExtensionError('EXTENSION_NOT_INSTALLED', 'Extension is not installed', { extensionId: requestedId })
  }
  const diagnostics = []
  let healthy = true
  for (const id of ids) {
    const entry = registry.extensions[id]!
    const result = await diagnoseExtension(id, entry, services)
    diagnostics.push(result)
    if (!result.healthy) healthy = false
  }
  if (parsed.json) {
    writeJson(io.stdout, { schemaVersion: KUN_EXTENSION_CLI_SCHEMA_VERSION, healthy, diagnostics })
  } else if (diagnostics.length === 0) {
    io.stdout.write('No Kun extensions installed.\n')
  } else {
    for (const diagnostic of diagnostics) {
      io.stdout.write(`${diagnostic.healthy ? 'ok' : 'error'}\t${diagnostic.extensionId}\t${diagnostic.codes.join(', ')}\n`)
    }
  }
  return healthy ? ServeExitCode.ok : ServeExitCode.runtime
}

export async function runLogs(
  parsed: ParsedArguments,
  io: ExtensionCliIo,
  services: ExtensionCliServices
): Promise<number> {
  const id = requiredExtensionId(parsed)
  await requireEntry(services.registry, id)
  const bytes = parseBoundedInteger(parsed.values.get('bytes'), DEFAULT_LOG_BYTES, 1, MAX_LOG_BYTES, '--bytes')
  const diagnostic = await services.manager.diagnostic(id)
  const logPath = diagnostic.logPath ?? join(services.paths.logsDirectory(id), 'host.log')
  const content = redactSecretText(await readRotatedLogTail(logPath, bytes))
  if (parsed.json) {
    writeJson(io.stdout, {
      schemaVersion: KUN_EXTENSION_CLI_SCHEMA_VERSION,
      extensionId: id,
      logPath,
      bytes: Buffer.byteLength(content),
      content
    })
  } else if (content.length === 0) {
    io.stdout.write(`No logs recorded for ${id}.\n`)
  } else {
    io.stdout.write(content.endsWith('\n') ? content : `${content}\n`)
  }
  return ServeExitCode.ok
}

export async function runReload(
  parsed: ParsedArguments,
  io: ExtensionCliIo,
  services: ExtensionCliServices
): Promise<number> {
  const id = requiredExtensionId(parsed)
  const development = await services.packageManager.reloadDevelopment(id)
  writeResult(parsed, io, `Reloaded ${id}`, {
    extensionId: id,
    version: development.manifest.version,
    path: development.path,
    digest: development.digest,
    generation: development.generation,
    mutable: true
  })
  return ServeExitCode.ok
}

export async function diagnoseExtension(
  id: string,
  entry: ExtensionRegistryEntry,
  services: ExtensionCliServices
) {
  const codes: string[] = []
  const details: Array<{ code: string; message: string; details?: unknown }> = []
  const record = (error: unknown) => {
    const normalized = normalizeCliError(error)
    codes.push(normalized.code)
    details.push(normalized)
  }
  if (entry.useDevelopment) {
    if (entry.development === undefined) {
      record(new ExtensionError('EXTENSION_DEVELOPMENT_UNAVAILABLE', 'Selected development source is unavailable'))
    } else {
      try {
        const inspected = await inspectDevelopmentDirectory(entry.development.path, {
          compatibility: services.compatibility
        })
        if (inspected.digest !== entry.development.digest) {
          record(new ExtensionError(
            'EXTENSION_DEVELOPMENT_RELOAD_REQUIRED',
            'Development source changed; explicit reload is required'
          ))
        }
      } catch (error) {
        record(error)
      }
    }
  } else if (entry.selectedVersion === undefined) {
    record(new ExtensionError('EXTENSION_VERSION_NOT_SELECTED', 'Extension has no selected version'))
  } else {
    const selected = entry.versions[entry.selectedVersion]
    if (selected === undefined) {
      record(new ExtensionError('EXTENSION_VERSION_UNAVAILABLE', 'Selected extension version is unavailable'))
    } else {
      try {
        await verifyExtractedExtension(
          selected.packagePath,
          selected.manifest,
          selected.integrity
        )
      } catch (error) {
        record(error)
      }
    }
  }
  const host = redactSecrets(await services.manager.diagnostic(id))
  for (const diagnostic of host.compatibility?.diagnostics ?? []) {
    if (!diagnostic.compatible) {
      record(new ExtensionError(diagnostic.code, diagnostic.message, {
        dimension: diagnostic.dimension,
        declared: diagnostic.declared,
        supported: diagnostic.supported
      }))
    }
  }
  if (host.circuitOpen) {
    record(new ExtensionError('EXTENSION_HOST_CIRCUIT_OPEN', 'Extension host circuit is open'))
  }
  if (codes.length === 0) codes.push('EXTENSION_OK')
  return {
    extensionId: id,
    healthy: details.length === 0,
    codes,
    details,
    registry: projectEntry(entry),
    host
  }
}
