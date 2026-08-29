'use strict'

const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} = require('node:fs')
const { tmpdir } = require('node:os')
const { dirname, join } = require('node:path')
const test = require('node:test')
const {
  KUN_RUNTIME_REQUIRED_PATHS,
  LINUX_SANDBOX_LAUNCHER_FLAG,
  _internals: {
    installLinuxElectronLauncher,
    installCliLaunchers,
    windowsCliLauncherContent,
    linuxElectronLauncherContent,
    linuxRealExecutableName,
    packedKunPruneArgs,
    claudeAgentSdkPlatformPackage,
    prunePackedApplicationPayload,
    validatePackedApplicationPayload,
    TESSERACT_NODE_LSTM_ALIASES,
    TESSERACT_LSTM_CORE_FILES,
    BETTER_SQLITE_BUILD_PATHS,
    KUN_ROOT_HOISTED_DEPENDENCY_PATHS,
    KUN_ROOT_HOISTED_VERSION_ANCHORS,
    validatePackedKunBinLinks,
    validateRootHoistedDependencyClosure
  }
} = require('./after-pack.cjs')
const {
  assertNoPackedKunBinOwnerCollisions,
  KUN_ROOT_HOISTED_SHARED_JS_PACKAGES
} = require('./after-pack-hoisted-dependencies.cjs')

test('requires the shared provider catalog in the packaged Kun runtime', () => {
  assert.equal(
    KUN_RUNTIME_REQUIRED_PATHS.includes('kun/node_modules/@kun/provider-catalog/dist/index.js'),
    true
  )
  assert.equal(
    KUN_RUNTIME_REQUIRED_PATHS.includes('packages/provider-catalog/dist/index.js'),
    true
  )
})

test('requires the Graph execution plane in every packaged Kun runtime', () => {
  for (const relativePath of [
    'kun/dist/server/graph-runtime-factory.js',
    'kun/dist/graph/graph-scheduler.js',
    'kun/dist/adapters/tool/graph-mode-tool-provider.js',
    'kun/dist/tui/graph-mode.js'
  ]) {
    assert.equal(KUN_RUNTIME_REQUIRED_PATHS.includes(relativePath), true, relativePath)
  }
})

function fixture(t, executableName = 'kun-gui') {
  const appOutDir = mkdtempSync(join(tmpdir(), 'kun-linux-launcher-test-'))
  t.after(() => rmSync(appOutDir, { recursive: true, force: true }))
  const executable = join(appOutDir, executableName)
  writeFileSync(executable, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00]))
  chmodSync(executable, 0o700)
  return {
    appOutDir,
    executable,
    context: {
      appOutDir,
      electronPlatformName: 'linux',
      packager: { executableName }
    }
  }
}

function runLauncher(executable, args, runAsNode = '', extraEnv = {}) {
  return JSON.parse(execFileSync(executable, args, {
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: runAsNode, ...extraEnv }
  }))
}

function executableLauncherFixture(t) {
  const appOutDir = mkdtempSync(join(tmpdir(), 'kun-linux-launcher-exec-test-'))
  t.after(() => rmSync(appOutDir, { recursive: true, force: true }))
  const executableName = 'kun-gui'
  const executable = join(appOutDir, executableName)
  const realExecutable = join(appOutDir, linuxRealExecutableName(executableName))
  writeFileSync(
    realExecutable,
    '#!/usr/bin/env node\n' +
      'process.stdout.write(JSON.stringify({ args: process.argv.slice(2), runAsNode: process.env.ELECTRON_RUN_AS_NODE }))\n'
  )
  chmodSync(realExecutable, 0o755)
  writeFileSync(executable, linuxElectronLauncherContent(executableName))
  chmodSync(executable, 0o755)
  return { appOutDir, executable, realExecutable }
}

test('prunes packaged Kun dependencies for the package target architecture', () => {
  assert.deepEqual(packedKunPruneArgs({ electronPlatformName: 'darwin', arch: 'x64' }), [
    'prune',
    '--omit=dev',
    '--ignore-scripts',
    '--force',
    '--os=darwin',
    '--cpu=x64'
  ])
})

