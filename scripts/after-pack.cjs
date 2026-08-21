const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const {
  chmodSync,
  closeSync,
  cpSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} = require('node:fs')
const { join } = require('node:path')
const {
  LINUX_SANDBOX_LAUNCHER_FLAG,
  assertElfExecutable,
  installCliLaunchers,
  installLinuxElectronLauncher,
  linuxElectronLauncherContent,
  linuxRealExecutableName,
  windowsCliLauncherContent
} = require('./after-pack-launchers.cjs')

const KUN_RUNTIME_REQUIRED_PATHS = [
  'kun/dist/cli/serve-entry.js',
  'kun/dist/cli/extension-cli.js',
  'kun/dist/extensions/host-runner.js',
  'kun/dist/server/graph-runtime-factory.js',
  'kun/dist/graph/graph-scheduler.js',
  'kun/dist/adapters/tool/graph-mode-tool-provider.js',
  'kun/dist/tui/graph-mode.js',
  'kun/package.json',
  'kun/package-lock.json',
  'kun/node_modules/zod/package.json',
  'kun/node_modules/diff/package.json',
  'kun/node_modules/semver/package.json',
  'kun/node_modules/yauzl/package.json',
  'kun/node_modules/yazl/package.json',
  'kun/node_modules/typescript/package.json',
  'kun/node_modules/typescript/lib/typescript.js',
  'kun/node_modules/typescript-language-server/package.json',
  'kun/node_modules/typescript-language-server/lib/cli.mjs',
  'kun/node_modules/@cursor/sdk/package.json',
  'kun/node_modules/@anthropic-ai/claude-agent-sdk/package.json',
  'kun/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs',
  'kun/node_modules/@earendil-works/pi-tui/package.json',
  'kun/node_modules/marked/package.json',
  'kun/node_modules/get-east-asian-width/package.json',
  'kun/node_modules/@modelcontextprotocol/sdk/package.json',
  'kun/node_modules/@kun/extension-api/package.json',
  'kun/node_modules/@kun/extension-api/dist/index.js',
  'kun/node_modules/@kun/provider-catalog/package.json',
  'kun/node_modules/@kun/provider-catalog/dist/index.js',
  'kun/node_modules/create-kun-extension/package.json',
  'kun/node_modules/create-kun-extension/src/cli.mjs',
  'node_modules/better-sqlite3/package.json',
  'node_modules/bindings/package.json',
  'node_modules/file-uri-to-path/package.json',
  'packages/extension-api/dist/index.js',
  'packages/extension-api/schema/kun-extension.schema.json',
  'packages/extension-api/fixtures/api-major-negotiation.json',
  'packages/extension-api/fixtures/api-minor-negotiation.json',
  'packages/provider-catalog/package.json',
  'packages/provider-catalog/dist/index.js',
  'packages/create-kun-extension/src/cli.mjs',
  'packages/create-kun-extension/src/scaffold.mjs',
  'packages/create-kun-extension/templates/node/kun-extension.json',
  'packages/create-kun-extension/templates/node/src/extension.ts',
  'packages/create-kun-extension/templates/react/kun-extension.json',
  'packages/create-kun-extension/templates/react/src/host/extension.ts',
  'packages/create-kun-extension/templates/react/src/webview/main.tsx',
  'packages/create-kun-extension/templates/webview/kun-extension.json',
  'packages/create-kun-extension/templates/webview/src/webview/main.ts'
]
const MINIMUM_TUI_NODE_VERSION = '22.19.0'
const BUNDLED_EXTENSIONS_DIR = 'bundled-extensions'
const BUNDLED_EXTENSION_CATALOG_FILE = 'catalog.json'
const OFFICECLI_DIR = 'officecli'
const TESSERACT_NODE_LSTM_ALIASES = new Map([
  ['tesseract-core.js', './tesseract-core-lstm'],
  ['tesseract-core-simd.js', './tesseract-core-simd-lstm'],
  ['tesseract-core-relaxedsimd.js', './tesseract-core-relaxedsimd-lstm']
])
const TESSERACT_LSTM_CORE_FILES = new Set([
  'LICENSE',
  'package.json',
  ...TESSERACT_NODE_LSTM_ALIASES.keys(),
  'tesseract-core-lstm.js',
  'tesseract-core-lstm.wasm',
  'tesseract-core-simd-lstm.js',
  'tesseract-core-simd-lstm.wasm',
  'tesseract-core-relaxedsimd-lstm.js',
  'tesseract-core-relaxedsimd-lstm.wasm'
])
const BETTER_SQLITE_BUILD_PATHS = [
  'binding.gyp',
  'deps',
  'src',
  'build/Makefile',
  'build/binding.Makefile',
  'build/better_sqlite3.target.mk',
  'build/config.gypi',
  'build/deps',
  'build/test_extension.target.mk',
  'build/Release/.deps',
  'build/Release/obj',
  'build/Release/obj.target',
  'build/Release/test_extension.node'
]
const KUN_ROOT_HOISTED_DEPENDENCY_PATHS = [
  '@computer-use',
  '@napi-rs',
  'quickjs-wasi'
]
const KUN_ROOT_HOISTED_VERSION_ANCHORS = [
  '@computer-use/nut-js',
  '@napi-rs/canvas',
  'quickjs-wasi'
]
const REQUIRED_BUNDLED_EXTENSION_IDS = [
  'kun-examples.social-media-sidebar'
]
const REQUIRED_RETIRED_BUNDLED_EXTENSION_IDS = [
  'kun-examples.kun-video-editor',
  'kun-examples.presentation-studio'
]

