#!/usr/bin/env node

const { execFileSync, spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { createServer } = require('node:net')
const nodeFs = require('node:fs')
const {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync
} = nodeFs
// Electron patches `node:fs` so an ASAR path behaves like a directory. The
// release smoke needs the archive's raw bytes to validate its bounded header,
// so use Electron's escape hatch when re-executed by the packaged binary.
let rawFs = nodeFs
try {
  rawFs = require('original-fs')
} catch {
  // Plain Node validation has no `original-fs`; node:fs is already raw there.
}
const { closeSync, fstatSync, openSync, readSync } = rawFs
const {
  chmod,
  lstat,
  mkdtemp,
  mkdir,
  readdir,
  rm,
  writeFile
} = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { basename, dirname, isAbsolute, join, relative, resolve, sep } = require('node:path')
const { pathToFileURL } = require('node:url')
const { KUN_RUNTIME_REQUIRED_PATHS } = require('./after-pack.cjs')

const EXTENSION_ID = 'kun-smoke.packaged'
const DEFAULT_EXTENSION_IDS = [
  'kun-examples.kun-video-editor',
  'kun-examples.presentation-studio',
  'kun-examples.social-media-sidebar'
]
const RUNTIME_TOKEN = 'kun-packaged-extension-smoke-token'
const PACKAGED_EXTENSION_SMOKE_SUCCESS_MARKER = 'Packaged Extension smoke OK ('

async function main() {
  // Headless release smoke profiles must not depend on an interactive OS
  // credential service. The runtime still exercises encrypted 0600 key-file
  // storage; production keeps its normal fail-closed keychain behavior.
  process.env.KUN_DISABLE_OS_CREDENTIAL_STORE = '1'
  const resourcesDir = resolveResources(argumentValue('--resources'))
  if (process.env.KUN_PACKAGED_EXTENSION_SMOKE_REEXEC !== '1') {
    const runtimeExecutable = resolvePackagedRuntimeExecutable(
      resourcesDir,
      argumentValue('--runtime-executable')
    )
    if (runtimeExecutable) {
      const result = spawnSync(runtimeExecutable, [__filename, ...process.argv.slice(2)], {
        cwd: process.cwd(),
        env: createPackagedExtensionSmokeReexecEnvironment(process.env),
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      if (result.stdout) process.stdout.write(result.stdout)
      if (result.stderr) process.stderr.write(result.stderr)
      assertPackagedSmokeChildResult(result)
      return
    }
  }
  const unpackedRoot = join(resourcesDir, 'app.asar.unpacked')
  const runtimeEntry = join(unpackedRoot, 'kun', 'dist', 'cli', 'serve-entry.js')
  validatePackagedResources(resourcesDir, unpackedRoot)

  const temporaryRoot = await mkdtemp(join(tmpdir(), 'kun-packaged-extension-smoke-'))
  let server
  let primaryFailed = false
  let primaryError
  let cleanupFailed = false
  let cleanupError
  try {
    const profile = join(temporaryRoot, 'profile')
    const workspace = join(temporaryRoot, 'workspace')
    await mkdir(workspace, { recursive: true })
    await installSmokeExtensionFixture({
      temporaryRoot,
      profile,
      runCli: (args) => runKun(runtimeEntry, args)
    })

    const [{ parseServeOptions }, { startKunServe }, { makeUserItem }] = await Promise.all([
      importFresh(join(unpackedRoot, 'kun', 'dist', 'cli', 'serve.js')),
      importFresh(join(unpackedRoot, 'kun', 'dist', 'server', 'runtime-factory.js')),
      importFresh(join(unpackedRoot, 'kun', 'dist', 'domain', 'item.js'))
    ])
    const port = await availablePort()
    const options = parseServeOptions([
      '--host', '127.0.0.1',
      '--port', String(port),
      '--data-dir', profile,
      '--bundled-extensions-dir', join(resourcesDir, 'bundled-extensions'),
      '--runtime-token', RUNTIME_TOKEN,
      '--api-key', 'packaged-smoke-placeholder',
      '--base-url', 'https://invalid.example',
      '--model', 'packaged-smoke-model',
      '--approval-policy', 'auto',
      '--sandbox-mode', 'danger-full-access'
    ], {})
    server = await startKunServe(options)

    const activated = await activateSmokeExtension(server.runtime, workspace)
    await smokeWorkbenchAndWebview(port, activated.workspace)
    const tool = await smokeHeadlessTool(server.runtime, activated.workspace)
    const provider = await smokeCustomProvider(server.runtime, activated.host, makeUserItem)
    await smokeAgentTool(server.runtime, activated.workspace, tool, provider)

    const diagnostics = await server.runtime.toolDiagnostics()
    if (!diagnostics.extensions.tools.some((tool) => tool.extensionId === EXTENSION_ID)) {
      throw new Error('Packaged extension tool is absent from runtime diagnostics')
    }
    if (diagnostics.extensions.providers.length !== 1) {
      throw new Error('Packaged custom Provider is absent from runtime diagnostics')
    }

    await server.close()
    server = undefined
    runKun(runtimeEntry, ['extension', 'doctor', EXTENSION_ID, '--data-dir', profile, '--json'])
    runKun(runtimeEntry, ['extension', 'uninstall', EXTENSION_ID, '--data-dir', profile, '--json'])
    const listed = JSON.parse(runKun(runtimeEntry, [
      'extension', 'list', '--data-dir', profile, '--json'
    ]))
    if (!Array.isArray(listed.extensions) || listed.extensions.length !== DEFAULT_EXTENSION_IDS.length) {
      throw new Error('Packaged default extensions were not seeded through the normal registry')
    }
    for (const id of DEFAULT_EXTENSION_IDS) {
      const installed = listed.extensions.find((extension) => extension?.id === id)
      if (installed?.globallyEnabled !== true) {
        throw new Error(`Packaged default extension was not enabled through the registry: ${id}`)
      }
      runKun(runtimeEntry, [
        'extension', 'uninstall', id, '--data-dir', profile, '--json'
      ])
    }
    server = await startKunServe(options)
    await server.close()
    server = undefined
    const afterRemoval = JSON.parse(runKun(runtimeEntry, [
      'extension', 'list', '--data-dir', profile, '--json'
    ]))
    if (!Array.isArray(afterRemoval.extensions) || afterRemoval.extensions.length !== 0) {
      throw new Error('Packaged default extension was resurrected after explicit uninstall')
    }

  } catch (error) {
    primaryFailed = true
    primaryError = error
  } finally {
    await server?.close().catch(() => undefined)
    if (process.env.KUN_KEEP_PACKAGED_EXTENSION_SMOKE === '1') {
      process.stderr.write(`Preserved packaged Extension smoke profile: ${temporaryRoot}\n`)
    } else {
      try {
        await makeTreeWritable(temporaryRoot)
        await rm(temporaryRoot, { recursive: true, force: true })
      } catch (error) {
        cleanupFailed = true
        cleanupError = error
      }
    }
  }
  if (primaryFailed) {
    if (cleanupFailed) {
      process.stderr.write(
        `Could not clean packaged Extension smoke profile ${temporaryRoot}: ${String(cleanupError)}\n`
      )
    }
    throw primaryError
  }
  if (cleanupFailed) throw cleanupError
  process.stdout.write(
    `${PACKAGED_EXTENSION_SMOKE_SUCCESS_MARKER}${process.platform}): resources, bundled-default seed/removal, .kunx lifecycle, Webview session, headless tool, Agent/tool round-trip, custom Provider/account stream, diagnostics, and uninstall.\n`
  )
}

function assertPackagedSmokeChildResult(result) {
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `Packaged runtime smoke child failed (${result.signal ?? result.status ?? 'unknown exit'})`
    )
  }
  if (!String(result.stdout ?? '').includes(PACKAGED_EXTENSION_SMOKE_SUCCESS_MARKER)) {
    throw new Error(
      'Packaged runtime smoke child exited without the required completion marker'
    )
  }
}

function createPackagedExtensionSmokeReexecEnvironment(environment = process.env) {
  return {
    ...environment,
    ELECTRON_RUN_AS_NODE: '1',
    KUN_DISABLE_OS_CREDENTIAL_STORE: '1',
    KUN_PACKAGED_EXTENSION_SMOKE_REEXEC: '1'
  }
}

function resolvePackagedRuntimeExecutable(resourcesDir, explicit) {
  if (explicit) {
    const candidate = resolve(explicit)
    assertExists(candidate, 'runtime executable')
    return candidate
  }
  if (process.platform === 'darwin') {
    const normalized = resourcesDir.replaceAll('\\', '/')
    const packagedArch = normalized.includes('/mac-arm64/')
      ? 'arm64'
      : normalized.includes('/mac/')
        ? 'x64'
        : undefined
    if (packagedArch && packagedArch !== process.arch) return undefined
    if (!normalized.endsWith('.app/Contents/Resources')) return undefined
    const candidate = join(dirname(resourcesDir), 'MacOS', 'Kun')
    assertExists(candidate, 'runtime executable')
    return candidate
  }
  const appOutDir = dirname(resourcesDir)
  const names = process.platform === 'win32'
    ? ['Kun.exe']
    : ['kun', 'Kun', 'kun-gui']
  const candidate = names.map((name) => join(appOutDir, name)).find(existsSync)
  if (!candidate) {
    throw new Error(`Cannot find packaged runtime executable beside ${resourcesDir}`)
  }
  return candidate
}

async function makeTreeWritable(root) {
  if (process.platform === 'win32') return
  const details = await lstat(root)
  if (details.isSymbolicLink()) return
  if (!details.isDirectory()) {
    await chmod(root, 0o600)
    return
  }
  await chmod(root, 0o700)
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) await makeTreeWritable(path)
    else await chmod(path, 0o600)
  }
}

