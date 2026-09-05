import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertArchitectureDescription,
  assertUpdateMetadata,
  linuxPackageNames,
  selectTargetNativeModules
} from './verify-linux-package-architecture.mjs'

function targetModules(arch) {
  return [
    '/app/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
    '/app/node_modules/node-pty/build/Release/pty.node',
    `/app/node_modules/@napi-rs/canvas-linux-${arch}-gnu/skia.linux-${arch}-gnu.node`,
    `/app/node_modules/@img/sharp-linux-${arch}/lib/sharp-linux-${arch}.node`,
    ...(arch === 'x64'
      ? ['/app/node_modules/@computer-use/libnut-linux/build/Release/libnut.node']
      : [])
  ]
}

test('maps canonical x64 and ARM64 Linux release artifacts', () => {
  assert.deepEqual(linuxPackageNames('1.2.3', 'x64'), {
    appImage: 'Kun-1.2.3-linux-x86_64.AppImage',
    deb: 'Kun-1.2.3-linux-amd64.deb',
    update: 'latest-linux.yml',
    unpacked: 'linux-unpacked'
  })
  assert.deepEqual(linuxPackageNames('1.2.3', 'arm64'), {
    appImage: 'Kun-1.2.3-linux-arm64.AppImage',
    deb: 'Kun-1.2.3-linux-arm64.deb',
    update: 'latest-linux-arm64.yml',
    unpacked: 'linux-arm64-unpacked'
  })
})

test('accepts only matching native architecture descriptions', () => {
  assert.doesNotThrow(() => assertArchitectureDescription('ELF 64-bit, ARM aarch64', 'arm64', 'fixture'))
  assert.doesNotThrow(() => assertArchitectureDescription('ELF 64-bit, x86-64', 'x64', 'fixture'))
  assert.throws(
    () => assertArchitectureDescription('ELF 64-bit, x86-64', 'arm64', 'fixture'),
    /is not Linux arm64/
  )
})

test('rejects cross-architecture Linux update metadata', () => {
  assert.doesNotThrow(() => assertUpdateMetadata(
    'files:\n  - url: Kun-1.2.3-linux-arm64.AppImage\n',
    'Kun-1.2.3-linux-arm64.AppImage',
    'arm64'
  ))
  assert.throws(() => assertUpdateMetadata(
    'files:\n  - url: Kun-1.2.3-linux-x86_64.AppImage\n',
    'Kun-1.2.3-linux-arm64.AppImage',
    'arm64'
  ), /does not reference/)
})

test('selects native modules used by the target Linux runtime', () => {
  const armModules = targetModules('arm64')
  const foreignOptionalPrebuild = '/app/node_modules/node-pty/prebuilds/win32-x64/pty.node'

  assert.deepEqual(
    selectTargetNativeModules([...armModules, foreignOptionalPrebuild], 'arm64'),
    armModules
  )
  assert.deepEqual(selectTargetNativeModules(targetModules('x64'), 'x64'), targetModules('x64'))
})

test('rejects the upstream x64-only libnut binding in an ARM64 package', () => {
  assert.throws(() => selectTargetNativeModules([
    ...targetModules('arm64'),
    '/app/node_modules/@computer-use/libnut-linux/build/Release/libnut.node'
  ], 'arm64'), /contains the upstream x64-only libnut binding/)
})

test('fails when a target-selected native module is missing', () => {
  assert.throws(
    () => selectTargetNativeModules(
      targetModules('arm64').filter((path) => !path.includes('better-sqlite3')),
      'arm64'
    ),
    /missing required better-sqlite3 native module/
  )
})
