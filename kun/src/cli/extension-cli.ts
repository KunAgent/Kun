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

const KUN_EXTENSION_CLI_SCHEMA_VERSION = 1
const DEFAULT_KUN_VERSION = '0.1.0'
const DEFAULT_LOG_BYTES = 256 * 1024
const MAX_LOG_BYTES = 1024 * 1024

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
  --data-dir <path>          Profile root used for extension registry and data
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

type WritableLike = { write(chunk: string): unknown }

export type ExtensionCliIo = {
  stdout: WritableLike
  stderr: WritableLike
  env?: Record<string, string | undefined>
  cwd?: () => string
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

type ParsedArguments = {
  command: string
  positionals: string[]
  values: Map<string, string>
  repeatedValues: Map<string, string[]>
  flags: Set<string>
  json: boolean
}

const VALUE_OPTIONS = new Set([
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
const REPEATABLE_VALUE_OPTIONS = new Set(['include', 'ignore'])
const BOOLEAN_OPTIONS = new Set([
  'json',
  'help',
  'overwrite',
  'accept-permissions',
  'no-select',
  'no-enable',
  'development-validation'
])
const COMMANDS = new Set([
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
} = {}): ExtensionCliServices {
  const profileRoot = options.dataDir === undefined ? undefined : resolve(options.dataDir)
  const paths = new ExtensionPaths({
    ...(options.packageRoot !== undefined
      ? { packageRoot: options.packageRoot }
      : profileRoot !== undefined
        ? { packageRoot: join(profileRoot, 'extensions') }
        : {}),
    ...(options.extensionDataRoot !== undefined
      ? { dataRoot: options.extensionDataRoot }
      : profileRoot !== undefined
        ? { dataRoot: join(profileRoot, 'extension-data') }
        : {})
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
    const services = suppliedServices ?? createExtensionCliServices({
      dataDir: parsed.values.get('data-dir') ?? io.env?.KUN_DATA_DIR,
      packageRoot: parsed.values.get('extension-root'),
      extensionDataRoot: parsed.values.get('extension-data-root')
    })
    if (suppliedServices === undefined) ownedServices = services
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

async function runCreate(parsed: ParsedArguments, io: ExtensionCliIo): Promise<number> {
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

async function runValidate(
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

async function runPack(
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

async function runInstall(
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

async function runList(
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

async function runEnablement(
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

async function runUninstall(
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

async function runRollback(
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

async function runDoctor(
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

async function runLogs(
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

async function runReload(
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

async function diagnoseExtension(
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

function parseArguments(argv: readonly string[]): ParsedArguments {
  const first = argv[0]
  if (first === undefined || first === '--help' || first === '-h' || first === 'help') {
    return {
      command: 'help',
      positionals: [],
      values: new Map(),
      repeatedValues: new Map(),
      flags: new Set(),
      json: false
    }
  }
  const values = new Map<string, string>()
  const repeatedValues = new Map<string, string[]>()
  const flags = new Set<string>()
  const positionals: string[] = []
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index]!
    if (argument === '--') {
      positionals.push(...argv.slice(index + 1))
      break
    }
    if (argument === '-h') {
      flags.add('help')
      continue
    }
    if (argument === '-o') {
      const value = argv[++index]
      if (value === undefined) throw usageError('-o requires a value')
      values.set('output', value)
      continue
    }
    if (!argument.startsWith('--')) {
      positionals.push(argument)
      continue
    }
    const separator = argument.indexOf('=')
    const name = separator < 0 ? argument.slice(2) : argument.slice(2, separator)
    if (BOOLEAN_OPTIONS.has(name)) {
      if (separator >= 0 && argument.slice(separator + 1) !== 'true') {
        throw usageError(`--${name} is a boolean flag`)
      }
      flags.add(name)
      continue
    }
    if (!VALUE_OPTIONS.has(name)) throw usageError(`unknown option: --${name}`)
    const value = separator >= 0 ? argument.slice(separator + 1) : argv[++index]
    if (value === undefined || value.length === 0) throw usageError(`--${name} requires a value`)
    values.set(name, value)
    if (REPEATABLE_VALUE_OPTIONS.has(name)) {
      const existing = repeatedValues.get(name) ?? []
      existing.push(value)
      repeatedValues.set(name, existing)
    }
  }
  return {
    command: first,
    positionals,
    values,
    repeatedValues,
    flags,
    json: flags.has('json')
  }
}

function requiredExtensionId(parsed: ParsedArguments): string {
  const [id] = parsed.positionals
  if (id === undefined) throw usageError(`${parsed.command} requires <extension-id>`)
  if (!/^[a-z0-9][a-z0-9-]{0,63}\.[a-z0-9][a-z0-9-]{0,63}$/.test(id)) {
    throw new ExtensionError('EXTENSION_ID_INVALID', 'Extension ID must be publisher.name', { extensionId: id })
  }
  return id
}

function requirePermissionAcceptance(
  parsed: ParsedArguments,
  io: ExtensionCliIo,
  id: string,
  permissions: string[]
): void {
  if (parsed.flags.has('accept-permissions')) return
  const disclosure = permissions.length === 0 ? '(none)' : permissions.join(', ')
  io.stderr.write(`Requested permissions for ${id}: ${disclosure}\n`)
  throw new ExtensionError(
    'EXTENSION_PERMISSION_CONSENT_REQUIRED',
    'Headless installation requires explicit --accept-permissions; Node extensions run with the current user\'s OS privileges',
    { extensionId: id, requestedPermissions: permissions }
  )
}

async function requireEntry(registry: ExtensionRegistry, id: string): Promise<ExtensionRegistryEntry> {
  const entry = await registry.get(id)
  if (entry === undefined) throw new ExtensionError('EXTENSION_NOT_INSTALLED', 'Extension is not installed', { extensionId: id })
  return entry
}

function projectEntry(entry: ExtensionRegistryEntry) {
  return {
    id: entry.id,
    selectedVersion: entry.selectedVersion,
    previousSelectedVersion: entry.previousSelectedVersion,
    installedVersions: Object.keys(entry.versions).sort(),
    globallyEnabled: entry.globallyEnabled,
    workspaceEnablement: structuredClone(entry.workspaceEnablement),
    useDevelopment: entry.useDevelopment,
    development: entry.development === undefined ? undefined : {
      version: entry.development.manifest.version,
      path: entry.development.path,
      generation: entry.development.generation,
      digest: entry.development.digest
    },
    selectedSource: entry.useDevelopment
      ? entry.development?.source
      : entry.selectedVersion === undefined
        ? undefined
        : entry.versions[entry.selectedVersion]?.source,
    selectedSignatureStatus: entry.useDevelopment || entry.selectedVersion === undefined
      ? undefined
      : entry.versions[entry.selectedVersion]?.signatureStatus,
    grantedPermissions: entry.useDevelopment
      ? entry.development?.grantedPermissions ?? []
      : entry.selectedVersion === undefined
        ? []
        : entry.versions[entry.selectedVersion]?.grantedPermissions ?? []
  }
}

function projectInstalled(installed: Awaited<ReturnType<ExtensionPackageManager['installArchive']>>) {
  return {
    id: extensionId(installed.manifest),
    version: installed.version,
    path: installed.packagePath,
    sha256: installed.archiveSha256,
    source: installed.source,
    signatureStatus: installed.signatureStatus,
    requestedPermissions: installed.requestedPermissions,
    grantedPermissions: installed.grantedPermissions,
    installedAt: installed.installedAt
  }
}

function projectInspection(inspection: Awaited<ReturnType<typeof inspectKunxArchive>>) {
  return {
    id: extensionId(inspection.manifest),
    version: inspection.manifest.version,
    archivePath: inspection.archivePath,
    sha256: inspection.archiveSha256,
    signatureStatus: inspection.signatureStatus,
    requestedPermissions: inspection.manifest.permissions,
    apiVersion: inspection.manifest.apiVersion,
    manifestVersion: inspection.manifest.manifestVersion,
    enginesKun: inspection.manifest.engines.kun,
    fileCount: inspection.fileCount,
    expandedBytes: inspection.expandedBytes
  }
}

function extensionId(manifest: { publisher: string; name: string }): string {
  return `${manifest.publisher}.${manifest.name}`
}

function resolveFromCwd(path: string, io: ExtensionCliIo): string {
  return resolve(io.cwd?.() ?? process.cwd(), path)
}

function resolvePackOutput(output: string, defaultName: string): string {
  return extname(output).toLowerCase() === '.kunx' ? output : join(output, defaultName)
}

async function loadScaffolder(): Promise<NonNullable<ExtensionCliIo['scaffold']>> {
  const packageName = 'create-kun-extension'
  try {
    const module = await import(packageName) as {
      scaffoldExtension?: NonNullable<ExtensionCliIo['scaffold']>
    }
    if (typeof module.scaffoldExtension !== 'function') throw new Error('scaffoldExtension export is missing')
    return module.scaffoldExtension
  } catch (error) {
    throw new ExtensionError(
      'EXTENSION_SCAFFOLDER_UNAVAILABLE',
      'create-kun-extension is not installed with this Kun distribution',
      {},
      { cause: error }
    )
  }
}

async function readRotatedLogTail(logPath: string, maximum: number): Promise<string> {
  const files = [logPath, `${logPath}.1`, `${logPath}.2`, `${logPath}.3`]
  const chunks: Buffer[] = []
  let remaining = maximum
  for (const path of files) {
    if (remaining <= 0) break
    const details = await stat(path).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    })
    if (details === undefined || !details.isFile()) continue
    const length = Math.min(remaining, details.size)
    const buffer = Buffer.alloc(length)
    const handle = await open(path, 'r')
    try {
      await handle.read(buffer, 0, length, details.size - length)
    } finally {
      await handle.close()
    }
    chunks.unshift(buffer)
    remaining -= length
  }
  return Buffer.concat(chunks).toString('utf8')
}

function parseBoundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string
): number {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw usageError(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  return parsed
}

function writeResult(parsed: ParsedArguments, io: ExtensionCliIo, message: string, result: unknown): void {
  if (parsed.json) {
    writeJson(io.stdout, { schemaVersion: KUN_EXTENSION_CLI_SCHEMA_VERSION, result: redactSecrets(result) })
  } else {
    io.stdout.write(`${message}\n`)
    if (result && typeof result === 'object') io.stdout.write(`${JSON.stringify(redactSecrets(result), null, 2)}\n`)
  }
}

function writeJson(output: WritableLike, value: unknown): void {
  output.write(`${JSON.stringify(value)}\n`)
}

function writeCommandError(parsed: ParsedArguments, io: ExtensionCliIo, error: unknown): void {
  const normalized = normalizeCliError(error)
  if (parsed.json) {
    io.stderr.write(`${JSON.stringify({ schemaVersion: KUN_EXTENSION_CLI_SCHEMA_VERSION, error: normalized })}\n`)
  } else {
    io.stderr.write(`kun extension ${parsed.command}: ${normalized.code}: ${normalized.message}\n`)
    if (normalized.details !== undefined) {
      io.stderr.write(`${JSON.stringify(normalized.details, null, 2)}\n`)
    }
  }
}

function normalizeCliError(error: unknown): { code: string; message: string; details?: unknown } {
  if ((error as { usage?: boolean })?.usage === true) {
    return { code: 'EXTENSION_CLI_USAGE', message: redactSecretText(errorMessage(error)).slice(0, 4_096) }
  }
  if (error instanceof ExtensionError) {
    return {
      code: error.code,
      message: redactSecretText(error.message).slice(0, 4_096),
      details: redactSecrets(error.details)
    }
  }
  if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
    return {
      code: 'EXTENSION_PATH_NOT_FOUND',
      message: redactSecretText(errorMessage(error)).slice(0, 4_096)
    }
  }
  const message = redactSecretText(errorMessage(error)).slice(0, 4_096)
  const match = message.match(/^([A-Z][A-Z0-9_]+):\s*(.*)$/)
  return match === null
    ? { code: 'EXTENSION_INTERNAL_ERROR', message }
    : { code: match[1]!, message: match[2]! }
}

function errorExitCode(error: unknown): number {
  if ((error as { usage?: boolean })?.usage === true) return ServeExitCode.usage
  const code = error instanceof ExtensionError ? error.code : ''
  if (/(?:INVALID|MISSING|INCOMPATIBLE|UNSUPPORTED|VALIDATION|LIMIT|FORBIDDEN)/.test(code)) {
    return ServeExitCode.config
  }
  return ServeExitCode.runtime
}

function usageError(message: string): Error & { usage: true } {
  return Object.assign(new Error(message), { usage: true as const })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
