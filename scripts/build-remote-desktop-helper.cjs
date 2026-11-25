const { execFileSync } = require('node:child_process')
const { mkdirSync, cpSync, chmodSync } = require('node:fs')
const { resolve } = require('node:path')
const root = resolve(__dirname, '..')
const nativeDir = resolve(root, 'resources/native')
mkdirSync(nativeDir, { recursive: true })
if (process.platform === 'win32') {
  execFileSync('go', ['build', '-trimpath', '-ldflags', '-s -w', '-o', resolve(nativeDir, 'remote-desktop-input.exe'), '.'], {
    cwd: resolve(root, 'native/remote-desktop/windows'), env: { ...process.env, GOARCH: 'amd64', CGO_ENABLED: '0' }, stdio: 'inherit'
  })
} else if (process.platform === 'linux') {
  const target = resolve(nativeDir, 'linux-desktop')
  cpSync(resolve(root, 'native/remote-desktop/linux'), target, { recursive: true, filter: path => !path.includes('__pycache__') && !path.endsWith('_test.py') })
  chmodSync(resolve(target, 'desktop_input.py'), 0o755)
} else if (process.platform === 'darwin') {
  const cache = resolve(root, '.cache/remote-desktop-swift')
  mkdirSync(cache, { recursive: true })
  const inputs = ['arm64', 'x86_64'].map(arch => {
    const output = resolve(cache, `remote-desktop-input-${arch}`)
    const target = `${arch}-apple-macos13.0`, display = resolve(cache, `virtual-display-${arch}.o`)
    execFileSync('xcrun', ['clang', '-target', target, '-fobjc-arc', '-fmodules', '-O2', '-c', resolve(root, 'native/remote-desktop/macos-virtual-display.m'), '-o', display], { stdio: 'inherit' })
    const audio = resolve(cache, `system-audio-${arch}.o`)
    execFileSync('xcrun', ['clang', '-target', target, '-fobjc-arc', '-fmodules', '-O2', '-c', resolve(root, 'native/remote-desktop/macos-system-audio.m'), '-o', audio], { stdio: 'inherit' })
    const privacy = resolve(cache, `privacy-screen-${arch}.o`)
    execFileSync('xcrun', ['clang', '-target', target, '-fobjc-arc', '-fmodules', '-O2', '-c', resolve(root, 'native/remote-desktop/macos-privacy-screen.m'), '-o', privacy], { stdio: 'inherit' })
    execFileSync('xcrun', ['swiftc', '-target', target, '-module-cache-path', resolve(cache, arch), '-O', resolve(root, 'native/remote-desktop/macos-input.swift'), display, audio, privacy, '-framework', 'AppKit', '-framework', 'Carbon', '-framework', 'QuartzCore', '-framework', 'CoreVideo', '-framework', 'ScreenCaptureKit', '-framework', 'CoreMedia', '-framework', 'IOKit', '-framework', 'OpenDirectory', '-o', output], { stdio: 'inherit' })
    return output
  })
  // Existing desktop releases also package Intel; the packaging hook thins this resource
  // to the target architecture.
  execFileSync('xcrun', ['lipo', '-create', ...inputs, '-output', resolve(root, 'resources/native/remote-desktop-input')], { stdio: 'inherit' })
}