function payloadFixture(t) {
  const appOutDir = mkdtempSync(join(tmpdir(), 'kun-packed-payload-test-'))
  t.after(() => rmSync(appOutDir, { recursive: true, force: true }))
  const context = {
    appOutDir,
    electronPlatformName: 'darwin',
    arch: 'arm64',
    packager: {
      appInfo: { productFilename: 'Kun' }
    }
  }
  const root = join(
    appOutDir,
    'Kun.app',
    'Contents',
    'Resources',
    'app.asar.unpacked'
  )
  return { context, root }
}

function writeFixture(path, contents = 'fixture') {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
}

test('removes only regenerable or on-demand payload from packaged applications', (t) => {
  const { context, root } = payloadFixture(t)
  const modules = join(root, 'node_modules')
  const kunModules = join(root, 'kun', 'node_modules')
  const claudePlatformPackage = claudeAgentSdkPlatformPackage(context)
  const claudePlatformRoot = join(kunModules, ...claudePlatformPackage.split('/'))
  writeFixture(join(kunModules, '@anthropic-ai', 'claude-agent-sdk', 'sdk.mjs'))
  writeFixture(join(claudePlatformRoot, 'claude'), 'large on-demand binary')

  const sqliteRoot = join(modules, 'better-sqlite3')
  writeFixture(join(sqliteRoot, 'build', 'Release', 'better_sqlite3.node'))
  writeFixture(join(sqliteRoot, 'lib', 'index.js'))
  for (const relativePath of BETTER_SQLITE_BUILD_PATHS) {
    writeFixture(join(sqliteRoot, relativePath))
  }

  const coreRoot = join(modules, 'tesseract.js-core')
  for (const entry of TESSERACT_LSTM_CORE_FILES) {
    writeFixture(join(coreRoot, entry))
  }
  for (const entry of [
    'index.js',
    'tesseract-core.js',
    'tesseract-core.wasm',
    'tesseract-core-lstm.wasm.js',
    'tesseract-core-simd.wasm.js'
  ]) {
    writeFixture(join(coreRoot, entry))
  }
  writeFixture(
    join(modules, '@tesseract.js-data', 'eng', '4.0.0', 'eng.traineddata.gz')
  )
  writeFixture(
    join(modules, '@tesseract.js-data', 'eng', '4.0.0_best_int', 'eng.traineddata.gz')
  )
  for (const relativePath of KUN_ROOT_HOISTED_DEPENDENCY_PATHS) {
    writeFixture(join(modules, relativePath, 'package-fixture'))
    writeFixture(join(kunModules, relativePath, 'duplicate-fixture'))
  }
  for (const packageName of KUN_ROOT_HOISTED_VERSION_ANCHORS) {
    const relativeManifest = join(...packageName.split('/'), 'package.json')
    writeFixture(join(modules, relativeManifest), JSON.stringify({ version: '1.0.0' }))
    writeFixture(join(kunModules, relativeManifest), JSON.stringify({ version: '1.0.0' }))
  }
  const binPackageFixtures = [
    {
      name: 'escodegen',
      bin: { escodegen: 'bin/escodegen.js', esgenerate: 'bin/esgenerate.js' }
    },
    { name: 'yaml', bin: 'bin.mjs' }
  ]
  const binRoot = join(kunModules, '.bin')
  for (const packageFixture of binPackageFixtures) {
    const packageRoot = join(kunModules, packageFixture.name)
    const manifest = JSON.stringify({ ...packageFixture, version: '1.0.0' })
    writeFixture(join(modules, packageFixture.name, 'package.json'), manifest)
    writeFixture(join(packageRoot, 'package.json'), manifest)
    const bins = typeof packageFixture.bin === 'string'
      ? { [packageFixture.name]: packageFixture.bin }
      : packageFixture.bin
    for (const [binName, target] of Object.entries(bins)) {
      writeFixture(join(packageRoot, target))
      mkdirSync(binRoot, { recursive: true })
      if (process.platform === 'win32') {
        writeFixture(join(binRoot, binName), 'launcher')
      } else {
        symlinkSync(join('..', packageFixture.name, target), join(binRoot, binName))
      }
      writeFixture(join(binRoot, `${binName}.cmd`), 'launcher')
      writeFixture(join(binRoot, `${binName}.ps1`), 'launcher')
    }
  }
  writeFixture(join(kunModules, 'typescript', 'bin', 'tsc'))
  if (process.platform === 'win32') {
    writeFixture(join(binRoot, 'tsc'), 'launcher')
  } else {
    symlinkSync(join('..', 'typescript', 'bin', 'tsc'), join(binRoot, 'tsc'))
  }
  writeFixture(join(binRoot, 'tsc.cmd'), 'launcher')
  writeFixture(join(binRoot, 'tsc.ps1'), 'launcher')

  prunePackedApplicationPayload(context)
  assert.doesNotThrow(() => validatePackedApplicationPayload(context))
  assert.equal(existsSync(claudePlatformRoot), false)
  assert.equal(
    existsSync(join(kunModules, '@anthropic-ai', 'claude-agent-sdk', 'sdk.mjs')),
    true
  )
  assert.deepEqual(readdirSync(coreRoot).sort(), [...TESSERACT_LSTM_CORE_FILES].sort())
  for (const [entry, target] of TESSERACT_NODE_LSTM_ALIASES) {
    assert.match(readFileSync(join(coreRoot, entry), 'utf8'), new RegExp(`require\\('${target}'\\)`))
  }
  assert.equal(existsSync(join(sqliteRoot, 'build', 'Release', 'better_sqlite3.node')), true)
  for (const relativePath of KUN_ROOT_HOISTED_DEPENDENCY_PATHS) {
    assert.equal(existsSync(join(modules, relativePath)), true)
    assert.equal(existsSync(join(kunModules, relativePath)), false)
  }
  for (const binName of ['escodegen', 'esgenerate', 'yaml']) {
    for (const suffix of ['', '.cmd', '.ps1']) {
      assert.throws(
        () => lstatSync(join(binRoot, `${binName}${suffix}`)),
        { code: 'ENOENT' }
      )
    }
  }
  for (const suffix of ['', '.cmd', '.ps1']) {
    assert.doesNotThrow(() => lstatSync(join(binRoot, `tsc${suffix}`)))
  }

  writeFixture(join(claudePlatformRoot, 'claude'))
  assert.throws(
    () => validatePackedApplicationPayload(context),
    /on-demand Claude Code binary package/
  )
})

