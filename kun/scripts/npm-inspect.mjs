import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, lstat, readFile, readdir } from 'node:fs/promises'
import { builtinModules, createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { json } from './npm-files.mjs'

const { init, parse } = createRequire(import.meta.url)('es-module-lexer')
const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)])
const packageName = (specifier) => specifier.startsWith('@')
  ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]

export async function inspectNpm(directory) {
  const root = resolve(directory)
  const manifest = await json(join(root, 'package.json'))
  assert.equal(manifest.kunNpm?.kind, 'npm', 'Missing npm distribution identity')
  assert.deepEqual(Object.keys(manifest.bin), ['kun'])
  assert.equal(manifest.engines.node, '>=26.4.0 <27')
  assert(!manifest.private && !manifest.scripts?.postinstall, 'Public CLI must not patch consumer installations')
  const lockText = await readFile(join(root, 'npm-shrinkwrap.json'), 'utf8')
  const lock = JSON.parse(lockText)
  assert.equal(createHash('sha256').update(lockText).digest('hex'), manifest.kunNpm.lockSha256)
  assert.equal(lock.version, manifest.version)
  for (const [key, entry] of Object.entries(lock.packages)) {
    assert(!key.startsWith('../'), `External lock entry: ${key}`)
    assert(!entry.link, `Linked lock entry: ${key}`)
    assert(!entry.resolved || !/^(?:file:|workspace:|\.\.?\/|\/)/.test(entry.resolved), `Nonportable lock: ${key}`)
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const spec of Object.values(entry[field] ?? {})) {
        assert(!/^(?:file:|workspace:|link:|\.\.?\/|\/)/.test(spec), `Nonportable dependency: ${key}`)
      }
    }
  }
  const files = []
  async function visit(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name)
      assert(!entry.isSymbolicLink(), `Payload symlink: ${path}`)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile()) files.push(path)
    }
  }
  await visit(root)
  await init
  const dependencies = new Set([...Object.keys(manifest.dependencies), ...Object.keys(manifest.optionalDependencies ?? {})])
  const runtimeFiles = files.filter((path) => path.startsWith(join(root, 'dist') + sep))
  for (const path of runtimeFiles) {
    const label = relative(root, path).split(sep).join('/')
    assert(!/(?:\.d\.ts|\.map|\.test\.|test-support|__fixtures__|\.bench\.)/.test(label), `Development runtime file: ${label}`)
    if (!path.endsWith('.js')) continue
    const imports = parse(await readFile(path, 'utf8'))[0]
    for (const entry of imports) {
      if (!entry.n || builtins.has(entry.n)) continue
      if (entry.n.startsWith('.')) {
        const target = resolve(dirname(path), entry.n)
        assert(target.startsWith(root + sep), `Escaping runtime import: ${label} -> ${entry.n}`)
        await access(target).catch(() => { throw new Error(`Missing runtime import: ${label} -> ${entry.n}`) })
      } else if (entry.d === -1) {
        assert(dependencies.has(packageName(entry.n)), `Undeclared runtime dependency: ${label} -> ${entry.n}`)
      }
    }
  }
  for (const name of manifest.bundleDependencies) {
    const bundled = await json(join(root, 'node_modules', name, 'package.json'))
    assert.equal(bundled.version, manifest.dependencies[name] ?? manifest.optionalDependencies[name])
    assert(!bundled.scripts?.install && !bundled.scripts?.postinstall,
      `Bundled dependency must be built before packaging: ${name}`)
    if (await access(join(root, 'node_modules', name, 'binding.gyp')).then(() => true, () => false)) {
      assert.equal(bundled.gypfile, false, `Bundled dependency must disable implicit node-gyp: ${name}`)
    }
    if (name.startsWith('@kun/') || name === 'create-kun-extension') {
      await access(join(root, 'node_modules', name, 'LICENSE'))
    }
  }
  for (const required of [manifest.bin.kun, 'dist/cli/serve-entry.js', 'dist/cli/serve-main.js',
    'dist/manager/manager-entry.js', 'dist/tui/app/main.js', 'dist/runtime-build.json',
    'LICENSE', 'THIRD-PARTY-NOTICES.txt', 'README.md']) await access(join(root, required))
  const build = await json(join(root, 'dist/runtime-build.json'))
  assert.equal(build.serviceVersion, manifest.version)
  assert.equal(build.buildId, manifest.kunNpm.buildId)
  const sqlite = manifest.kunNpm.sqlite
  if (sqlite) {
    const nativeRoot = resolve(root, sqlite.nativeDirectory)
    assert(nativeRoot.startsWith(root + sep), 'SQLite payload escapes the package')
    for (const target of Object.keys(sqlite.targets)) {
      const bytes = await readFile(join(nativeRoot, target, 'Release/better_sqlite3.node'))
      assert.equal(createHash('sha256').update(bytes).digest('hex'), sqlite.files[target],
        `SQLite native payload mismatch: ${target}`)
    }
  }
  const executable = await lstat(join(root, manifest.bin.kun))
  if (process.platform !== 'win32') assert(executable.mode & 0o111, 'CLI entry is not executable')
  return { name: manifest.name, version: manifest.version, files: files.length,
    runtimeFiles: runtimeFiles.length, bytes: (await Promise.all(files.map((path) => lstat(path))))
      .reduce((sum, entry) => sum + entry.size, 0), sourceCommit: manifest.kunNpm.sourceCommit,
    sourceDirty: manifest.kunNpm.sourceDirty }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  assert(process.argv.length === 3, 'Usage: npm-inspect.mjs STAGED_DIRECTORY')
  process.stdout.write(`${JSON.stringify(await inspectNpm(process.argv[2]), null, 2)}\n`)
}
