const { execFileSync } = require('node:child_process')
const { mkdirSync } = require('node:fs')
const { resolve } = require('node:path')
if (process.platform === 'darwin') {
  const root = resolve(__dirname, '..')
  mkdirSync(resolve(root, 'resources/native'), { recursive: true })
  const cache = resolve(root, '.cache/remote-desktop-swift')
  mkdirSync(cache, { recursive: true })
  const inputs = ['arm64', 'x86_64'].map(arch => {
    const output = resolve(cache, `remote-desktop-input-${arch}`)
    execFileSync('xcrun', ['swiftc', '-target', `${arch}-apple-macos13.0`, '-module-cache-path', resolve(cache, arch), '-O', resolve(root, 'native/remote-desktop/macos-input.swift'), '-o', output], { stdio: 'inherit' })
    return output
  })
  // Existing desktop releases also package Intel; the packaging hook thins this resource
  // to the target architecture. Runtime capability remains Apple Silicon only.
  execFileSync('xcrun', ['lipo', '-create', ...inputs, '-output', resolve(root, 'resources/native/remote-desktop-input')], { stdio: 'inherit' })
}