function normalizePlatform(platform) {
  return platform === 'win' ? 'win32' : platform
}

function appBundlePath(context) {
  return join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
}

function packedResourcesDir(context) {
  if (normalizePlatform(context.electronPlatformName) === 'darwin') {
    return join(appBundlePath(context), 'Contents', 'Resources')
  }
  return join(context.appOutDir, 'resources')
}

function unpackedAppRoot(context) {
  return join(packedResourcesDir(context), 'app.asar.unpacked')
}

function assertExists(path, label) {
  if (!existsSync(path)) {
    throw new Error(`[after-pack] Missing ${label}: ${path}`)
  }
}

function npmCommand(args, platform = process.platform) {
  if (platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm', ...args]
    }
  }
  return { command: 'npm', args }
}

function packedKunPruneArgs(context) {
  // The pack host may differ from the target architecture. npm 11 otherwise
  // prunes Cursor's target-specific optional SDK package based on the host,
  // leaving a package that cannot start its bundled runtime.
  return [
    'prune',
    '--omit=dev',
    '--ignore-scripts',
    '--force',
    `--os=${normalizePlatform(context.electronPlatformName)}`,
    `--cpu=${normalizeArch(context.arch)}`
  ]
}

function prunePackedKunDependencies(context) {
  const root = unpackedAppRoot(context)
  const kunDir = join(root, 'kun')
  if (!existsSync(kunDir)) return

  assertExists(join(kunDir, 'package.json'), 'Kun package manifest')
  assertExists(join(kunDir, 'node_modules'), 'Kun node_modules')

  const prune = npmCommand(packedKunPruneArgs(context))
  execFileSync(prune.command, prune.args, {
    cwd: kunDir,
    env: {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_fund: 'false'
    },
    stdio: 'inherit'
  })

  // Keep native SQLite on the app root dependency so electron-builder's
  // native-module rebuild owns the target arch and Electron ABI.
  assertExists(
    join(root, 'node_modules', 'better-sqlite3', 'package.json'),
    'root better-sqlite3 dependency'
  )
  rmSync(join(kunDir, 'node_modules', 'better-sqlite3'), { recursive: true, force: true })
}

function materializePackedWorkspaceDependencies(context) {
  const root = unpackedAppRoot(context)
  for (const [sourceRelative, targetRelative] of [
    ['packages/extension-api', 'kun/node_modules/@kun/extension-api'],
    ['packages/provider-catalog', 'kun/node_modules/@kun/provider-catalog'],
    ['packages/create-kun-extension', 'kun/node_modules/create-kun-extension']
  ]) {
    const source = join(root, sourceRelative)
    const target = join(root, targetRelative)
    assertExists(source, `workspace package source ${sourceRelative}`)
    rmSync(target, { recursive: true, force: true })
    cpSync(source, target, { recursive: true, force: true })
    const details = lstatSync(target)
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw new Error(`[after-pack] Workspace dependency was not materialized: ${targetRelative}`)
    }
  }
}

