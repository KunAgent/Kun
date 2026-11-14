import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { access, chmod, copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { copyTree, ensureSafeOutput, json, portableManifest, runtimeFile, writeJson } from './npm-files.mjs'
import { productionLock } from './npm-lock.mjs'
import { runtimeClosure } from './npm-runtime-files.mjs'
import { bundleProduction, bundledManifest, bundleSqlite } from './npm-bundle.mjs'

export const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const kun = join(repository, 'kun')
const digest = (value) => createHash('sha256').update(value).digest('hex')

async function bundleLocalPackages(stage, descriptor, sourceLock) {
  const bundled = {}
  for (const name of descriptor.localDependencies) {
    const module = join(kun, 'node_modules', name)
    // Source workspaces are links by design; materialize their contents here.
    let input
    if (name === '@kun/extension-api') input = join(repository, 'packages/extension-api')
    else if (name === '@kun/provider-catalog') input = join(repository, 'packages/provider-catalog')
    else if (name === 'create-kun-extension') input = join(repository, 'packages/create-kun-extension')
    else input = module
    const manifest = portableManifest(await json(join(input, 'package.json')))
    const target = join(stage, 'node_modules', name)
    await mkdir(target, { recursive: true })
    if (name === 'create-kun-extension') {
      await copyTree(join(input, 'src'), join(target, 'src'), (path, dir) => dir || !/\.test\./.test(path))
      await copyTree(join(input, 'templates'), join(target, 'templates'))
    } else {
      const directory = name === '@kun/remote-protocol' ? 'src' : 'dist'
      await copyTree(join(input, directory), join(target, directory), runtimeFile)
      if (name === '@kun/extension-api') await copyTree(join(input, 'schema'), join(target, 'schema'))
    }
    await copyFile(join(repository, 'LICENSE'), join(target, 'LICENSE'))
    await copyFile(join(input, 'README.md'), join(target, 'README.md')).catch((error) => {
      if (error.code !== 'ENOENT') throw error
    })
    await writeJson(join(target, 'package.json'), manifest)
    bundled[name] = manifest
    assert.equal(manifest.version, sourceLock.packages[`node_modules/${name}`]?.version ??
      sourceLock.packages[sourceLock.packages[`node_modules/${name}`]?.resolved]?.version,
    `Local package version does not match source lock: ${name}`)
  }
  return bundled
}

async function windowsPayload(stage, directory, descriptor, version, sourceCommit) {
  if (!directory) return undefined
  const source = await json(join(directory, 'manifest.json'))
  assert.equal(source.version, 1)
  assert.equal(source.arch, 'x64')
  assert.equal(source.serviceVersion, version, 'Rebuild Windows helpers for the candidate version')
  assert.equal(source.sourceCommit, sourceCommit, 'Windows helpers must use the same source commit as the main package')
  const target = join(stage, 'node_modules', descriptor.windowsPackage)
  await mkdir(target, { recursive: true })
  for (const name of ['kun_windows_startup.node', 'kun-owned-launcher.exe']) {
    assert.equal(digest(await readFile(join(directory, name))), source.files[name], `Windows helper digest mismatch: ${name}`)
    await copyFile(join(directory, name), join(target, name))
  }
  await copyFile(join(directory, 'manifest.json'), join(target, 'manifest.json'))
  await copyFile(join(repository, 'LICENSE'), join(target, 'LICENSE'))
  const manifest = {
    name: descriptor.windowsPackage, version, description: 'Kun Windows process ownership components',
    license: 'PolyForm-Noncommercial-1.0.0', os: ['win32'], cpu: ['x64'],
    files: ['manifest.json', '*.node', '*.exe', 'LICENSE'], engines: { node: descriptor.node }
  }
  await writeJson(join(target, 'package.json'), manifest)
  return manifest
}

export async function stageNpm(options = {}) {
  const output = resolve(options.output ?? join(repository, '.cache/kun-npm/package'))
  await ensureSafeOutput(output, repository)
  const descriptor = await json(join(kun, 'npm/release.json'))
  const source = await json(join(kun, 'package.json'))
  const sourceLock = await json(join(kun, 'package-lock.json'))
  const build = await json(join(kun, 'dist/runtime-build.json'))
  assert.equal(build.serviceVersion, source.version, 'Build Kun without desktop version overrides before npm staging')
  await access(join(kun, 'dist/tui/app/main.js'))
  await access(join(kun, 'npm/bin/kun.mjs'))
  try {
    const previous = await readdir(output)
    assert(previous.length === 0 || previous.includes('.kun-npm-staging'),
      'Refusing to replace an existing directory not owned by Kun npm staging')
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  await rm(output, { recursive: true, force: true })
  await mkdir(output, { recursive: true })
  await writeFile(join(output, '.kun-npm-staging'), 'Kun npm staging directory\n')
  const runtime = await runtimeClosure(join(kun, 'dist'))
  await copyTree(join(kun, 'dist'), join(output, 'dist'), (path, dir) =>
    dir ? [...runtime].some((file) => file.startsWith(`${path}/`)) : runtime.has(path))
  // Native helpers are distributed independently, never mixed with the main JS tree.
  await rm(join(output, 'dist/native'), { recursive: true, force: true })
  await mkdir(join(output, 'bin'), { recursive: true })
  await copyFile(join(kun, 'npm/bin/kun.mjs'), join(output, 'bin/kun.mjs'))
  await chmod(join(output, 'bin/kun.mjs'), 0o755)
  await copyFile(join(kun, 'npm/README.md'), join(output, 'README.md'))
  await copyFile(join(repository, 'LICENSE'), join(output, 'LICENSE'))
  const bundled = await bundleLocalPackages(output, descriptor, sourceLock)
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim()
  const sourceDirty = Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'],
    { cwd: repository, encoding: 'utf8' }).trim())
  const dependencies = Object.fromEntries(Object.entries(source.dependencies)
    .filter(([name]) => !descriptor.excludedDependencies.includes(name))
    .map(([name, spec]) => [name, bundled[name]?.version ??
      (spec.startsWith('https:') ? spec : sourceLock.packages[`node_modules/${name}`]?.version ?? spec)]))
  const nativeDirectory = options.windowsPayload ?? (process.platform === 'win32'
    ? join(kun, 'dist/native/win32-x64') : undefined)
  const windows = await windowsPayload(output, nativeDirectory, descriptor, source.version, sourceCommit)
  let manifest = {
    name: options.name ?? descriptor.name, version: source.version,
    description: 'Standalone Kun agent, terminal UI and HTTP/SSE runtime',
    license: source.license, type: 'module', bin: { kun: './bin/kun.mjs' },
    files: ['bin', 'dist', 'README.md', 'LICENSE', 'THIRD-PARTY-NOTICES.txt', 'npm-shrinkwrap.json'],
    engines: { node: descriptor.node }, os: ['darwin', 'linux', 'win32'], cpu: ['arm64', 'x64'],
    repository: { type: 'git', url: 'https://github.com/KunAgent/Kun.git' },
    dependencies,
    optionalDependencies: windows ? { [descriptor.windowsPackage]: source.version } : {},
    bundleDependencies: [...descriptor.localDependencies, ...(windows ? [windows.name] : [])],
    kunNpm: { kind: 'npm', schemaVersion: 1, sourceCommit, sourceDirty, buildId: build.buildId,
      windowsPackage: descriptor.windowsPackage,
      targets: descriptor.targets.filter(target => target !== 'win32-x64' || windows) }
  }
  const lock = productionLock(sourceLock, manifest, bundled, descriptor.targets)
  const cache = join(repository, '.cache/kun-npm/archive-cache')
  await bundleProduction(output, lock, descriptor.localDependencies, cache)
  const sqlite = await bundleSqlite(output, await json(join(kun, 'npm/sqlite-prebuilds.json')), cache)
  if (windows) lock.packages[`node_modules/${descriptor.windowsPackage}`] = {
    version: source.version, os: ['win32'], cpu: ['x64'], optional: true,
    inBundle: true, license: source.license, engines: { node: descriptor.node }
  }
  manifest = bundledManifest(manifest, lock)
  Object.assign(lock.packages[''], {
    dependencies: manifest.dependencies, optionalDependencies: manifest.optionalDependencies,
    bundleDependencies: manifest.bundleDependencies
  })
  manifest.kunNpm.sqlite = sqlite
  manifest.kunNpm.vendorPatches = ['babel-glob-interop', 'sqlite-prebuild-resolver']
  const lockText = `${JSON.stringify(lock, null, 2)}\n`
  manifest.kunNpm.lockSha256 = digest(lockText)
  await writeJson(join(output, 'package.json'), manifest)
  await writeFile(join(output, 'npm-shrinkwrap.json'), lockText)
  const notices = ['Kun production dependency inventory', '',
    'Third-party packages retain their original licenses in their npm distributions.',
    'Bundled Kun components use the accompanying LICENSE. This inventory is generated from the production lock.', '']
  for (const [key, entry] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b))) {
    if (!key) continue
    notices.push(`${key}: ${entry.version}; license: ${entry.license ?? 'see package distribution'}`)
  }
  await writeFile(join(output, 'THIRD-PARTY-NOTICES.txt'), `${notices.join('\n')}\n`)
  return { directory: output, name: manifest.name, version: manifest.version, sourceCommit, sourceDirty,
    lockSha256: manifest.kunNpm.lockSha256, bundled: manifest.bundleDependencies }
}

function parse(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 2) {
    const key = { '--output': 'output', '--name': 'name', '--windows-payload': 'windowsPayload' }[argv[index]]
    assert(key && argv[index + 1], 'Usage: npm-stage.mjs [--output DIR] [--name PACKAGE] [--windows-payload DIR]')
    options[key] = argv[index + 1]
  }
  return options
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.stdout.write(`${JSON.stringify(await stageNpm(parse(process.argv.slice(2))), null, 2)}\n`)
}
