import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const skillsRoot = join(root, 'resources', 'bundled-skills')
const runtimeModule = join(root, 'kun', 'dist', 'skills', 'skill-runtime.js')
const expectedCount = 35
const maxManifestBytes = 64 * 1024
const maxEntryBytes = 256 * 1024

async function main() {
  const { SkillManifest } = await import(pathToFileURL(runtimeModule).href).catch((error) => {
    throw new Error(`Kun runtime must be built before validating bundled skills: ${error.message}`)
  })
  const rootReal = await realpath(skillsRoot)
  const entries = (await readdir(rootReal, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  if (entries.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} bundled skills, found ${entries.length}`)
  }
  const ids = new Set()
  for (const directory of entries) {
    const skillRoot = join(rootReal, directory)
    const manifestPath = join(skillRoot, 'skill.json')
    const entryLicense = await existingFile(skillRoot, ['LICENSE.txt', 'LICENSE'])
    if (!entryLicense) throw new Error(`${directory}: missing LICENSE.txt or LICENSE`)
    const manifestInfo = await stat(manifestPath)
    if (manifestInfo.size > maxManifestBytes) throw new Error(`${directory}: skill.json exceeds 64 KiB`)
    const manifest = SkillManifest.parse(JSON.parse(await readFile(manifestPath, 'utf8')))
    const id = manifest.id ?? manifest.name
    if (id !== directory) throw new Error(`${directory}: manifest id must match directory name`)
    if (ids.has(id)) throw new Error(`${directory}: duplicate skill id ${id}`)
    ids.add(id)
    const entryPath = await safeFile(skillRoot, manifest.entry)
    if ((await stat(entryPath)).size > maxEntryBytes) throw new Error(`${directory}: entry exceeds 256 KiB`)
    for (const asset of manifest.assets) await safeFile(skillRoot, asset)
  }
  const diagram = SkillManifest.parse(JSON.parse(
    await readFile(join(rootReal, 'diagram-design', 'skill.json'), 'utf8')
  ))
  if (!diagram.version.startsWith('2.6.0-kun.')) {
    throw new Error(`diagram-design: expected preserved 2.6.0-kun.x version, found ${diagram.version}`)
  }
  if (diagram.assets.length < 8) throw new Error('diagram-design: expected preserved references and assets')
  console.log(`Validated ${entries.length} bundled skills.`)
}

async function existingFile(rootPath, names) {
  for (const name of names) {
    try {
      if ((await stat(join(rootPath, name))).isFile()) return join(rootPath, name)
    } catch {
      // Try the next accepted license filename.
    }
  }
  return undefined
}

async function safeFile(packageRoot, value) {
  if (!value || isAbsolute(value)) throw new Error(`${basename(packageRoot)}: path must be relative: ${value}`)
  const lexical = resolve(packageRoot, value)
  const rel = relative(packageRoot, lexical)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`${basename(packageRoot)}: path escapes package root: ${value}`)
  }
  const resolved = await realpath(lexical)
  const resolvedRel = relative(packageRoot, resolved)
  if (resolvedRel === '..' || resolvedRel.startsWith(`..${sep}`) || isAbsolute(resolvedRel)) {
    throw new Error(`${basename(packageRoot)}: path resolves outside package root: ${value}`)
  }
  if (!(await stat(resolved)).isFile()) throw new Error(`${basename(packageRoot)}: not a regular file: ${value}`)
  return resolved
}

await main()