function claudeAgentSdkPlatformPackage(context) {
  return `@anthropic-ai/claude-agent-sdk-${normalizePlatform(context.electronPlatformName)}-${normalizeArch(context.arch)}`
}

function prunePackedClaudeCodeBinary(context) {
  const root = unpackedAppRoot(context)
  const packageName = claudeAgentSdkPlatformPackage(context)
  const packagePath = join(root, 'kun', 'node_modules', ...packageName.split('/'))
  if (!existsSync(packagePath)) return
  rmSync(packagePath, { recursive: true, force: true })
  console.log(`[after-pack] Removed on-demand Claude Code binary package: ${packageName}`)
}

function prunePackedBetterSqliteBuildFiles(context) {
  const packageRoot = join(unpackedAppRoot(context), 'node_modules', 'better-sqlite3')
  if (!existsSync(packageRoot)) return
  for (const relativePath of BETTER_SQLITE_BUILD_PATHS) {
    rmSync(join(packageRoot, relativePath), { recursive: true, force: true })
  }
  console.log('[after-pack] Removed better-sqlite3 build sources and intermediates.')
}

function prunePackedTesseractResources(context) {
  const modules = join(unpackedAppRoot(context), 'node_modules')
  const coreRoot = join(modules, 'tesseract.js-core')
  if (existsSync(coreRoot)) {
    for (const entry of readdirSync(coreRoot)) {
      if (TESSERACT_LSTM_CORE_FILES.has(entry)) continue
      rmSync(join(coreRoot, entry), { recursive: true, force: true })
    }
    // Tesseract.js 7's Node loader asks for the legacy-named JS entry points even
    // when createWorker selected its LSTM-only core. Keep those tiny entry points
    // as aliases while omitting every non-LSTM WASM payload.
    for (const [entry, target] of TESSERACT_NODE_LSTM_ALIASES) {
      writeFileSync(
        join(coreRoot, entry),
        `'use strict'\nmodule.exports = require('${target}')\n`
      )
    }
  }
  rmSync(
    join(modules, '@tesseract.js-data', 'eng', '4.0.0_best_int'),
    { recursive: true, force: true }
  )
  console.log('[after-pack] Kept only Node LSTM Tesseract cores and the configured English model.')
}

function prunePackedHoistedKunDependencies(context) {
  const root = unpackedAppRoot(context)
  const modules = join(root, 'node_modules')
  const kunModules = join(root, 'kun', 'node_modules')
  for (const packageName of KUN_ROOT_HOISTED_VERSION_ANCHORS) {
    const relativeManifest = join(...packageName.split('/'), 'package.json')
    const rootManifest = join(modules, relativeManifest)
    const duplicateManifest = join(kunModules, relativeManifest)
    assertExists(rootManifest, `root-hoisted package manifest ${packageName}`)
    assertExists(duplicateManifest, `duplicate Kun package manifest ${packageName}`)
    const rootVersion = JSON.parse(readFileSync(rootManifest, 'utf8')).version
    const duplicateVersion = JSON.parse(readFileSync(duplicateManifest, 'utf8')).version
    if (!rootVersion || rootVersion !== duplicateVersion) {
      throw new Error(
        `[after-pack] Cannot hoist ${packageName}: root=${rootVersion}, Kun=${duplicateVersion}`
      )
    }
  }
  for (const relativePath of KUN_ROOT_HOISTED_DEPENDENCY_PATHS) {
    const rootDependency = join(modules, relativePath)
    const duplicate = join(kunModules, relativePath)
    assertExists(rootDependency, `root-hoisted runtime dependency ${relativePath}`)
    if (!existsSync(duplicate)) continue
    rmSync(duplicate, { recursive: true, force: true })
    console.log(`[after-pack] Removed root-hoisted Kun dependency duplicate: ${relativePath}`)
  }
}

