const { createHash } = require('node:crypto')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

// Builder signs unpacked executables after afterPack. Hash the final bytes,
// not the compiler output, before NSIS consumes the application directory.
function finalizeWindowsStartup(context) {
  const arch = ({ 1: 'x64', 3: 'arm64' })[context.arch]
  if (!arch) throw new Error('Unsupported Windows startup helper architecture')
  const root = join(context.appOutDir, 'resources', 'app.asar.unpacked', 'kun', 'dist', 'native', `win32-${arch}`)
  const path = join(root, 'manifest.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  if (manifest.version !== 1 || manifest.arch !== arch) throw new Error('Windows startup helper manifest mismatch')
  const files = {}
  for (const name of ['kun_windows_startup.node', 'kun-owned-launcher.exe']) {
    files[name] = createHash('sha256').update(readFileSync(join(root, name))).digest('hex')
  }
  writeFileSync(path, JSON.stringify({ ...manifest, files }, null, 2) + '\n')
}

exports.default = async function afterSign(context) {
  if (context.electronPlatformName === 'win32') finalizeWindowsStartup(context)
  else await require('./mac-notarize.cjs').default(context)
}
exports.finalizeWindowsStartup = finalizeWindowsStartup