function packagedResourceCandidates(platform = process.platform, arch = process.arch) {
  if (platform === 'darwin') {
    if (arch === 'arm64') return ['dist/mac-arm64/Kun.app/Contents/Resources']
    if (arch === 'x64') return ['dist/mac/Kun.app/Contents/Resources']
    return []
  }
  if (platform === 'win32') return ['dist/win-unpacked/resources']
  if (platform === 'linux') return ['dist/linux-unpacked/resources']
  return []
}

function resolvedPackagedResourceCandidates(
  platform = process.platform,
  arch = process.arch,
  cwd = process.cwd()
) {
  return packagedResourceCandidates(platform, arch).map((candidate) => resolve(cwd, candidate))
}

function resolveResources(explicit) {
  if (explicit) return resolve(explicit)
  const candidates = resolvedPackagedResourceCandidates()
  const found = candidates.find(existsSync)
  if (!found) {
    throw new Error(`Cannot find packaged resources; pass --resources <path> (checked ${candidates.join(', ')})`)
  }
  return found
}

function validatePackagedResources(resourcesDir, unpackedRoot) {
  assertExists(join(resourcesDir, 'app.asar'), 'app.asar')
  assertExists(unpackedRoot, 'app.asar.unpacked')
  for (const relativePath of KUN_RUNTIME_REQUIRED_PATHS) {
    assertConfinedPackagedPath(unpackedRoot, relativePath)
  }
  validateBundledDefaultExtension(resourcesDir)
  for (const relativePath of [
    'kun/node_modules/@kun/extension-api',
    'kun/node_modules/create-kun-extension'
  ]) {
    const details = lstatSync(join(unpackedRoot, relativePath))
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw new Error(`Packaged workspace dependency must be a materialized directory: ${relativePath}`)
    }
  }
  const asarHeader = readAsarHeader(join(resourcesDir, 'app.asar'))
  for (const preload of [
    'out/preload/extension-view.cjs',
    'out/preload/extension-protected-surface.cjs'
  ]) {
    if (!hasAsarEntry(asarHeader, preload)) {
      throw new Error(`Packaged app.asar does not contain ${preload}`)
    }
  }
}