test('rejects dangling packaged Kun binary launchers before signing', {
  skip: process.platform === 'win32' && 'requires POSIX symbolic links'
}, (t) => {
  const { root } = payloadFixture(t)
  const kunModules = join(root, 'kun', 'node_modules')
  const binRoot = join(kunModules, '.bin')
  mkdirSync(binRoot, { recursive: true })
  symlinkSync(join('..', 'missing-package', 'bin', 'missing'), join(binRoot, 'missing'))

  assert.throws(
    () => validatePackedKunBinLinks(kunModules),
    /Dangling packaged Kun binary launcher: missing/
  )
})

test('rejects a hoisted binary name owned by a retained Kun package', (t) => {
  const { root } = payloadFixture(t)
  const kunModules = join(root, 'kun', 'node_modules')
  const escodegenRoot = join(kunModules, 'escodegen')
  writeFixture(
    join(escodegenRoot, 'package.json'),
    JSON.stringify({ name: 'escodegen', bin: { escodegen: 'bin/escodegen.js' } })
  )
  writeFixture(
    join(kunModules, 'retained-cli', 'package.json'),
    JSON.stringify({ name: 'retained-cli', bin: { escodegen: 'cli.js' } })
  )

  assert.throws(
    () => assertNoPackedKunBinOwnerCollisions(kunModules, [escodegenRoot]),
    /Kun binary launcher collision for escodegen: retained by retained-cli/
  )
})

test('rejects hoisting when a shared dependency version diverges between root and Kun', (t) => {
  const { context, root } = payloadFixture(t)
  const modules = join(root, 'node_modules')
  const kunModules = join(root, 'kun', 'node_modules')
  for (const packageName of KUN_ROOT_HOISTED_VERSION_ANCHORS) {
    const relativeManifest = join(...packageName.split('/'), 'package.json')
    writeFixture(join(modules, relativeManifest), JSON.stringify({ version: '1.0.0' }))
    writeFixture(join(kunModules, relativeManifest), JSON.stringify({ version: '1.0.0' }))
  }
  const diverged = join(modules, 'pdfjs-dist', 'package.json')
  writeFileSync(diverged, JSON.stringify({ version: '9.9.9' }))

  assert.throws(
    () => prunePackedApplicationPayload(context),
    /Cannot hoist pdfjs-dist: root=9\.9\.9, Kun=1\.0\.0/
  )
})