function prunePackedApplicationPayload(context) {
  prunePackedClaudeCodeBinary(context)
  prunePackedBetterSqliteBuildFiles(context)
  prunePackedTesseractResources(context)
  prunePackedHoistedKunDependencies(context)
}

function assertMissing(path, label) {
  if (existsSync(path)) {
    throw new Error(`[after-pack] Unexpected packaged ${label}: ${path}`)
  }
}

function validatePackedApplicationPayload(context) {
  const root = unpackedAppRoot(context)
  const modules = join(root, 'node_modules')
  const kunModules = join(root, 'kun', 'node_modules')
  const claudePlatformPackage = claudeAgentSdkPlatformPackage(context)

  assertExists(
    join(kunModules, '@anthropic-ai', 'claude-agent-sdk', 'sdk.mjs'),
    'Claude Agent SDK JavaScript'
  )
  assertMissing(
    join(kunModules, ...claudePlatformPackage.split('/')),
    `on-demand Claude Code binary package ${claudePlatformPackage}`
  )

  const sqliteRoot = join(modules, 'better-sqlite3')
  assertExists(
    join(sqliteRoot, 'build', 'Release', 'better_sqlite3.node'),
    'better-sqlite3 native binding'
  )
  assertExists(join(sqliteRoot, 'lib', 'index.js'), 'better-sqlite3 runtime JavaScript')
  for (const relativePath of BETTER_SQLITE_BUILD_PATHS) {
    assertMissing(join(sqliteRoot, relativePath), `better-sqlite3 build path ${relativePath}`)
  }

  const coreRoot = join(modules, 'tesseract.js-core')
  for (const entry of TESSERACT_LSTM_CORE_FILES) {
    assertExists(join(coreRoot, entry), `Tesseract runtime file ${entry}`)
  }
  for (const [entry, target] of TESSERACT_NODE_LSTM_ALIASES) {
    const contents = readFileSync(join(coreRoot, entry), 'utf8')
    if (!contents.includes(`require('${target}')`)) {
      throw new Error(
        `[after-pack] Tesseract Node entry ${entry} does not select ${target}`
      )
    }
  }
  const unexpectedCoreFiles = readdirSync(coreRoot)
    .filter((entry) => !TESSERACT_LSTM_CORE_FILES.has(entry))
  if (unexpectedCoreFiles.length > 0) {
    throw new Error(
      `[after-pack] Unexpected packaged Tesseract core files: ${unexpectedCoreFiles.join(', ')}`
    )
  }
  assertExists(
    join(modules, '@tesseract.js-data', 'eng', '4.0.0', 'eng.traineddata.gz'),
    'configured Tesseract English model'
  )
  assertMissing(
    join(modules, '@tesseract.js-data', 'eng', '4.0.0_best_int'),
    'unused Tesseract 4.0.0_best_int model'
  )
  for (const relativePath of KUN_ROOT_HOISTED_DEPENDENCY_PATHS) {
    assertExists(join(modules, relativePath), `root-hoisted runtime dependency ${relativePath}`)
    assertMissing(join(kunModules, relativePath), `duplicate Kun dependency ${relativePath}`)
  }
}

function validateBundledKunRuntime(context) {
  const root = unpackedAppRoot(context)
  for (const relativePath of KUN_RUNTIME_REQUIRED_PATHS) {
    assertExists(join(root, relativePath), relativePath)
  }
  const cursorPlatformPackage =
    `kun/node_modules/@cursor/sdk-${normalizePlatform(context.electronPlatformName)}-${normalizeArch(context.arch)}`
  assertExists(
    join(root, cursorPlatformPackage, 'package.json'),
    `${cursorPlatformPackage}/package.json`
  )
  assertExists(
    join(root, 'node_modules', 'better-sqlite3', 'package.json'),
    'root better-sqlite3 dependency'
  )
}

