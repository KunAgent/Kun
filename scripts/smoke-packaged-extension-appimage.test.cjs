'use strict'

const assert = require('node:assert/strict')
const {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const test = require('node:test')
const {
  _internals: { linuxElectronLauncherContent, linuxRealExecutableName }
} = require('./after-pack.cjs')
const {
  assertLinuxX64,
  createAppImageExtractionInvocation,
  createAppImageSmokeInvocation,
  inspectExtractedAppImageBundle,
  resolveSingleLinuxAppImage,
  runAppImageSmoke
} = require('./smoke-packaged-extension-appimage.cjs')

function temporaryDirectory(t, prefix = 'kun-appimage-smoke-test-') {
  const root = mkdtempSync(join(tmpdir(), prefix))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

function writeExtractedBundle(extractionDirectory) {
  const root = join(extractionDirectory, 'squashfs-root')
  const resources = join(root, 'resources')
  mkdirSync(resources, { recursive: true })
  writeFileSync(join(resources, 'app.asar'), 'asar')
  const executableName = 'kun-gui'
  writeFileSync(join(root, 'AppRun'), `#!/bin/sh\nBIN="$APPDIR/${executableName}"\n`)
  chmodSync(join(root, 'AppRun'), 0o755)
  writeFileSync(join(root, executableName), linuxElectronLauncherContent(executableName))
  chmodSync(join(root, executableName), 0o755)
  writeFileSync(
    join(root, linuxRealExecutableName(executableName)),
    Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00])
  )
  chmodSync(join(root, linuxRealExecutableName(executableName)), 0o755)
  writeFileSync(
    join(root, 'kun.desktop'),
    '[Desktop Entry]\nExec=AppRun --disable-setuid-sandbox --no-first-run %U\n'
  )
  return root
}

test('requires one exact non-symlink final Linux x64 AppImage artifact', (t) => {
  const dist = temporaryDirectory(t)
  assert.throws(() => resolveSingleLinuxAppImage(dist), /exactly one/)

  const appImage = join(dist, 'Kun-1.2.3-dev-4-linux-x86_64.AppImage')
  writeFileSync(appImage, 'appimage')
  writeFileSync(join(dist, 'Kun-1.2.3-linux-arm64.AppImage'), 'wrong arch')
  mkdirSync(join(dist, 'Kun-9.9.9-linux-x86_64.AppImage'))
  if (process.platform !== 'win32') {
    symlinkSync(appImage, join(dist, 'Kun-8.8.8-linux-x86_64.AppImage'))
  }
  assert.equal(resolveSingleLinuxAppImage(dist), appImage)

  writeFileSync(join(dist, 'Kun-2.0.0-linux-x86_64.AppImage'), 'stale artifact')
  assert.throws(() => resolveSingleLinuxAppImage(dist), /found 2/)
})