function validateBundledDefaultExtension(resourcesDir) {
  const root = join(resourcesDir, 'bundled-extensions')
  const catalogPath = join(root, 'catalog.json')
  assertExists(catalogPath, 'bundled extension catalog')
  const catalogDetails = lstatSync(catalogPath)
  if (!catalogDetails.isFile() || catalogDetails.isSymbolicLink()) {
    throw new Error('Packaged bundled extension catalog is not a regular file')
  }
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
  if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.extensions)) {
    throw new Error('Packaged bundled extension catalog is invalid')
  }
  for (const id of DEFAULT_EXTENSION_IDS) {
    const matches = catalog.extensions.filter((entry) => entry?.id === id)
    if (matches.length !== 1) {
      throw new Error(`Packaged bundled extension catalog omits a default extension: ${id}`)
    }
    const entry = matches[0]
    if (
      typeof entry.archive !== 'string' ||
      !/^[0-9A-Za-z][0-9A-Za-z._-]*\.kunx$/u.test(entry.archive) ||
      typeof entry.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(entry.sha256)
    ) {
      throw new Error(`Packaged bundled extension catalog entry is invalid: ${id}`)
    }
    const archivePath = join(root, entry.archive)
    assertExists(archivePath, `bundled extension archive ${id}`)
    const archiveDetails = lstatSync(archivePath)
    if (!archiveDetails.isFile() || archiveDetails.isSymbolicLink() || archiveDetails.size <= 0) {
      throw new Error(`Packaged bundled extension archive is not a regular file: ${id}`)
    }
    const digest = createHash('sha256').update(readFileSync(archivePath)).digest('hex')
    if (digest !== entry.sha256) {
      throw new Error(`Packaged bundled extension archive digest does not match its catalog: ${id}`)
    }
  }
}

