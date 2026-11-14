import assert from 'node:assert/strict'
import { chmod, copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'

export const json = async (path) => JSON.parse(await readFile(path, 'utf8'))
export const writeJson = async (path, value) => {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

export async function copyTree(source, destination, include = () => true, prefix = '') {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name
    if (!include(name, entry.isDirectory())) continue
    const input = join(source, entry.name)
    const output = join(destination, entry.name)
    assert(!entry.isSymbolicLink(), `Symlinks are not allowed in npm payload: ${input}`)
    if (entry.isDirectory()) {
      await mkdir(output, { recursive: true })
      await copyTree(input, output, include, name)
    } else if (entry.isFile()) {
      await mkdir(dirname(output), { recursive: true })
      await copyFile(input, output)
      await chmod(output, (await lstat(input)).mode & 0o777)
    }
  }
}

export function runtimeFile(path, directory) {
  if (/(?:^|\/)(?:__fixtures__|test-support|benchmarks?)(?:\/|$)/.test(path)) return false
  if (/(?:\.test|\.bench|[-.]test-support)(?:[./-]|$)/.test(path)) return false
  if (/(?:[-.]fixtures?|[-.]test-helpers?)(?:[./-]|$)/.test(path)) return false
  if (/^cli\/(?:item-index-pagination|manager-lease-renewal|replay)-entry\.js$/.test(path)) return false
  if (directory) return true
  return /\.(?:js|mjs|cjs|json|wasm|node|exe)$/.test(path)
}

export function portableManifest(value) {
  const result = structuredClone(value)
  for (const field of ['scripts', 'devDependencies', 'overrides', 'private', 'types', 'typesVersions']) delete result[field]
  function withoutTypes(entry) {
    if (!entry || typeof entry !== 'object') return entry
    return Object.fromEntries(Object.entries(entry).filter(([key]) => key !== 'types')
      .map(([key, child]) => [key, withoutTypes(child)]))
  }
  if (result.exports) result.exports = withoutTypes(result.exports)
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, version] of Object.entries(result[field] ?? {})) {
      assert(!/^(?:file:|workspace:|link:|\.\.?\/|\/)/.test(version), `Nonportable ${name}: ${version}`)
    }
  }
  return result
}

export async function ensureSafeOutput(path, repository) {
  const resolvedRepository = await realpath(repository)
  await mkdir(dirname(path), { recursive: true })
  const parent = await realpath(dirname(path))
  const physical = join(parent, path.split(sep).at(-1))
  const location = relative(resolvedRepository, physical).split(sep).join('/')
  assert(location.startsWith('.cache/') || location.startsWith('dist/'),
    'npm output must be in this repository .cache/ or dist/ directory')
  const entry = await lstat(path).catch((error) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  assert(!entry?.isSymbolicLink(), 'npm output cannot be a symlink')
}