function validateBundledExtensionResources(context) {
  const root = join(packedResourcesDir(context), BUNDLED_EXTENSIONS_DIR)
  const catalogPath = join(root, BUNDLED_EXTENSION_CATALOG_FILE)
  assertRegularNonSymlink(catalogPath, 'bundled extension catalog')
  let catalog
  try {
    catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
  } catch (error) {
    throw new Error(`[after-pack] Invalid bundled extension catalog: ${error.message}`)
  }
  if (
    catalog?.schemaVersion !== 1 ||
    !Array.isArray(catalog.extensions) ||
    !Array.isArray(catalog.retiredExtensions)
  ) {
    throw new Error('[after-pack] Invalid bundled extension catalog shape')
  }
  const ids = new Set()
  const catalogArchives = new Set()
  for (const entry of catalog.extensions) {
    if (
      typeof entry?.id !== 'string' ||
      typeof entry?.version !== 'string' ||
      typeof entry?.archive !== 'string' ||
      !/^[0-9A-Za-z][0-9A-Za-z._-]*\.kunx$/u.test(entry.archive) ||
      typeof entry?.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(entry.sha256)
    ) {
      throw new Error('[after-pack] Invalid bundled extension catalog entry')
    }
    if (ids.has(entry.id)) {
      throw new Error(`[after-pack] Duplicate bundled extension id: ${entry.id}`)
    }
    ids.add(entry.id)
    catalogArchives.add(entry.archive)
    const archivePath = join(root, entry.archive)
    assertRegularNonSymlink(archivePath, `bundled extension archive ${entry.id}`)
    const digest = createHash('sha256').update(readFileSync(archivePath)).digest('hex')
    if (digest !== entry.sha256) {
      throw new Error(`[after-pack] Bundled extension digest mismatch: ${entry.id}`)
    }
  }
  for (const id of REQUIRED_BUNDLED_EXTENSION_IDS) {
    if (!ids.has(id)) throw new Error(`[after-pack] Missing required bundled extension: ${id}`)
  }
  if (ids.size !== REQUIRED_BUNDLED_EXTENSION_IDS.length) {
    const unexpected = [...ids].filter((id) => !REQUIRED_BUNDLED_EXTENSION_IDS.includes(id))
    throw new Error(`[after-pack] Unexpected bundled extension: ${unexpected.join(', ')}`)
  }
  const retiredIds = new Set(catalog.retiredExtensions)
  if (
    retiredIds.size !== catalog.retiredExtensions.length ||
    catalog.retiredExtensions.some((id) => typeof id !== 'string' || ids.has(id))
  ) {
    throw new Error('[after-pack] Invalid retired bundled extension ids')
  }
  for (const id of REQUIRED_RETIRED_BUNDLED_EXTENSION_IDS) {
    if (!retiredIds.has(id)) {
      throw new Error(`[after-pack] Missing retired bundled extension marker: ${id}`)
    }
  }
  if (retiredIds.size !== REQUIRED_RETIRED_BUNDLED_EXTENSION_IDS.length) {
    const unexpected = [...retiredIds].filter(
      (id) => !REQUIRED_RETIRED_BUNDLED_EXTENSION_IDS.includes(id)
    )
    throw new Error(`[after-pack] Unexpected retired bundled extension: ${unexpected.join(', ')}`)
  }
  for (const archive of readdirSync(root).filter((entry) => entry.endsWith('.kunx'))) {
    if (!catalogArchives.has(archive)) {
      throw new Error(`[after-pack] Unexpected bundled extension archive: ${archive}`)
    }
  }
}