test('builds FUSE-free validation and direct-AppImage desktop invocations', () => {
  const extraction = createAppImageExtractionInvocation({
    appImage: '/release/Kun-1.2.3-linux-x86_64.AppImage',
    extractionDirectory: '/tmp/kun-appimage-extract',
    environment: {
      APPIMAGE_EXTRACT_AND_RUN: '1',
      ELECTRON_RUN_AS_NODE: '1',
      APPDIR: '/untrusted-appdir',
      APPIMAGE: '/untrusted-appimage',
      OWD: '/untrusted-owd'
    }
  })
  assert.equal(extraction.command, resolve('/release/Kun-1.2.3-linux-x86_64.AppImage'))
  assert.deepEqual(extraction.args, ['--appimage-extract'])
  assert.equal(extraction.options.cwd, resolve('/tmp/kun-appimage-extract'))
  assert.equal(extraction.options.shell, false)
  assert.equal(extraction.options.timeout, 120_000)
  assert.equal(extraction.options.killSignal, 'SIGKILL')
  assert.equal(extraction.options.env.APPIMAGE_EXTRACT_AND_RUN, undefined)
  assert.equal(extraction.options.env.ELECTRON_RUN_AS_NODE, undefined)
  assert.equal(extraction.options.env.APPDIR, undefined)
  assert.equal(extraction.options.env.APPIMAGE, undefined)
  assert.equal(extraction.options.env.OWD, undefined)

  const smoke = createAppImageSmokeInvocation({
    appImage: '/release/Kun-1.2.3-linux-x86_64.AppImage',
    resourcesDir: '/tmp/kun-appimage-extract/squashfs-root/resources',
    desktopSmokePath: '/repo/scripts/smoke-packaged-extension-desktop.cjs',
    environment: { ELECTRON_RUN_AS_NODE: '1' }
  })
  assert.equal(smoke.command, process.execPath)
  assert.deepEqual(smoke.args, [
    resolve('/repo/scripts/smoke-packaged-extension-desktop.cjs'),
    '--resources',
    resolve('/tmp/kun-appimage-extract/squashfs-root/resources'),
    '--desktop-executable',
    resolve('/release/Kun-1.2.3-linux-x86_64.AppImage')
  ])
  assert.equal(smoke.options.shell, false)
  assert.equal(smoke.options.timeout, undefined)
  assert.equal(smoke.options.killSignal, undefined)
  assert.equal(smoke.options.env.ELECTRON_RUN_AS_NODE, undefined)
  assert.equal(smoke.options.env.APPIMAGE_EXTRACT_AND_RUN, '1')
  assert.equal(smoke.options.env.APPDIR, undefined)
  assert.equal(smoke.options.env.APPIMAGE, undefined)
  assert.ok(!smoke.args.some((argument) => argument.endsWith('app.asar')))
})

test('extracts and validates before launching the final AppImage itself', (t) => {
  assert.doesNotThrow(() => assertLinuxX64('linux', 'x64'))
  assert.throws(() => assertLinuxX64('darwin', 'arm64'), /native linux\/x64/)
  assert.throws(() => assertLinuxX64('linux', 'arm64'), /native linux\/x64/)

  const dist = temporaryDirectory(t)
  const extractionDirectory = temporaryDirectory(t, 'kun-appimage-extraction-test-')
  const appImage = join(dist, 'Kun-1.2.3-linux-x86_64.AppImage')
  writeFileSync(appImage, 'appimage')
  chmodSync(appImage, 0o644)
  let desktopInvocation

  assert.throws(() => runAppImageSmoke({
    platform: 'linux',
    arch: 'x64',
    distDirectory: dist,
    extractionDirectory,
    spawnSyncCommand: (command, args, options) => {
      if (command === appImage) {
        assert.deepEqual(args, ['--appimage-extract'])
        assert.equal(options.shell, false)
        writeExtractedBundle(options.cwd)
        return { status: 0, signal: null }
      }
      desktopInvocation = { command, args, options }
      return { status: 9, signal: null }
    }
  }), /exit 9/)

  const extractedRoot = join(extractionDirectory, 'squashfs-root')
  assert.deepEqual(desktopInvocation.args.slice(-4), [
    '--resources',
    join(extractedRoot, 'resources'),
    '--desktop-executable',
    appImage
  ])
  assert.ok(!desktopInvocation.args.some((argument) => argument.endsWith('app.asar')))
  assert.equal(desktopInvocation.options.shell, false)
  assert.equal(desktopInvocation.options.env.APPIMAGE_EXTRACT_AND_RUN, '1')
  assert.equal(desktopInvocation.options.env.APPDIR, undefined)
  assert.equal(desktopInvocation.options.env.APPIMAGE, undefined)
  assert.equal(statSync(appImage).mode & 0o111, 0o111)
})

test('rejects a symlinked extracted AppRun before desktop launch', (t) => {
  if (process.platform === 'win32') return
  const dist = temporaryDirectory(t)
  const extractionDirectory = temporaryDirectory(t, 'kun-appimage-symlink-test-')
  const appImage = join(dist, 'Kun-1.2.3-linux-x86_64.AppImage')
  writeFileSync(appImage, 'appimage')
  let desktopLaunched = false

  assert.throws(() => runAppImageSmoke({
    platform: 'linux',
    arch: 'x64',
    distDirectory: dist,
    extractionDirectory,
    spawnSyncCommand: (_command, args, options) => {
      if (args[0] === '--appimage-extract') {
        const root = writeExtractedBundle(options.cwd)
        const outside = join(options.cwd, 'outside-AppRun')
        writeFileSync(outside, 'outside')
        rmSync(join(root, 'AppRun'))
        symlinkSync(outside, join(root, 'AppRun'))
      } else {
        desktopLaunched = true
      }
      return { status: 0, signal: null }
    }
  }), /must not be a symbolic link/)
  assert.equal(desktopLaunched, false)
})

