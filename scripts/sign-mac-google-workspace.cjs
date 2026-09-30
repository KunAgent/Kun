const { join } = require('node:path')
const { readFileSync } = require('node:fs')
const { attestPackagedGoogleWorkspace } = require('./after-pack-google-workspace.cjs')

// @electron/osx-sign signs nested code first, then calls optionsForFile for the
// outer app. Record the final nested executable hash at that boundary so the
// manifest is covered by the app signature. Preserve all existing signer options,
// identity/keychain handling, verification, and electron-builder signing retries.
async function signMacGoogleWorkspace(options, _packager, dependencies = {}) {
  const sign = dependencies.sign || require('app-builder-lib/out/codeSign/macCodeSign').sign
  const attest = dependencies.attest || attestPackagedGoogleWorkspace
  const root = join(options.app, 'Contents', 'Resources', 'google-workspace')
  const selected = JSON.parse(readFileSync(join(root, 'selected.json'), 'utf8'))
  const originalOptionsForFile = options.optionsForFile
  let attested = false
  await sign({
    ...options,
    optionsForFile(file) {
      if (file === options.app) {
        attest(root, 'darwin', selected.arch)
        attested = true
      }
      return originalOptionsForFile ? originalOptionsForFile(file) : undefined
    }
  })
  if (!attested) throw new Error('macOS signer did not attest Google Workspace before sealing the app')
}

module.exports = signMacGoogleWorkspace