function assertConfinedPackagedPath(unpackedRoot, relativePath) {
  const path = join(unpackedRoot, relativePath)
  assertExists(path, relativePath)
  const root = realpathSync(unpackedRoot)
  const target = realpathSync(path)
  const fromRoot = relative(root, target)
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`Packaged resource escapes app.asar.unpacked: ${relativePath} -> ${target}`)
  }
}

function readAsarHeader(path) {
  const fd = openSync(path, 'r')
  try {
    const stat = fstatSync(fd)
    const prefix = Buffer.alloc(16)
    readExactly(fd, prefix, 0)
    const sizeFieldBytes = prefix.readUInt32LE(0)
    const headerPickleBytes = prefix.readUInt32LE(4)
    const jsonBytes = prefix.readUInt32LE(12)
    if (
      sizeFieldBytes !== 4 ||
      headerPickleBytes < jsonBytes + 4 ||
      jsonBytes < 2 ||
      jsonBytes > 64 * 1024 * 1024 ||
      16 + jsonBytes > stat.size
    ) {
      throw new Error(`Packaged app.asar has an invalid or unbounded header: ${path}`)
    }
    const json = Buffer.alloc(jsonBytes)
    readExactly(fd, json, 16)
    const parsed = JSON.parse(json.toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || !parsed.files || typeof parsed.files !== 'object') {
      throw new Error(`Packaged app.asar header has no file tree: ${path}`)
    }
    return parsed
  } finally {
    closeSync(fd)
  }
}

function readExactly(fd, buffer, position) {
  let offset = 0
  while (offset < buffer.length) {
    const bytes = readSync(fd, buffer, offset, buffer.length - offset, position + offset)
    if (bytes === 0) throw new Error('Unexpected end of packaged app.asar header')
    offset += bytes
  }
}

function hasAsarEntry(header, path) {
  let files = header.files
  const segments = path.split('/')
  for (let index = 0; index < segments.length; index += 1) {
    const entry = files?.[segments[index]]
    if (!entry || typeof entry !== 'object') return false
    if (index === segments.length - 1) {
      return Number.isSafeInteger(entry.size) && entry.size >= 0 && entry.files === undefined
    }
    files = entry.files
  }
  return false
}