test('rejects extracted paths outside the trusted extraction root', (t) => {
  const trusted = temporaryDirectory(t)
  const outside = temporaryDirectory(t)
  const outsideRoot = writeExtractedBundle(outside)
  assert.throws(
    () => inspectExtractedAppImageBundle(outsideRoot, { trustedRoot: trusted }),
    /escapes its trusted root/
  )
})

test('rejects symlinked extracted resources, app.asar, launcher, payload, and desktop entry', async (t) => {
  if (process.platform === 'win32') return
  for (const target of [
    'resources',
    'app.asar',
    'kun-gui',
    'kun-gui.electron-bin',
    'kun.desktop'
  ]) {
    await t.test(target, (subtest) => {
      const extraction = temporaryDirectory(subtest)
      const root = writeExtractedBundle(extraction)
      const original = target === 'app.asar'
        ? join(root, 'resources', target)
        : join(root, target)
      const outside = join(extraction, `outside-${target}`)
      rmSync(original, { recursive: true, force: true })
      if (target === 'resources') mkdirSync(outside)
      else writeFileSync(outside, target)
      symlinkSync(outside, original, target === 'resources' ? 'dir' : 'file')
      assert.throws(
        () => inspectExtractedAppImageBundle(root, { trustedRoot: extraction }),
        /must not be a symbolic link/
      )
    })
  }
})

test('requires executable AppRun and exact sandbox-safe desktop entry', async (t) => {
  await t.test('executable AppRun', (subtest) => {
    const extraction = temporaryDirectory(subtest)
    const root = writeExtractedBundle(extraction)
    chmodSync(join(root, 'AppRun'), 0o644)
    assert.throws(
      () => inspectExtractedAppImageBundle(root, { trustedRoot: extraction }),
      /AppRun is not executable/
    )
  })

  await t.test('one desktop entry', (subtest) => {
    const extraction = temporaryDirectory(subtest)
    const root = writeExtractedBundle(extraction)
    writeFileSync(
      join(root, 'other.desktop'),
      '[Desktop Entry]\nExec=AppRun --disable-setuid-sandbox --no-first-run %U\n'
    )
    assert.throws(
      () => inspectExtractedAppImageBundle(root, { trustedRoot: extraction }),
      /exactly one root-level AppImage desktop entry/
    )
  })

  await t.test('approved product launcher', (subtest) => {
    const extraction = temporaryDirectory(subtest)
    const root = writeExtractedBundle(extraction)
    writeFileSync(join(root, 'kun-gui'), '#!/bin/sh\nexec ./kun-gui.electron-bin "$@"\n')
    chmodSync(join(root, 'kun-gui'), 0o755)
    assert.throws(
      () => inspectExtractedAppImageBundle(root, { trustedRoot: extraction }),
      /not the approved sandbox wrapper/
    )
  })

  for (const exec of [
    'Exec=AppRun --no-sandbox --no-first-run %U',
    'Exec=AppRun --no-first-run %U',
    'Exec=AppRun --no-first-run --disable-setuid-sandbox %U',
    'Exec=NotAppRun --disable-setuid-sandbox --no-first-run %U'
  ]) {
    await t.test(exec, (subtest) => {
      const extraction = temporaryDirectory(subtest)
      const root = writeExtractedBundle(extraction)
      writeFileSync(join(root, 'kun.desktop'), `[Desktop Entry]\n${exec}\n`)
      assert.throws(
        () => inspectExtractedAppImageBundle(root, { trustedRoot: extraction }),
        /must use exactly/
      )
    })
  }
})
