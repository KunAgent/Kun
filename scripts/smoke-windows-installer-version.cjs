'use strict'

const { createRequire } = require('node:module')

// Resolve the ASAR implementation through the same dependency used by electron-builder,
// even if npm installs app-builder-lib or @electron/asar in a nested node_modules.
const builderRequire = createRequire(require.resolve('electron-builder/package.json'))
const appBuilderRequire = createRequire(builderRequire.resolve('app-builder-lib/package.json'))
const { extractFile } = appBuilderRequire('@electron/asar')

function readInstalledAppVersion(archivePath) {
  if (!archivePath) throw new Error('An installed app.asar path is required.')
  const metadata = JSON.parse(extractFile(archivePath, 'package.json').toString('utf8'))
  const version = metadata?.version
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version)) {
    throw new Error('The installed app.asar has no valid package version.')
  }
  return version
}

if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw new Error('Expected one installed app.asar path.')
    process.stdout.write(`${readInstalledAppVersion(process.argv[2])}\n`)
  } catch (error) {
    console.error(`[installer-smoke] ${error.message}`)
    process.exitCode = 1
  }
}

module.exports = { readInstalledAppVersion }