async function createSmokeExtension(root, { webviewConnectUrls = [] } = {}) {
  const webviewCsp = smokeWebviewCsp(webviewConnectUrls)
  await mkdir(join(root, 'dist', 'webview'), { recursive: true })
  await writeFile(join(root, 'kun-extension.json'), `${JSON.stringify({
    manifestVersion: 1,
    apiVersion: '1.2.0',
    publisher: 'kun-smoke',
    name: 'packaged',
    version: '1.0.0',
    displayName: 'Packaged Extension Smoke',
    description: 'Release-only deterministic packaged Extension Platform smoke fixture.',
    license: 'MIT',
    engines: { kun: '>=0.1.0' },
    main: 'dist/extension.js',
    browser: 'dist/webview/index.html',
    activationEvents: ['onTool:echo', 'onProvider:echo', 'onView:smoke'],
    contributes: {
      'views.rightSidebar': [{
        id: 'smoke',
        title: 'Packaged smoke',
        entry: 'dist/webview/index.html',
        localResourceRoots: ['dist/webview']
      }],
      tools: [{
        id: 'echo',
        description: 'Echo one bounded value through the packaged Extension Host.',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string', minLength: 1, maxLength: 256 } },
          required: ['text'],
          additionalProperties: false
        },
        outputSchema: {
          type: 'object',
          properties: { echo: { type: 'string' } },
          required: ['echo'],
          additionalProperties: false
        },
        sideEffects: 'none',
        idempotent: true
      }],
      modelProviders: [{
        id: 'echo',
        displayName: 'Packaged Echo Provider',
        credentialHosts: [],
        adapterApiVersion: '1.0.0',
        models: [{
          id: 'echo-1',
          displayName: 'Packaged Echo 1',
          capabilities: {
            input: ['text'],
            output: ['text'],
            reasoning: false,
            tools: true,
            parallelTools: false,
            streaming: true,
            maxContextTokens: 8192,
            maxOutputTokens: 1024
          }
        }]
      }]
    },
    permissions: [
      'ui.views',
      'webview',
      'tools.register',
      'providers.register',
      'agent.run',
      'agent.threads.readOwn',
      'workspace.read',
      'media.read',
      'accounts.read',
      'accounts.manage:echo',
      'accounts.use:echo'
    ],
    stateSchemaVersion: 1
  }, null, 2)}\n`)
  await writeFile(join(root, 'LICENSE'), 'MIT\n')
  await writeFile(join(root, 'README.md'), '# Packaged Extension smoke fixture\n')
  await writeFile(join(root, 'dist', 'webview', 'index.html'), [
    '<!doctype html>',
    `<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${webviewCsp}"></head>`,
    '<body><main data-kun-packaged-webview-smoke="ready">Packaged Webview smoke</main></body></html>',
    ''
  ].join('\n'))
  await writeFile(join(root, 'dist', 'extension.js'), `
const provider = {
  id: 'echo',
  displayName: 'Packaged Echo Provider',
  credentialHosts: [],
  adapterApiVersion: '1.0.0',
  models: [{
    id: 'echo-1',
    displayName: 'Packaged Echo 1',
    capabilities: {
      input: ['text'], output: ['text'], reasoning: false, tools: true,
      parallelTools: false, streaming: true, maxContextTokens: 8192, maxOutputTokens: 1024
    }
  }]
}

export async function activate(context) {
  context.subscriptions.add(await context.tools.registerTool({
    id: 'echo',
    description: 'Echo one bounded value through the packaged Extension Host.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', minLength: 1, maxLength: 256 } },
      required: ['text'],
      additionalProperties: false
    },
    outputSchema: {
      type: 'object', properties: { echo: { type: 'string' } },
      required: ['echo'], additionalProperties: false
    },
    sideEffects: 'none',
    idempotent: true
  }, async (input) => ({ content: { echo: input.text } })))

  context.subscriptions.add(await context.modelProviders.registerProvider(provider, {
    async probe() { return { ok: true, latencyMs: 0, message: 'packaged-provider-ok' } },
    async listModels() { return provider.models },
    async *stream(request) {
      const smokeTool = request.tools.find((tool) =>
        tool.description.includes('Echo one bounded value through the packaged Extension Host.')
      )
      const hasToolResult = request.messages.some((message) => message.role === 'tool')
      if (smokeTool && !hasToolResult) {
        yield {
          requestId: request.requestId,
          sequence: 0,
          type: 'toolCallComplete',
          callId: 'packaged_agent_tool_call',
          name: smokeTool.name,
          input: { text: 'packaged-agent-tool-ok' }
        }
        yield {
          requestId: request.requestId,
          sequence: 1,
          type: 'completed',
          finishReason: 'tool_calls',
          usage: { inputTokens: 1, outputTokens: 1 }
        }
        return
      }
      yield { requestId: request.requestId, sequence: 0, type: 'textDelta', delta: 'packaged-provider-ok' }
      yield {
        requestId: request.requestId,
        sequence: 1,
        type: 'completed',
        finishReason: 'stop',
        usage: { inputTokens: 1, outputTokens: 1 }
      }
    },
    cancel() {}
  }))
}

export async function deactivate() {}
`.trimStart())
}