function validateBundledOfficeCli(context) {
  const platform = normalizePlatform(context.electronPlatformName)
  const arch = normalizeArch(context.arch)
  const root = join(packedResourcesDir(context), OFFICECLI_DIR)
  const manifestPath = join(root, 'manifest.json')
  const selectedPath = join(root, 'selected.json')
  assertRegularNonSymlink(manifestPath, 'OfficeCLI manifest')
  assertRegularNonSymlink(selectedPath, 'OfficeCLI selected target manifest')

  let manifest
  let selected
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    selected = JSON.parse(readFileSync(selectedPath, 'utf8'))
  } catch (error) {
    throw new Error(`[after-pack] Invalid OfficeCLI manifest: ${error.message}`)
  }
  const targetKey = `${platform}-${arch}`
  const expected = manifest?.assets?.[targetKey]
  if (
    manifest?.schemaVersion !== 1 ||
    manifest?.version !== '1.0.141' ||
    !expected ||
    selected?.schemaVersion !== 1 ||
    selected?.version !== manifest.version ||
    selected?.schemaCrc !== manifest.schemaCrc ||
    selected?.platform !== platform ||
    selected?.arch !== arch ||
    selected?.sha256 !== expected.sha256 ||
    selected?.size !== expected.size
  ) {
    throw new Error(`[after-pack] OfficeCLI target manifest does not match ${targetKey}`)
  }

  const executableName = platform === 'win32' ? 'officecli.exe' : 'officecli'
  const executablePath = join(root, executableName)
  assertRegularNonSymlink(executablePath, `OfficeCLI ${targetKey} executable`)
  const details = lstatSync(executablePath)
  if (details.size !== expected.size) {
    throw new Error(`[after-pack] OfficeCLI size mismatch for ${targetKey}`)
  }
  const digest = createHash('sha256').update(readFileSync(executablePath)).digest('hex')
  if (digest !== expected.sha256) {
    throw new Error(`[after-pack] OfficeCLI digest mismatch for ${targetKey}`)
  }
  if (platform !== 'win32' && process.platform !== 'win32') {
    chmodSync(executablePath, 0o755)
    if ((lstatSync(executablePath).mode & 0o111) === 0) {
      throw new Error(`[after-pack] OfficeCLI is not executable for ${targetKey}`)
    }
  }

  for (const legalFile of ['LICENSE', 'NOTICE', 'THIRD-PARTY-NOTICES.txt']) {
    assertRegularNonSymlink(join(root, 'legal', legalFile), `OfficeCLI ${legalFile}`)
  }
  const binaryEntries = readdirSync(root).filter((entry) =>
    entry === 'officecli' || entry === 'officecli.exe'
  )
  if (binaryEntries.length !== 1 || binaryEntries[0] !== executableName) {
    throw new Error(`[after-pack] Expected exactly one ${targetKey} OfficeCLI executable`)
  }
}

async function maybeSignBundledOfficeCli(context) {
  const platform = normalizePlatform(context.electronPlatformName)
  if (platform !== 'win32') return false
  const signIf = context.packager?.signIf
  if (typeof signIf !== 'function') {
    throw new Error('[after-pack] Windows packager cannot sign the bundled OfficeCLI executable')
  }
  const executablePath = join(packedResourcesDir(context), OFFICECLI_DIR, 'officecli.exe')
  const signed = await signIf.call(context.packager, executablePath)
  console.log(
    signed
      ? '[after-pack] Signed bundled OfficeCLI executable.'
      : '[after-pack] OfficeCLI signing was skipped because Windows signing is not configured.'
  )
  return signed
}

function assertRegularNonSymlink(path, label) {
  assertExists(path, label)
  const details = lstatSync(path)
  if (details.isSymbolicLink() || !details.isFile() || details.size <= 0) {
    throw new Error(`[after-pack] ${label} must be a non-empty non-symlink file: ${path}`)
  }
}

function maybeAdhocSignMacApp(context) {
  if (normalizePlatform(context.electronPlatformName) !== 'darwin') {
    return
  }

  if (
    process.env.CSC_LINK ||
    process.env.CSC_NAME ||
    process.env.CSC_KEY_PASSWORD ||
    process.env.MAC_SIGN === '1'
  ) {
    console.log('[after-pack] Developer ID signing is enabled, skipping ad-hoc signing.')
    return
  }

  const appBundle = appBundlePath(context)
  if (!existsSync(appBundle)) {
    throw new Error(`[after-pack] App bundle not found for ad-hoc signing: ${appBundle}`)
  }

  execFileSync(
    'codesign',
    ['--force', '--deep', '--sign', '-', '--timestamp=none', appBundle],
    { stdio: 'inherit' }
  )
}

