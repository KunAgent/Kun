'use strict'
const { execFileSync } = require('node:child_process')
const { mkdirSync } = require('node:fs')
const { resolve } = require('node:path')

if (process.platform === 'darwin') {
  const root = resolve(__dirname, '..')
  const cache = resolve(root, '.cache/pet-activity-swift')
  mkdirSync(cache, { recursive: true })
  mkdirSync(resolve(root, 'resources/native'), { recursive: true })
  const inputs = ['arm64', 'x86_64'].map(arch => {
    const output = resolve(cache, `pet-activity-${arch}`)
    execFileSync('xcrun', ['swiftc', '-target', `${arch}-apple-macos13.0`,
      '-module-cache-path', resolve(cache, arch), '-O',
      resolve(root, 'native/pet-activity/macos-pet-activity.swift'), '-o', output], { stdio: 'inherit' })
    return output
  })
  execFileSync('xcrun', ['lipo', '-create', ...inputs, '-output', resolve(root, 'resources/native/pet-activity')], { stdio: 'inherit' })
}
