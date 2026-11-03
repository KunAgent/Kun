const { constants } = require('node:fs')
const { randomUUID } = require('node:crypto')
const { lstat, mkdir, open, realpath, rename, rm, writeFile } = require('node:fs/promises')
const { dirname, isAbsolute, join, relative, resolve, sep } = require('node:path')
const { pathToFileURL } = require('node:url')

const RESOURCE_PATH = ['kun', 'dist', 'resources', 'github-app-client.json']

/** Publisher input is a private file, never a token pasted into user settings or a secret environment value. */
async function prepareGitHubAppResource(input, dependencies = {}) {
  try {
    const projectDir = await realpath(resolve(input.projectDir))
    const target = join(projectDir, ...RESOURCE_PATH)
    await assertDirectory(dirname(target), projectDir)
    await rm(target, { force: true })
    if (!input.enabled || input.enabled === '0') return { enabled: false }
    if (input.enabled !== '1' || !input.sourcePath) throw failure()
    const source = await realpath(resolve(input.sourcePath))
    const location = relative(projectDir, source)
    if (location !== '..' && !location.startsWith(`..${sep}`) && !isAbsolute(location)) throw failure()
    const file = await open(resolve(input.sourcePath), constants.O_RDONLY | constants.O_NOFOLLOW)
    let value
    try {
      const info = await file.stat()
      if (!info.isFile() || info.size < 1 || info.size > 4096) throw failure()
      const buffer = Buffer.alloc(4097)
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
      if (bytesRead > 4096) throw failure()
      value = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'))
    } finally { await file.close() }
    const schema = await (dependencies.loadSchema ?? (async () =>
      (await import(pathToFileURL(join(projectDir, 'kun/dist/github-app/config.js')).href)).GitHubAppConfigSchema))()
    const configured = schema.parse(value)
    await mkdir(dirname(target), { recursive: true })
    await assertDirectory(dirname(target), projectDir)
    const temporary = `${target}.${randomUUID()}.tmp`
    try {
      // Native-client shared secrets are extractable; PKCE binds each user's authorization code.
      // App private keys are never accepted by the strict configuration schema or copied here.
      await writeFile(temporary, JSON.stringify(configured) + '\n', { flag: 'wx', mode: 0o644 })
      await rename(temporary, target)
    } finally { await rm(temporary, { force: true }) }
    return { enabled: true, clientId: configured.clientId }
  } catch { throw failure() }
}
async function assertDirectory(path, root) {
  for (let current = path; current !== root; current = dirname(current)) {
    const entry = await lstat(current).catch((error) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (entry && (!entry.isDirectory() || entry.isSymbolicLink())) throw failure()
  }
}
function failure() { return new Error('GitHub App package configuration failed. Provide the Kun Desktop client configuration file outside Git; never include an app private key.') }
module.exports = { prepareGitHubAppResource, RESOURCE_PATH }
if (require.main === module) {
  prepareGitHubAppResource({ projectDir: join(__dirname, '..'), enabled: process.env.KUN_GITHUB_APP_RELEASE_ENABLED,
    sourcePath: process.env.KUN_GITHUB_APP_CLIENT_CONFIG_FILE }).then((result) => {
    console.log(result.enabled ? 'GitHub App client resource prepared.' : 'GitHub App client resource disabled.')
  }, () => { console.error(failure().message); process.exitCode = 1 })
}