test('requires every root-hoisted runtime dependency to exist outside the asar', (t) => {
  const { root } = payloadFixture(t)
  const modules = join(root, 'node_modules')
  for (const packageName of KUN_ROOT_HOISTED_SHARED_JS_PACKAGES) {
    const manifest = join(modules, ...packageName.split('/'), 'package.json')
    writeFixture(manifest, JSON.stringify({ name: packageName, version: '1.0.0' }))
  }
  writeFixture(
    join(modules, 'proxy-agent', 'package.json'),
    JSON.stringify({
      name: 'proxy-agent',
      version: '8.0.2',
      dependencies: { 'lru-cache': '^7.14.1' }
    })
  )
  const lruManifest = join(
    modules,
    'proxy-agent',
    'node_modules',
    'lru-cache',
    'package.json'
  )
  writeFixture(lruManifest, JSON.stringify({ name: 'lru-cache', version: '7.18.3' }))

  assert.doesNotThrow(() => validateRootHoistedDependencyClosure(root))
  rmSync(lruManifest)
  assert.throws(
    () => validateRootHoistedDependencyClosure(root),
    /proxy-agent@8\.0\.2 -> lru-cache/
  )
})

test('installs an executable Linux product launcher over a preserved ELF payload', {
  skip: process.platform === 'win32' && 'requires POSIX executable modes'
}, (t) => {
  const paths = fixture(t)
  installLinuxElectronLauncher(paths.context)

  const realExecutable = join(
    paths.appOutDir,
    linuxRealExecutableName(paths.context.packager.executableName)
  )
  assert.equal(existsSync(realExecutable), true)
  assert.equal(
    readFileSync(paths.executable, 'utf8'),
    linuxElectronLauncherContent(paths.context.packager.executableName)
  )
  assert.equal(statSync(paths.executable).mode & 0o777, 0o755)
  assert.equal(statSync(realExecutable).mode & 0o777, 0o755)
  assert.deepEqual([...readFileSync(realExecutable).subarray(0, 4)], [0x7f, 0x45, 0x4c, 0x46])
})

test('GUI prepends the sandbox flag without parsing or swallowing user arguments', {
  skip: process.platform === 'win32' && 'requires executing a POSIX shell launcher'
}, (t) => {
  const paths = executableLauncherFixture(t)
  assert.deepEqual(runLauncher(paths.executable, ['--user-argument']).args, [
    LINUX_SANDBOX_LAUNCHER_FLAG,
    '--user-argument'
  ])
  assert.deepEqual(
    runLauncher(paths.executable, [LINUX_SANDBOX_LAUNCHER_FLAG, '--user-argument']).args,
    [LINUX_SANDBOX_LAUNCHER_FLAG, LINUX_SANDBOX_LAUNCHER_FLAG, '--user-argument']
  )
  assert.deepEqual(runLauncher(paths.executable, ['--', LINUX_SANDBOX_LAUNCHER_FLAG]).args, [
    LINUX_SANDBOX_LAUNCHER_FLAG,
    '--',
    LINUX_SANDBOX_LAUNCHER_FLAG
  ])
})

test('Linux launcher resolves a bare AppImage product name through APPDIR', () => {
  const content = linuxElectronLauncherContent('kun-gui')
  assert.match(content, /AppImage may invoke AppRun through PATH/)
  assert.match(content, /\[ -n "\$\{APPDIR:-\}" \] && \[ -x "\$\{APPDIR\}\/kun-gui" \]/)
  assert.match(content, /launcher_path="\$\{APPDIR\}\/kun-gui"/)
})

test('does not add a Chromium flag to ELECTRON_RUN_AS_NODE commands', {
  skip: process.platform === 'win32' && 'requires executing a POSIX shell launcher'
}, (t) => {
  const paths = executableLauncherFixture(t)
  const result = runLauncher(paths.executable, ['runtime-entry.js', 'extension', 'list'], '1')
  assert.deepEqual(result.args, ['runtime-entry.js', 'extension', 'list'])
  assert.equal(result.runAsNode, '1')
})

test('routes KUN_CLI_ENTRY through the packaged Kun CLI without alternate GUI flags', {
  skip: process.platform === 'win32' && 'requires executing a POSIX shell launcher'
}, (t) => {
  const paths = executableLauncherFixture(t)
  const result = runLauncher(paths.executable, ['runtime', 'status'], '', { KUN_CLI_ENTRY: '1' })
  assert.equal(result.runAsNode, '1')
  assert.deepEqual(result.args, [
    join(realpathSync(paths.appOutDir), 'resources', 'app.asar.unpacked', 'kun', 'dist', 'cli', 'serve-entry.js'),
    'runtime',
    'status'
  ])
})