async function installSmokeExtensionFixture({
  temporaryRoot,
  profile,
  runCli,
  webviewConnectUrls = []
}) {
  if (typeof runCli !== 'function') throw new TypeError('runCli must be a function')
  const source = join(temporaryRoot, 'source')
  const archive = join(temporaryRoot, 'packaged-smoke.kunx')
  await createSmokeExtension(source, { webviewConnectUrls })

  runCli(['extension', 'validate', source, '--json'])
  runCli([
    'extension', 'pack', source,
    '--output', archive,
    '--include', 'dist',
    '--overwrite',
    '--json'
  ])
  runCli([
    'extension', 'install', archive,
    '--data-dir', profile,
    '--accept-permissions',
    '--json'
  ])

  const installedRoot = join(profile, 'extensions', EXTENSION_ID, '1.0.0')
  assertExists(join(installedRoot, 'kun-extension.json'), 'installed Manifest')
  assertExists(join(installedRoot, 'dist', 'webview', 'index.html'), 'installed Webview resource')
  return { source, archive, installedRoot }
}

function smokeWebviewCsp(webviewConnectUrls = []) {
  if (!Array.isArray(webviewConnectUrls)) {
    throw new TypeError('webviewConnectUrls must be an array')
  }
  const connectSources = [...new Set(webviewConnectUrls.map((value) => {
    let url
    try {
      url = new URL(value)
    } catch {
      throw new TypeError(`Invalid desktop smoke Webview connect URL: ${String(value)}`)
    }
    if (
      url.protocol !== 'http:' ||
      url.hostname !== '127.0.0.1' ||
      !url.port ||
      url.username ||
      url.password
    ) {
      throw new TypeError(`Desktop smoke Webview connect URL must be an explicit loopback origin: ${value}`)
    }
    return url.origin
  }))]
  return [
    "default-src 'none'",
    "style-src 'self'",
    "img-src 'self' data: kun-media:",
    "media-src 'self' kun-media:",
    `connect-src ${connectSources.length > 0 ? connectSources.join(' ') : "'none'"}`
  ].join('; ')
}

async function smokeWorkbenchAndWebview(port, workspace) {
  const workbench = await runtimeJson(
    port,
    `/v1/extensions/workbench?workspace_root=${encodeURIComponent(workspace)}`
  )
  const installed = workbench.extensions?.find((extension) => extension.id === EXTENSION_ID)
  if (!installed?.contributes?.['views.rightSidebar']?.some((view) => view.id === 'smoke')) {
    throw new Error('Packaged workbench snapshot does not expose the smoke Webview')
  }
  const created = await runtimeJson(port, '/v1/extensions/view-sessions', {
    method: 'POST',
    body: JSON.stringify({
      contributionId: `extension:${EXTENSION_ID}/smoke`,
      workspaceRoot: workspace
    })
  })
  if (typeof created.sessionId !== 'string' || typeof created.nonce !== 'string') {
    throw new Error('Packaged runtime did not create a bound Webview session')
  }
  await runtimeJson(port, `/v1/extensions/view-sessions/${encodeURIComponent(created.sessionId)}`, {
    method: 'DELETE'
  })
}