// node-pty execs a bundled `spawn-helper` binary to fork the child shell.
// asar unpacking can drop the executable bit, which makes every PTY spawn
// fail with `posix_spawnp`. Re-chmod every bundled helper after packing so
// the built-in terminal works in the shipped app. Non-fatal: best effort.
function ensureNodePtyHelpersExecutable(context) {
  const root = unpackedAppRoot(context)
  const prebuildsDir = join(root, 'node_modules', 'node-pty', 'prebuilds')
  if (!existsSync(prebuildsDir)) return
  for (const folder of readdirSync(prebuildsDir)) {
    const helper = join(prebuildsDir, folder, 'spawn-helper')
    if (!existsSync(helper)) continue
    try {
      chmodSync(helper, 0o755)
    } catch (error) {
      console.warn(`[after-pack] could not chmod node-pty spawn-helper (${folder}):`, error.message)
    }
  }
}

function normalizeArch(arch) {
  if (arch === 'x64' || arch === 1) return 'x64'
  if (arch === 'arm64' || arch === 3) return 'arm64'
  throw new Error(`[after-pack] Unsupported packaged resource arch: ${arch}`)
}

function prunePackedWhisperResources(context) {
  const whisperDir = join(packedResourcesDir(context), 'whisper')
  if (!existsSync(whisperDir)) return

  const keep = `${normalizePlatform(context.electronPlatformName)}-${normalizeArch(context.arch)}`
  for (const entry of readdirSync(whisperDir)) {
    if (entry === keep || entry === 'LICENSE.whisper.cpp') continue
    rmSync(join(whisperDir, entry), { recursive: true, force: true })
    console.log(`[after-pack] Removed non-target Whisper resource: ${entry}`)
  }
}

async function afterPack(context) {
  prunePackedKunDependencies(context)
  materializePackedWorkspaceDependencies(context)
  prunePackedApplicationPayload(context)
  validateBundledKunRuntime(context)
  validatePackedApplicationPayload(context)
  validateBundledExtensionResources(context)
  validateBundledOfficeCli(context)
  await maybeSignBundledOfficeCli(context)
  prunePackedWhisperResources(context)
  ensureNodePtyHelpersExecutable(context)
  installCliLaunchers(context)
  installLinuxElectronLauncher(context)
  maybeAdhocSignMacApp(context)
}

exports.KUN_RUNTIME_REQUIRED_PATHS = KUN_RUNTIME_REQUIRED_PATHS
exports.REQUIRED_BUNDLED_EXTENSION_IDS = REQUIRED_BUNDLED_EXTENSION_IDS
exports.REQUIRED_RETIRED_BUNDLED_EXTENSION_IDS = REQUIRED_RETIRED_BUNDLED_EXTENSION_IDS
exports.LINUX_SANDBOX_LAUNCHER_FLAG = LINUX_SANDBOX_LAUNCHER_FLAG
exports._internals = {
  appBundlePath,
  packedResourcesDir,
  unpackedAppRoot,
  npmCommand,
  packedKunPruneArgs,
  prunePackedKunDependencies,
  materializePackedWorkspaceDependencies,
  claudeAgentSdkPlatformPackage,
  prunePackedClaudeCodeBinary,
  prunePackedBetterSqliteBuildFiles,
  prunePackedTesseractResources,
  prunePackedHoistedKunDependencies,
  prunePackedApplicationPayload,
  validatePackedApplicationPayload,
  validateBundledKunRuntime,
  validateBundledExtensionResources,
  validateBundledOfficeCli,
  maybeSignBundledOfficeCli,
  normalizeArch,
  prunePackedWhisperResources,
  ensureNodePtyHelpersExecutable,
  assertElfExecutable,
  installLinuxElectronLauncher,
  installCliLaunchers,
  windowsCliLauncherContent,
  linuxElectronLauncherContent,
  linuxRealExecutableName,
  TESSERACT_NODE_LSTM_ALIASES,
  TESSERACT_LSTM_CORE_FILES,
  BETTER_SQLITE_BUILD_PATHS,
  KUN_ROOT_HOISTED_DEPENDENCY_PATHS,
  KUN_ROOT_HOISTED_VERSION_ANCHORS
}
exports.default = afterPack