test('fails closed for unsafe names, non-executables, and payload collisions', {
  skip: process.platform === 'win32' && 'requires POSIX executable modes'
}, (t) => {
  const unsafe = fixture(t)
  unsafe.context.packager.executableName = '../escape'
  assert.throws(() => installLinuxElectronLauncher(unsafe.context), /Unsafe Linux executable name/)

  const nonExecutable = fixture(t)
  chmodSync(nonExecutable.executable, 0o644)
  assert.throws(
    () => installLinuxElectronLauncher(nonExecutable.context),
    /must be a non-symlink executable file/
  )

  const nonElf = fixture(t)
  writeFileSync(nonElf.executable, '#!/bin/sh\n')
  chmodSync(nonElf.executable, 0o755)
  assert.throws(() => installLinuxElectronLauncher(nonElf.context), /not an ELF payload/)

  if (process.platform !== 'win32') {
    const symlink = fixture(t)
    const outside = join(symlink.appOutDir, 'outside-elf')
    writeFileSync(outside, Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
    chmodSync(outside, 0o755)
    rmSync(symlink.executable)
    symlinkSync(outside, symlink.executable)
    assert.throws(() => installLinuxElectronLauncher(symlink.context), /non-symlink executable/)
  }

  const collision = fixture(t)
  writeFileSync(
    join(collision.appOutDir, linuxRealExecutableName(collision.context.packager.executableName)),
    'collision'
  )
  assert.throws(() => installLinuxElectronLauncher(collision.context), /Refusing to overwrite/)

  const fuses = fixture(t)
  fuses.context.packager.config = { electronFuses: { runAsNode: false } }
  assert.throws(() => installLinuxElectronLauncher(fuses.context), /electronFuses cannot be applied/)
})

test('does not alter non-Linux packages', (t) => {
  const paths = fixture(t)
  paths.context.electronPlatformName = 'darwin'
  installLinuxElectronLauncher(paths.context)
  assert.equal(existsSync(paths.executable), true)
  assert.equal(
    existsSync(join(paths.appOutDir, linuxRealExecutableName(paths.context.packager.executableName))),
    false
  )
})

test('writes a relocatable macOS kun launcher that resolves its installed symlink', {
  skip: process.platform === 'win32' && 'requires POSIX executable modes'
}, (t) => {
  const appOutDir = mkdtempSync(join(tmpdir(), 'kun-mac-cli-launcher-'))
  t.after(() => rmSync(appOutDir, { recursive: true, force: true }))
  const context = {
    appOutDir,
    electronPlatformName: 'darwin',
    packager: {
      appInfo: { productFilename: 'Kun' },
      executableName: 'Kun'
    }
  }
  installCliLaunchers(context)
  const launcher = join(appOutDir, 'Kun.app', 'Contents', 'Resources', 'bin', 'kun')
  const appExecutable = join(appOutDir, 'Kun.app', 'Contents', 'MacOS', 'Kun')
  mkdirSync(join(appOutDir, 'Kun.app', 'Contents', 'MacOS'), { recursive: true })
  writeFileSync(
    appExecutable,
    '#!/usr/bin/env node\n' +
      'process.stdout.write(JSON.stringify({ args: process.argv.slice(2), runAsNode: process.env.ELECTRON_RUN_AS_NODE }))\n'
  )
  chmodSync(appExecutable, 0o755)
  const commandDir = join(appOutDir, 'usr', 'local', 'bin')
  mkdirSync(commandDir, { recursive: true })
  const commandPath = join(commandDir, 'kun')
  const intermediateLink = join(commandDir, 'kun-app-link')
  symlinkSync(launcher, intermediateLink)
  symlinkSync('kun-app-link', commandPath)

  const contents = readFileSync(launcher, 'utf8')
  assert.match(contents, /while \[ -L "\$launcher_path" \]/)
  assert.match(contents, /app\.asar\.unpacked\/kun\/dist\/cli\/serve-entry\.js/)
  assert.match(contents, /ELECTRON_RUN_AS_NODE=1 exec/)
  assert.equal(statSync(launcher).mode & 0o777, 0o755)
  const result = JSON.parse(execFileSync(commandPath, ['runtime', 'status'], {
    encoding: 'utf8'
  }))
  assert.equal(result.runAsNode, '1')
  assert.deepEqual(result.args, [
    join(
      realpathSync(appOutDir),
      'Kun.app',
      'Contents',
      'Resources',
      'app.asar.unpacked',
      'kun',
      'dist',
      'cli',
      'serve-entry.js'
    ),
    'runtime',
    'status'
  ])
})

test('writes a relocatable Windows kun.cmd launcher', (t) => {
  const appOutDir = mkdtempSync(join(tmpdir(), 'kun-win-cli-launcher-'))
  t.after(() => rmSync(appOutDir, { recursive: true, force: true }))
  installCliLaunchers({
    appOutDir,
    electronPlatformName: 'win32',
    packager: {
      appInfo: { productFilename: 'Kun' },
      executableName: 'Kun'
    }
  })
  const contents = readFileSync(join(appOutDir, 'bin', 'kun.cmd'), 'utf8')
  assert.match(contents, /Node\.js \^>=22\.19\.0 is required/)
  assert.match(contents, /winget install --id OpenJS\.NodeJS\.22 --exact/)
  assert.match(contents, /for \/f "delims=" %%N in \('where\.exe node/)
  assert.match(contents, /"%KUN_NODE%" "%KUN_CLI_ENTRY%" %\*/)
  assert.match(contents, /:tui-node-shim[\s\S]*call "%KUN_NODE%"/)
  assert.doesNotMatch(contents, /call node "%KUN_CLI_ENTRY%"/)
  assert.match(contents, /KUN_PACKAGED_RUNTIME_EXECUTABLE=%~dp0\.\.\\Kun\.exe/)
  assert.match(contents, /:electron[\s\S]*ELECTRON_RUN_AS_NODE=1/)
  assert.match(contents, /%~dp0\.\.\\Kun\.exe/)
  assert.match(contents, /app\.asar\.unpacked\\kun\\dist\\cli\\serve-entry\.js/)
})

test('routes bare and explicit Windows TUI commands through system Node', () => {
  const contents = windowsCliLauncherContent('Kun')
  assert.match(contents, /if "%KUN_FIRST_ARG%"=="" goto :tui/)
  assert.match(contents, /if \/I "%KUN_FIRST_ARG%"=="tui" goto :tui/)
  assert.match(contents, /where\.exe node/)
  assert.doesNotMatch(contents, /node -e/)
  assert.match(contents, /goto :electron/)
})

test('packages flavor-fixed kun-dv launchers without a production CLI alias', (t) => {
  const macOut = mkdtempSync(join(tmpdir(), 'kun-dv-mac-cli-launcher-'))
  const winOut = mkdtempSync(join(tmpdir(), 'kun-dv-win-cli-launcher-'))
  t.after(() => {
    rmSync(macOut, { recursive: true, force: true })
    rmSync(winOut, { recursive: true, force: true })
  })
  installCliLaunchers({
    appOutDir: macOut,
    electronPlatformName: 'darwin',
    packager: {
      appInfo: { productFilename: 'kun-dv' },
      executableName: 'kun-dv',
      config: { extraMetadata: { kunAppFlavor: 'development' } }
    }
  })
  const macLauncher = join(macOut, 'kun-dv.app', 'Contents', 'Resources', 'bin', 'kun-dv')
  const macContents = readFileSync(macLauncher, 'utf8')
  assert.match(macContents, /KUN_APP_FLAVOR=development/)
  assert.match(macContents, /KUN_RUNTIME_FLAVOR=development/)
  assert.equal(existsSync(join(macOut, 'kun-dv.app', 'Contents', 'Resources', 'bin', 'kun')), false)

  installCliLaunchers({
    appOutDir: winOut,
    electronPlatformName: 'win32',
    packager: {
      appInfo: { productFilename: 'kun-dv' },
      executableName: 'kun-dv',
      config: { extraMetadata: { kunAppFlavor: 'development' } }
    }
  })
  const windowsContents = readFileSync(join(winOut, 'bin', 'kun-dv.cmd'), 'utf8')
  assert.match(windowsContents, /set "KUN_APP_FLAVOR=development"/)
  assert.match(windowsContents, /set "KUN_RUNTIME_FLAVOR=development"/)
  assert.match(windowsContents, /\\kun-dv\.exe/)
  assert.equal(existsSync(join(winOut, 'bin', 'kun.cmd')), false)
})