async function activateSmokeExtension(runtime, workspace) {
  const platform = runtime.extensionPlatform
  const entry = await platform.registry.get(EXTENSION_ID)
  const active = entry?.useDevelopment
    ? entry.development
    : entry?.selectedVersion
      ? entry.versions[entry.selectedVersion]
      : undefined
  if (!active) throw new Error('Packaged smoke extension has no selected registry version')
  const canonicalWorkspace = realpathSync(workspace)
  const workspaceKey = platform.paths.workspaceKey(canonicalWorkspace)
  await platform.registry.setWorkspaceEnabled(EXTENSION_ID, workspaceKey, true)
  await platform.registry.setWorkspacePermissionGrant(
    EXTENSION_ID,
    workspaceKey,
    [...active.grantedPermissions],
    active.manifest.version
  )
  const host = await platform.manager.activate(EXTENSION_ID, 'onTool:echo', {
    workspaceRoot: canonicalWorkspace,
    workspaceContext: {
      id: workspaceKey,
      name: basename(canonicalWorkspace) || 'Packaged smoke workspace',
      root: canonicalWorkspace,
      trusted: true,
      active: true
    }
  })
  if (!host) throw new Error('Packaged extension Node Host did not activate')
  return { host, workspace: canonicalWorkspace }
}

async function smokeHeadlessTool(runtime, workspace) {
  const registration = runtime.extensionPlatform.tools.list(EXTENSION_ID)[0]
  if (!registration) throw new Error('Packaged extension tool did not register')
  const result = await runtime.toolHost.execute({
    callId: 'packaged_smoke_tool_call',
    toolName: registration.modelAlias,
    providerId: `extension:${EXTENSION_ID}`,
    arguments: { text: 'packaged-tool-ok' }
  }, {
    threadId: 'packaged_smoke_thread',
    turnId: 'packaged_smoke_turn',
    workspace,
    approvalPolicy: 'auto',
    sandboxMode: 'danger-full-access',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow'
  })
  if (
    result.item.isError ||
    result.item.output?.content?.echo !== 'packaged-tool-ok'
  ) {
    throw new Error(`Packaged headless tool returned an invalid result: ${JSON.stringify(result.item.output)}`)
  }
  return registration
}

async function smokeCustomProvider(runtime, host, makeUserItem) {
  const provider = (await runtime.extensionPlatform.providerAccounts.listProviders())
    .find((candidate) => candidate.ownerExtensionId === EXTENSION_ID)
  if (!provider) throw new Error('Packaged custom Provider definition did not register')
  const principal = {
    extensionId: EXTENSION_ID,
    extensionVersion: host.principal.version,
    permissions: [
      'providers.register',
      'accounts.read',
      `accounts.manage:${provider.id}`,
      `accounts.use:${provider.id}`
    ],
    workspaceRoots: [],
    workspaceTrusted: true
  }
  const account = await runtime.extensionPlatform.accounts.createApiKeyAccount({
    principal,
    providerId: provider.id,
    label: 'Packaged smoke account',
    apiKey: 'packaged-smoke-secret-never-serialized',
    protectedInput: true
  })
  const client = runtime.extensionPlatform.modelProviders.clientMap().get(provider.id)
  if (!client) throw new Error('Packaged custom Provider client is unavailable')
  const chunks = []
  for await (const chunk of client.stream({
    threadId: 'packaged_smoke_thread',
    turnId: 'packaged_smoke_turn',
    model: 'echo-1',
    providerId: provider.id,
    accountId: account.id,
    systemPrompt: 'Packaged smoke stable prefix',
    contextInstructions: [],
    prefix: [],
    history: [makeUserItem({
      id: 'packaged_smoke_user',
      threadId: 'packaged_smoke_thread',
      turnId: 'packaged_smoke_turn',
      text: 'Use the packaged custom Provider.'
    })],
    attachments: [],
    tools: [],
    abortSignal: new AbortController().signal
  })) chunks.push(chunk)
  if (!chunks.some((chunk) => chunk.kind === 'assistant_text_delta' && chunk.text === 'packaged-provider-ok')) {
    throw new Error(`Packaged custom Provider stream is invalid: ${JSON.stringify(chunks)}`)
  }
  const accountProjection = JSON.stringify(account)
  if (accountProjection.includes('packaged-smoke-secret') || accountProjection.includes('credentialRef')) {
    throw new Error('Packaged account projection exposed credential material')
  }
  return { provider, account, principal }
}

