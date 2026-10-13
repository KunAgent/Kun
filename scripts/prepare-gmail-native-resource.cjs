const { constants } = require('node:fs')
const { randomUUID } = require('node:crypto')
const { lstat, mkdir, open, realpath, rename, rm, writeFile } = require('node:fs/promises')
const { dirname, isAbsolute, join, relative, resolve, sep } = require('node:path')
const { pathToFileURL } = require('node:url')

const RESOURCE_PATH = ['kun', 'dist', 'resources', 'gmail-native-client.json']
const MAX_SOURCE_BYTES = 16_384

/** Publisher build hook only. Source is a private file path; raw credential env/argv is unsupported. */
async function prepareGmailNativeResource(input, dependencies = {}) {
  try {
    const projectDir = await realpath(resolve(input.projectDir))
    const target = join(projectDir, ...RESOURCE_PATH)
    await assertResourceDirectory(dirname(target), projectDir)
    // Disabled builds cannot accidentally retain credentials from a prior enabled package.
    await rm(target, { force: true })
    if (!input.enabled || input.enabled === '0') return { enabled: false }
    if (input.enabled !== '1' || input.platform !== 'darwin' || !input.sourcePath) throw configurationFailure()
    const sourceRelative = relative(projectDir, await realpath(resolve(input.sourcePath)))
    if (sourceRelative !== '..' && !sourceRelative.startsWith(`..${sep}`) && !isAbsolute(sourceRelative)) throw configurationFailure()
    const schemas = await (dependencies.loadSchemas ?? (() => import(pathToFileURL(
      join(projectDir, 'kun', 'dist', 'gmail', 'oauth-client-config.js')).href)))()
    const downloaded = await readSource(input.sourcePath)
    const clientSecret = schemas.parseDownloadedGmailOAuthClient(downloaded)
    const prepared = schemas.parsePackagedGmailOAuthClient({ schemaVersion: 1,
      distribution: 'kun-desktop-macos', clientId: downloaded.installed.client_id, clientSecret })
    await mkdir(dirname(target), { recursive: true })
    await assertResourceDirectory(dirname(target), projectDir)
    const temporary = `${target}.${randomUUID()}.tmp`
    try {
      // Package identifiers must remain readable when installed for another OS user.
      await writeFile(temporary, `${JSON.stringify(prepared)}\n`, { mode: 0o644, flag: 'wx' })
      await rename(temporary, target)
    } finally { await rm(temporary, { force: true }) }
    return { enabled: true, clientId: prepared.clientId }
  } catch {
    // Errors intentionally omit source paths, parsing values and credentials.
    throw configurationFailure()
  }
}

async function readSource(sourcePath) {
  const file = await open(resolve(sourcePath), constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const details = await file.stat()
    if (!details.isFile() || details.size > MAX_SOURCE_BYTES) throw configurationFailure()
    const buffer = Buffer.alloc(MAX_SOURCE_BYTES + 1)
    let size = 0
    while (size < buffer.length) {
      const part = await file.read(buffer, size, buffer.length - size, null)
      if (!part.bytesRead) break
      size += part.bytesRead
    }
    if (size > MAX_SOURCE_BYTES) throw configurationFailure()
    return JSON.parse(buffer.subarray(0, size).toString('utf8'))
  } finally { await file.close() }
}

async function assertResourceDirectory(path, projectDir) {
  for (let current = path; current !== projectDir; current = dirname(current)) {
    const metadata = await lstat(current).catch((error) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (metadata && (!metadata.isDirectory() || metadata.isSymbolicLink())) throw configurationFailure()
  }
}
function configurationFailure() {
  return new Error('Gmail package configuration failed. Enable only macOS releases and provide the reviewed Kun Desktop credentials file outside Git.')
}

module.exports = { prepareGmailNativeResource, RESOURCE_PATH }