async function smokeAgentTool(runtime, workspace, tool, providerContext) {
  const principal = {
    ...providerContext.principal,
    permissions: [
      ...providerContext.principal.permissions,
      'agent.run',
      'agent.threads.readOwn'
    ],
    workspaceRoots: [workspace]
  }
  const run = await runtime.extensionPlatform.agent.createRun(principal, {
    input: 'Call the packaged smoke extension tool, then finish.',
    workspace,
    providerBinding: {
      providerId: providerContext.provider.id,
      accountId: providerContext.account.id,
      modelId: 'echo-1'
    },
    allowedTools: [tool.canonicalToolId],
    budget: {
      maxElapsedMs: 20_000,
      maxModelRequests: 4,
      maxToolInvocations: 2
    }
  })
  const deadline = Date.now() + 20_000
  let current = run
  while (current.status === 'running' && Date.now() < deadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))
    current = await runtime.extensionPlatform.agent.getRun(principal, run.id)
  }
  if (current.status !== 'completed') {
    throw new Error(
      `Packaged Agent/tool run did not complete (${current.status}): ${current.error ?? 'no error detail'}`
    )
  }
  const thread = await runtime.threadService.get(run.threadId)
  const turn = thread?.turns.find((candidate) => candidate.id === run.id)
  const toolResult = turn?.items.find((item) =>
    item.kind === 'tool_result' && item.toolName === tool.modelAlias
  )
  if (
    !toolResult ||
    toolResult.isError ||
    toolResult.output?.content?.echo !== 'packaged-agent-tool-ok'
  ) {
    throw new Error(`Packaged Agent did not execute the extension tool: ${JSON.stringify(toolResult)}`)
  }
  const finalText = turn?.items.find((item) =>
    item.kind === 'assistant_text' && item.text.includes('packaged-provider-ok')
  )
  if (!finalText) {
    throw new Error('Packaged Agent did not complete the second Provider round after the tool result')
  }
}

async function runtimeJson(port, path, init = {}) {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${RUNTIME_TOKEN}`)
  if (init.body !== undefined) headers.set('content-type', 'application/json')
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { ...init, headers })
  const body = await response.text()
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} failed (${response.status}): ${body}`)
  return body ? JSON.parse(body) : undefined
}

function runKun(entry, args) {
  return execFileSync(process.execPath, [entry, ...args], {
    cwd: dirname(entry),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 8 * 1024 * 1024
  })
}

function importFresh(path) {
  return import(`${pathToFileURL(path).href}?smoke=${Date.now()}-${Math.random()}`)
}

async function availablePort() {
  const server = createServer()
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()))
  if (!port) throw new Error('Could not allocate a packaged smoke port')
  return port
}

function argumentValue(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

function assertExists(path, label) {
  if (!existsSync(path)) throw new Error(`Missing packaged ${label}: ${path}`)
}

module.exports = {
  EXTENSION_ID,
  PACKAGED_EXTENSION_SMOKE_SUCCESS_MARKER,
  assertPackagedSmokeChildResult,
  createPackagedExtensionSmokeReexecEnvironment,
  createSmokeExtension,
  installSmokeExtensionFixture,
  makeTreeWritable,
  packagedResourceCandidates,
  resolvePackagedRuntimeExecutable,
  resolveResources,
  resolvedPackagedResourceCandidates,
  smokeWebviewCsp,
  validatePackagedResources
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
