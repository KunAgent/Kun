'use strict'

const assert = require('node:assert/strict')
const { mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { mkdtemp, readFile } = require('node:fs/promises')
const { createServer } = require('node:net')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const test = require('node:test')
const { parse: parseYaml } = require('yaml')
const {
  EXTENSION_ID,
  PACKAGED_EXTENSION_SMOKE_SUCCESS_MARKER,
  assertPackagedSmokeChildResult,
  installSmokeExtensionFixture,
  packagedResourceCandidates,
  resolvedPackagedResourceCandidates,
  smokeWebviewCsp
} = require('./smoke-packaged-extensions.cjs')
const {
  CdpConnection,
  CONTRIBUTION_ID,
  WEBVIEW_MARKER,
  assertGuestSecurityResult,
  createDesktopLaunchPlan,
  createIsolatedEnvironment,
  desktopApplicationEntry,
  desktopResourceCandidates,
  desktopSmokeSettings,
  desktopUserDataCandidates,
  findUnexpectedPopupTargets,
  isExtensionGuestTarget,
  isWorkbenchTarget,
  platformDesktopArguments,
  resolvedDesktopResourceCandidates,
  resolveDesktopLaunchSelection,
  runPackagedKun,
  terminateProcessTree,
  waitForPortsClosed
} = require('./smoke-packaged-extension-desktop.cjs')

const root = resolve(__dirname, '..')
const linuxUserNamespaceStepName = 'Prepare and verify Linux user namespace sandbox'
const linuxUserNamespaceSetup = [
  'if [[ -e /proc/sys/kernel/unprivileged_userns_clone ]]; then',
  '  sudo sysctl -w kernel.unprivileged_userns_clone=1',
  'fi',
  'if [[ -e /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]]; then',
  '  sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0',
  'fi',
  'unshare --user --map-root-user /bin/true'
].join('\n')

test('selects host-native packaged resources and never launches desktop Electron as Node', () => {
  assert.deepEqual(platformDesktopArguments('linux'), [
    '--disable-gpu',
    '--disable-dev-shm-usage'
  ])
  assert.equal(platformDesktopArguments('linux').includes('--disable-setuid-sandbox'), false)
  assert.equal(platformDesktopArguments('linux').includes('--no-sandbox'), false)
  assert.deepEqual(platformDesktopArguments('darwin'), [])
  assert.deepEqual(desktopResourceCandidates('darwin', 'arm64'), ['dist/mac-arm64/Kun.app/Contents/Resources'])
  assert.deepEqual(desktopResourceCandidates('darwin', 'x64'), ['dist/mac/Kun.app/Contents/Resources'])
  assert.deepEqual(desktopResourceCandidates('win32', 'x64'), ['dist/win-unpacked/resources'])
  assert.deepEqual(desktopResourceCandidates('linux', 'x64'), ['dist/linux-unpacked/resources'])
  assert.deepEqual(packagedResourceCandidates('darwin', 'arm64'), ['dist/mac-arm64/Kun.app/Contents/Resources'])
  assert.deepEqual(packagedResourceCandidates('darwin', 'x64'), ['dist/mac/Kun.app/Contents/Resources'])
  assert.deepEqual(resolvedPackagedResourceCandidates('darwin', 'arm64', '/workspace'), [
    '/workspace/dist/mac-arm64/Kun.app/Contents/Resources'
  ])
  assert.deepEqual(resolvedDesktopResourceCandidates('darwin', 'arm64', '/workspace'), [
    '/workspace/dist/mac-arm64/Kun.app/Contents/Resources'
  ])
  assert.equal(desktopApplicationEntry('/packaged/Resources', '/packaged/Kun', '/packaged/Kun'), undefined)
  assert.equal(
    desktopApplicationEntry('/packaged/Resources', '/host/Electron', '/packaged/Kun'),
    '/packaged/Resources/app.asar'
  )
  assert.equal(
    desktopSmokeSettings(43123, '/isolated-home/.kun/default_workspace').workspaceRoot,
    '/isolated-home/.kun/default_workspace'
  )
  assert.deepEqual(
    desktopUserDataCandidates({
      platform: 'linux',
      home: '/isolated-home',
      appData: '/isolated-app-data',
      explicitUserData: '/isolated-user-data'
    }),
    ['/isolated-user-data', '/isolated-app-data/Kun', '/isolated-home/.config/Kun']
  )

  const native = createDesktopLaunchPlan({
    executable: '/packaged/Kun',
    applicationArguments: ['--remote-debugging-port=12345'],
    environment: { ELECTRON_RUN_AS_NODE: '1', HOME: '/isolated' },
    platform: 'darwin',
    hasDisplay: false
  })
  assert.equal(native.command, '/packaged/Kun')
  assert.deepEqual(native.args, ['--remote-debugging-port=12345'])
  assert.equal(native.args.includes('--no-sandbox'), false)
  assert.equal(native.env.ELECTRON_RUN_AS_NODE, undefined)
  assert.equal(native.wrappedByXvfb, false)

  const linux = createDesktopLaunchPlan({
    executable: '/packaged/kun',
    applicationArguments: ['--remote-debugging-port=12345'],
    environment: { ELECTRON_RUN_AS_NODE: '1' },
    platform: 'linux',
    hasDisplay: false,
    xvfbExecutable: '/usr/bin/xvfb-run'
  })
  assert.equal(linux.command, '/usr/bin/xvfb-run')
  assert.deepEqual(linux.args, ['-a', '-s', '-screen 0 1280x900x24', '/packaged/kun', '--remote-debugging-port=12345'])
  assert.equal(linux.env.ELECTRON_RUN_AS_NODE, undefined)
  assert.equal(linux.wrappedByXvfb, true)

  const isolated = createIsolatedEnvironment(
    {
      PATH: '/system/bin',
      ELECTRON_RENDERER_URL: 'http://localhost:5173',
      ELECTRON_RUN_AS_NODE: '1',
      NODE_OPTIONS: '--require=/tmp/inject.cjs',
      KUN_RUNTIME_TOKEN: 'inherited-token',
      KUN_RUNTIME_PROVIDER_KIND: 'agent-sdk',
      KUN_CLAUDE_BINARY: '/tmp/claude',
      DEEPSEEK_API_KEY: 'inherited-secret',
      DEEPSEEK_GUI_STARTUP_TRACE: '1'
    },
    {
      home: '/isolated-home',
      appData: '/isolated-app-data',
      localAppData: '/isolated-local-app-data',
      temporaryDirectory: '/isolated-tmp'
    }
  )
  assert.equal(isolated.PATH, '/system/bin')
  assert.equal(isolated.HOME, '/isolated-home')
  assert.equal(isolated.NODE_ENV, 'production')
  assert.equal(isolated.KUN_PACKAGED_EXTENSION_DESKTOP_SMOKE, '1')
  for (const key of [
    'ELECTRON_RENDERER_URL',
    'ELECTRON_RUN_AS_NODE',
    'NODE_OPTIONS',
    'KUN_RUNTIME_TOKEN',
    'KUN_RUNTIME_PROVIDER_KIND',
    'KUN_CLAUDE_BINARY',
    'DEEPSEEK_API_KEY',
    'DEEPSEEK_GUI_STARTUP_TRACE'
  ]) {
    assert.equal(isolated[key], undefined, `desktop environment retained override ${key}`)
  }
})

test('selects an explicit self-contained desktop executable without replacing the CLI runtime', async (t) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'kun-desktop-executable-selection-test-'))
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }))
  const resourcesDir = join(temporaryRoot, 'resources')
  const runtimeExecutable = join(temporaryRoot, 'host-electron')
  const packagedRuntimeExecutable = join(temporaryRoot, 'packaged-kun')
  const appImage = join(temporaryRoot, 'Kun.AppImage')
  writeFileSync(appImage, 'self-contained AppImage fixture\n')

  assert.deepEqual(resolveDesktopLaunchSelection({
    resourcesDir,
    runtimeExecutable,
    packagedRuntimeExecutable,
    desktopExecutable: appImage
  }), {
    cliExecutable: runtimeExecutable,
    desktopExecutable: appImage,
    applicationEntry: undefined,
    selfContained: true
  })
})

test('rejects missing and non-file desktop executable overrides', async (t) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'kun-desktop-executable-validation-test-'))
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }))
  const input = {
    resourcesDir: join(temporaryRoot, 'resources'),
    runtimeExecutable: join(temporaryRoot, 'host-electron'),
    packagedRuntimeExecutable: join(temporaryRoot, 'packaged-kun')
  }

  assert.throws(
    () => resolveDesktopLaunchSelection({
      ...input,
      desktopExecutable: join(temporaryRoot, 'missing.AppImage')
    }),
    /Desktop executable does not exist/
  )

  const directory = join(temporaryRoot, 'directory.AppImage')
  mkdirSync(directory)
  assert.throws(
    () => resolveDesktopLaunchSelection({ ...input, desktopExecutable: directory }),
    /Desktop executable is not a file/
  )
})

test('launches an AppImage override through Xvfb without an external app.asar or inherited overrides', async (t) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'kun-appimage-launch-plan-test-'))
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }))
  const appImage = join(temporaryRoot, 'Kun.AppImage')
  writeFileSync(appImage, 'self-contained AppImage fixture\n')
  const selection = resolveDesktopLaunchSelection({
    resourcesDir: join(temporaryRoot, 'resources'),
    runtimeExecutable: join(temporaryRoot, 'host-electron'),
    packagedRuntimeExecutable: join(temporaryRoot, 'packaged-kun'),
    desktopExecutable: appImage
  })
  const launch = createDesktopLaunchPlan({
    executable: selection.desktopExecutable,
    applicationArguments: [
      ...(selection.applicationEntry ? [selection.applicationEntry] : []),
      '--remote-debugging-port=12345'
    ],
    environment: {
      HOME: '/isolated-home',
      APPIMAGE_EXTRACT_AND_RUN: '1',
      ELECTRON_RUN_AS_NODE: '1',
      NODE_OPTIONS: '--require=/tmp/inject.cjs'
    },
    platform: 'linux',
    hasDisplay: false,
    xvfbExecutable: '/usr/bin/xvfb-run'
  })

  assert.equal(selection.cliExecutable, join(temporaryRoot, 'host-electron'))
  assert.equal(launch.command, '/usr/bin/xvfb-run')
  assert.deepEqual(launch.args, [
    '-a',
    '-s',
    '-screen 0 1280x900x24',
    appImage,
    '--remote-debugging-port=12345'
  ])
  assert.equal(launch.args.some((argument) => argument.endsWith('app.asar')), false)
  assert.equal(launch.env.HOME, '/isolated-home')
  assert.equal(launch.env.APPIMAGE_EXTRACT_AND_RUN, '1')
  assert.equal(launch.env.ELECTRON_RUN_AS_NODE, undefined)
  assert.equal(launch.env.NODE_OPTIONS, undefined)
  assert.equal(launch.wrappedByXvfb, true)
})

test('preserves default explicit-host Electron launch with the packaged app.asar', () => {
  const resourcesDir = join(tmpdir(), 'packaged', 'resources')
  const runtimeExecutable = join(tmpdir(), 'host', 'Electron')
  const packagedRuntimeExecutable = join(tmpdir(), 'packaged', 'Kun')

  assert.deepEqual(resolveDesktopLaunchSelection({
    resourcesDir,
    runtimeExecutable,
    packagedRuntimeExecutable
  }), {
    cliExecutable: runtimeExecutable,
    desktopExecutable: runtimeExecutable,
    applicationEntry: join(resourcesDir, 'app.asar'),
    selfContained: false
  })
})

test('requires proof that the packaged runtime child completed the full smoke', () => {
  assert.doesNotThrow(() =>
    assertPackagedSmokeChildResult({
      error: undefined,
      status: 0,
      signal: null,
      stdout: `${PACKAGED_EXTENSION_SMOKE_SUCCESS_MARKER}darwin): complete\n`
    })
  )
  assert.throws(
    () =>
      assertPackagedSmokeChildResult({
        error: undefined,
        status: 0,
        signal: null,
        stdout: ''
      }),
    /required completion marker/
  )
  assert.throws(
    () =>
      assertPackagedSmokeChildResult({
        error: undefined,
        status: null,
        signal: 'SIGKILL',
        stdout: ''
      }),
    /SIGKILL/
  )
})

test('exports and installs the shared .kunx smoke fixture with a Chromium body marker', async (t) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'kun-desktop-smoke-fixture-test-'))
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }))
  const profile = join(temporaryRoot, 'profile')
  const calls = []
  const installedRoot = join(profile, 'extensions', EXTENSION_ID, '1.0.0')

  const fixture = await installSmokeExtensionFixture({
    temporaryRoot,
    profile,
    webviewConnectUrls: ['http://127.0.0.1:43123/extension-network-canary'],
    runCli: (args) => {
      calls.push(args)
      if (args[1] !== 'install') return
      mkdirSync(join(installedRoot, 'dist', 'webview'), { recursive: true })
      writeFileSync(join(installedRoot, 'kun-extension.json'), '{}\n')
      writeFileSync(join(installedRoot, 'dist', 'webview', 'index.html'), '<main>installed</main>\n')
    }
  })

  assert.equal(fixture.installedRoot, installedRoot)
  assert.deepEqual(
    calls.map((args) => args[1]),
    ['validate', 'pack', 'install']
  )
  const sourceWebview = await readFile(join(fixture.source, 'dist', 'webview', 'index.html'), 'utf8')
  assert.match(sourceWebview, /data-kun-packaged-webview-smoke="ready"/)
  assert.match(sourceWebview, new RegExp(WEBVIEW_MARKER))
  assert.match(sourceWebview, /connect-src http:\/\/127\.0\.0\.1:43123/)
  assert.equal(smokeWebviewCsp(), "default-src 'none'; style-src 'self'; connect-src 'none'")
  assert.throws(() => smokeWebviewCsp(['https://example.com']), /explicit loopback origin/)
})

test('recognizes the workbench and kun-extension guest CDP targets', () => {
  assert.equal(CONTRIBUTION_ID, 'extension:kun-smoke.packaged/smoke')
  assert.equal(
    isWorkbenchTarget({
      type: 'page',
      url: 'file:///Applications/Kun.app/Contents/Resources/app.asar/out/renderer/index.html'
    }),
    true
  )
  assert.equal(
    isWorkbenchTarget({
      type: 'page',
      url: 'file:///app/out/renderer/index.html'
    }),
    false
  )
  assert.equal(isWorkbenchTarget({ type: 'page', url: 'http://localhost:5173/' }), false)
  assert.equal(isWorkbenchTarget({ type: 'page', url: 'http://127.0.0.1:5173/' }), false)
  assert.equal(
    isWorkbenchTarget({
      type: 'webview',
      url: `kun-extension://${EXTENSION_ID}/index.html`
    }),
    false
  )
  assert.equal(
    isExtensionGuestTarget({
      targetId: 'guest-1',
      type: 'webview',
      url: `kun-extension://${EXTENSION_ID}/dist/webview/index.html?kunViewSession=123`
    }),
    true
  )
  assert.equal(
    isExtensionGuestTarget({
      targetId: 'guest-2',
      type: 'webview',
      url: 'kun-extension://other.example/index.html'
    }),
    false
  )
  assert.equal(
    isExtensionGuestTarget({
      targetId: 'guest-3',
      type: 'page',
      url: `kun-extension://${EXTENSION_ID}/dist/webview/index.html?kunViewSession=123`
    }),
    false
  )
  assert.equal(
    isExtensionGuestTarget({
      targetId: 'guest-4',
      type: 'webview',
      url: `kun-extension://${EXTENSION_ID}/dist/webview/index.html`
    }),
    false
  )
  assert.equal(
    isExtensionGuestTarget({
      targetId: 'guest-5',
      type: 'webview',
      url: `kun-extension://${EXTENSION_ID}/dist/webview/index.html?kunViewSession=123&extra=1`
    }),
    false
  )
})

test('routes flattened CDP commands and rejects protocol errors', async () => {
  const socket = new FakeWebSocket()
  const cdp = new CdpConnection(socket, 1_000)
  const events = []
  const stop = cdp.onEvent('Target.targetCreated', (params, message) => {
    events.push({ params, sessionId: message.sessionId })
  })
  socket.emit('message', {
    data: JSON.stringify({
      method: 'Target.targetCreated',
      params: { targetInfo: { targetId: 'popup-1' } },
      sessionId: 'browser-session'
    })
  })
  assert.deepEqual(events, [
    {
      params: { targetInfo: { targetId: 'popup-1' } },
      sessionId: 'browser-session'
    }
  ])
  stop()
  socket.emit('message', {
    data: JSON.stringify({
      method: 'Target.targetCreated',
      params: { targetInfo: { targetId: 'popup-2' } }
    })
  })
  assert.equal(events.length, 1)
  socket.onSend = (payload) => {
    if (payload.method === 'Target.getTargets') {
      socket.emit('message', {
        data: JSON.stringify({
          id: payload.id,
          result: { targetInfos: [{ targetId: 'page-1' }] }
        })
      })
      return
    }
    socket.emit('message', {
      data: JSON.stringify({
        id: payload.id,
        error: { code: -32601, message: 'unknown method' }
      })
    })
  }

  assert.deepEqual(await cdp.send('Target.getTargets', {}, 'browser-session'), {
    targetInfos: [{ targetId: 'page-1' }]
  })
  assert.equal(socket.sent[0].sessionId, 'browser-session')
  await assert.rejects(cdp.send('Missing.method'), /unknown method/)
  cdp.close()
})

test('detects a user-gesture popup target even when it changes URL after creation', () => {
  const popupUrl = 'http://127.0.0.1:43123/extension-popup-canary'
  assert.deepEqual(
    findUnexpectedPopupTargets({
      beforeTargetIds: new Set(['workbench', 'guest', 'old-popup']),
      observedTargets: [
        {
          targetId: 'popup-1',
          type: 'page',
          url: '',
          openerId: 'guest'
        }
      ],
      targetsAfter: [
        { targetId: 'popup-1', type: 'page', url: popupUrl, openerId: 'guest' },
        {
          targetId: 'old-popup',
          type: 'page',
          url: popupUrl,
          openerId: 'guest'
        },
        { targetId: 'background', type: 'page', url: 'about:blank' }
      ],
      guestTargetId: 'guest',
      popupUrl
    }),
    [
      {
        targetId: 'popup-1',
        type: 'page',
        url: popupUrl,
        openerId: 'guest'
      }
    ]
  )
})

test('fails closed unless the guest exposes only the narrow bridge and blocked browser egress', () => {
  const secure = {
    href: `kun-extension://${EXTENSION_ID}/dist/webview/index.html?kunViewSession=view-123`,
    marker: WEBVIEW_MARKER,
    bridgeMethods: ['request', 'notify', 'onNotification', 'registerHandler', 'dispose'],
    bridgeOwnKeys: ['dispose', 'notify', 'onNotification', 'registerHandler', 'request'].map((name) => ({
      kind: 'string',
      name
    })),
    bridgeRequestMode: 'ok',
    theme: {
      kind: 'dark',
      tokens: { foreground: '#ffffff' },
      zoomFactor: 1,
      reducedMotion: false
    },
    viewStateRoundTripMode: 'ok',
    viewState: {
      found: true,
      value: {
        schemaVersion: 1,
        marker: 'packaged-desktop-view-state-round-trip',
        nested: { count: 1, enabled: true }
      }
    },
    hasKunGui: false,
    hasElectron: false,
    hasIpcRenderer: false,
    hasBuffer: false,
    hasRequire: false,
    hasProcess: false,
    fetchMode: 'rejected',
    popupMode: 'denied',
    popupTargets: []
  }
  assert.doesNotThrow(() => assertGuestSecurityResult(secure))
  assert.throws(() => assertGuestSecurityResult({ ...secure, hasKunGui: true }), /privileged window\.kunGui/)
  assert.throws(
    () =>
      assertGuestSecurityResult({
        ...secure,
        bridgeOwnKeys: [...secure.bridgeOwnKeys, { kind: 'symbol', name: 'hidden' }]
      }),
    /unexpected own keys/
  )
  assert.throws(
    () => assertGuestSecurityResult({ ...secure, bridgeRequestMode: 'rejected' }),
    /request round-trip failed/
  )
  assert.throws(() => assertGuestSecurityResult({ ...secure, hasIpcRenderer: true }), /ipcRenderer/)
  assert.throws(
    () =>
      assertGuestSecurityResult({
        ...secure,
        theme: { ...secure.theme, zoomFactor: 0 }
      }),
    /zoomFactor/
  )
  assert.throws(
    () =>
      assertGuestSecurityResult({
        ...secure,
        viewState: { found: true, value: { marker: 'forged' } }
      }),
    /View-state round-trip failed/
  )
  assert.throws(
    () => assertGuestSecurityResult({ ...secure, fetchMode: 'allowed' }),
    /loopback fetch was not rejected by the Host filter/
  )
  assert.throws(() => assertGuestSecurityResult({ ...secure, popupMode: 'allowed' }), /window\.open was not blocked/)
  assert.throws(
    () =>
      assertGuestSecurityResult({
        ...secure,
        popupTargets: [{ targetId: 'popup-1', type: 'page', url: 'about:blank' }]
      }),
    /created a CDP target/
  )
  assert.throws(() => assertGuestSecurityResult(secure, 1), /network canary/)
})

test('bounds synchronous packaged CLI subprocesses', () => {
  assert.throws(
    () => runPackagedKun(process.execPath, '-e', ['setInterval(() => {}, 1_000)'], process.env, 50),
    /timed out after 50 ms/
  )
})

test('verifies ports without signalling a stale launcher PID', async () => {
  let groupSignals = 0
  let childSignals = 0
  let verifiedPorts
  const exitedChild = {
    pid: 4242,
    exitCode: 0,
    signalCode: null,
    kill: () => {
      childSignals += 1
      return true
    }
  }
  await terminateProcessTree(exitedChild, 'linux', {
    ports: [18788, 18899],
    killProcessGroup: () => {
      groupSignals += 1
    },
    verifyPortsClosed: async (ports) => {
      verifiedPorts = ports
    }
  })
  assert.equal(groupSignals, 0)
  assert.equal(childSignals, 0)
  assert.deepEqual(verifiedPorts, [18788, 18899])
})

test('bounds Windows process-tree cleanup through taskkill', async () => {
  const child = { pid: 4243, exitCode: null, signalCode: null }
  let invocation
  await terminateProcessTree(child, 'win32', {
    timeoutMs: 2_000,
    ports: [18899],
    spawnSyncCommand: (command, args, options) => {
      invocation = { command, args, options }
      child.exitCode = 0
      return { status: 0 }
    },
    verifyPortsClosed: async () => undefined
  })
  assert.equal(invocation.command, 'taskkill')
  assert.deepEqual(invocation.args, ['/pid', '4243', '/t', '/f'])
  assert.ok(invocation.options.timeout > 0 && invocation.options.timeout <= 2_000)
  assert.equal(invocation.options.killSignal, 'SIGKILL')
})

test('fails cleanup while a managed loopback port remains open', async (t) => {
  const server = createServer()
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  t.after(() => {
    if (server.listening) server.close()
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  assert.notEqual(port, 0)
  await assert.rejects(waitForPortsClosed([port], 25), /left isolated loopback port/)
  await new Promise((resolvePromise, reject) => {
    server.close((error) => (error ? reject(error) : resolvePromise()))
  })
  await assert.doesNotReject(waitForPortsClosed([port], 500))
})

test('every automated and local release path gates uploads behind packaged Extension smokes', () => {
  const release = parseYaml(readFileSync(join(root, '.github', 'workflows', 'release.yml'), 'utf8'))
  const daily = parseYaml(readFileSync(join(root, '.github', 'workflows', 'daily-dev-prerelease.yml'), 'utf8'))
  const pr = parseYaml(readFileSync(join(root, '.github', 'workflows', 'pr-checks.yml'), 'utf8'))
  const desktopCommand = 'npm run smoke:packaged-extension-desktop'
  const appImageDesktopCommand = 'npm run smoke:packaged-extension-appimage'
  const nativeEvidenceCommand = 'npm run evidence:extension-native'

  assertPublishDependencies(release, 'stable release')
  assertPublishDependencies(daily, 'daily prerelease')

  assertOrderedCommands(release.jobs['build-macos'], [
    'npm run smoke:packaged-extensions -- --resources dist/mac/Kun.app/Contents/Resources',
    'npm run smoke:packaged-extensions -- --resources dist/mac-arm64/Kun.app/Contents/Resources',
    desktopCommand,
    nativeEvidenceCommand
  ])
  assertStepAfter(release.jobs['build-macos'], 'Upload macOS artifacts', nativeEvidenceCommand)
  assertOrderedCommands(release.jobs['build-windows'], [
    'npm run smoke:packaged-extensions -- --resources dist/win-unpacked/resources',
    desktopCommand,
    nativeEvidenceCommand
  ])
  assertStepAfter(release.jobs['build-windows'], 'Upload Windows artifacts', nativeEvidenceCommand)
  assertOrderedCommands(release.jobs['build-linux'], [
    'npm run smoke:packaged-extensions -- --resources dist/linux-unpacked/resources',
    'unshare --user --map-root-user /bin/true',
    desktopCommand,
    appImageDesktopCommand,
    nativeEvidenceCommand
  ])
  assertStepAfter(release.jobs['build-linux'], 'Upload Linux artifacts', nativeEvidenceCommand)
  assertOrderedCommands(pr.jobs.package, [
    'npm run smoke:packaged-extensions -- --resources dist/linux-unpacked/resources',
    'unshare --user --map-root-user /bin/true',
    desktopCommand,
    appImageDesktopCommand,
    nativeEvidenceCommand
  ])
  assertStepAfter(pr.jobs.package, 'Upload Linux package', nativeEvidenceCommand)
  assertOrderedCommands(pr.jobs['package-macos'], [
    'npm run dist:mac',
    'npm run smoke:packaged-extensions -- --resources dist/mac/Kun.app/Contents/Resources',
    'npm run smoke:packaged-extensions -- --resources dist/mac-arm64/Kun.app/Contents/Resources',
    desktopCommand,
    nativeEvidenceCommand
  ])
  assertStepAfter(pr.jobs['package-macos'], 'Upload ad-hoc macOS PR packages', nativeEvidenceCommand)
  assertOrderedCommands(pr.jobs['package-windows'], [
    'npm run dist:win',
    'npm run smoke:packaged-extensions -- --resources dist/win-unpacked/resources',
    desktopCommand,
    nativeEvidenceCommand
  ])
  assertStepAfter(pr.jobs['package-windows'], 'Upload Windows PR package', nativeEvidenceCommand)
  assertOrderedCommands(daily.jobs['build-macos'], [
    'npm run check:extension-release-gate',
    'npm run dist:mac',
    'npm run smoke:packaged-extensions -- --resources dist/mac/Kun.app/Contents/Resources',
    'npm run smoke:packaged-extensions -- --resources dist/mac-arm64/Kun.app/Contents/Resources',
    desktopCommand,
    nativeEvidenceCommand
  ])
  assertStepAfter(daily.jobs['build-macos'], 'Upload macOS artifacts', nativeEvidenceCommand)
  assertOrderedCommands(daily.jobs['build-windows'], [
    'npm run check:extension-release-gate',
    'npm run dist:win',
    'npm run smoke:packaged-extensions -- --resources dist/win-unpacked/resources',
    desktopCommand,
    nativeEvidenceCommand
  ])
  assertStepAfter(daily.jobs['build-windows'], 'Upload Windows artifacts', nativeEvidenceCommand)
  assertOrderedCommands(daily.jobs['build-linux'], [
    'npm run check:extension-release-gate',
    'npm run dist:linux',
    'npm run smoke:packaged-extensions -- --resources dist/linux-unpacked/resources',
    'unshare --user --map-root-user /bin/true',
    desktopCommand,
    appImageDesktopCommand,
    nativeEvidenceCommand
  ])
  assertStepAfter(daily.jobs['build-linux'], 'Upload Linux artifacts', nativeEvidenceCommand)
  for (const jobId of ['build-macos', 'build-windows', 'build-linux']) {
    assert.equal(release.jobs[jobId]['timeout-minutes'], 90, `${jobId} must have a bounded timeout`)
    assert.equal(daily.jobs[jobId]['timeout-minutes'], 90, `daily ${jobId} must have a bounded timeout`)
  }
  assert.equal(pr.jobs.package['timeout-minutes'], 60, 'PR Linux package job must have a bounded timeout')
  assert.equal(pr.jobs['package-macos']['timeout-minutes'], 90, 'PR macOS package job must have a bounded timeout')
  assert.equal(pr.jobs['package-windows']['timeout-minutes'], 90, 'PR Windows package job must have a bounded timeout')
  for (const jobId of ['package', 'package-macos', 'package-windows']) {
    const needs = Array.isArray(pr.jobs[jobId].needs) ? pr.jobs[jobId].needs : [pr.jobs[jobId].needs]
    assert.ok(needs.includes('test'), `${jobId} must depend on the test gate`)
  }
  for (const [label, job] of [
    ['release Linux', release.jobs['build-linux']],
    ['daily Linux', daily.jobs['build-linux']],
    ['PR Linux', pr.jobs.package]
  ]) {
    const step = job.steps.find((candidate) => candidate.name === 'Smoke final Linux AppImage desktop Chromium')
    assert.equal(step?.run, appImageDesktopCommand, `${label} must run the final AppImage smoke`)
    assert.equal(step?.['timeout-minutes'], 10, `${label} AppImage smoke must be bounded`)
    assert.equal(step?.if, undefined, `${label} AppImage smoke must not be conditional`)
    assert.ok(
      step?.['continue-on-error'] === undefined || step['continue-on-error'] === false,
      `${label} AppImage smoke must fail closed`
    )
    const userNamespaceStep = job.steps.find(
      (candidate) => candidate.name === linuxUserNamespaceStepName
    )
    assert.equal(userNamespaceStep?.run?.trim(), linuxUserNamespaceSetup)
    assert.equal(userNamespaceStep?.if, undefined)
    assert.ok(
      userNamespaceStep?.['continue-on-error'] === undefined ||
        userNamespaceStep['continue-on-error'] === false,
      `${label} user namespace verification must fail closed`
    )
    assert.doesNotMatch(userNamespaceStep?.run ?? '', /\bdist\b|\$\{\{|AppImage|chown|chmod/)
  }
  for (const [label, job, evidenceFile] of [
    ['release macOS', release.jobs['build-macos'], 'extension-native-evidence-darwin.json'],
    ['release Windows', release.jobs['build-windows'], 'extension-native-evidence-win32.json'],
    ['release Linux', release.jobs['build-linux'], 'extension-native-evidence-linux.json'],
    ['daily macOS', daily.jobs['build-macos'], 'extension-native-evidence-darwin.json'],
    ['daily Windows', daily.jobs['build-windows'], 'extension-native-evidence-win32.json'],
    ['daily Linux', daily.jobs['build-linux'], 'extension-native-evidence-linux.json'],
    ['PR macOS', pr.jobs['package-macos'], 'extension-native-evidence-darwin.json'],
    ['PR Windows', pr.jobs['package-windows'], 'extension-native-evidence-win32.json'],
    ['PR Linux', pr.jobs.package, 'extension-native-evidence-linux.json']
  ]) {
    const evidenceStep = job.steps.find((candidate) => candidate.run === nativeEvidenceCommand)
    assert.ok(evidenceStep, `${label} must record native artifact evidence`)
    assert.equal(evidenceStep.if, undefined, `${label} native evidence must not be conditional`)
    assert.ok(
      evidenceStep['continue-on-error'] === undefined || evidenceStep['continue-on-error'] === false,
      `${label} native evidence must fail closed`
    )
    const upload = job.steps.find((candidate) => String(candidate.name).startsWith('Upload '))
    assert.match(String(upload?.with?.path ?? ''), new RegExp(evidenceFile.replace('.', '\\.')))
  }

  const prFailureNeeds = Array.isArray(pr.jobs['request-changes-on-failure'].needs)
    ? pr.jobs['request-changes-on-failure'].needs
    : [pr.jobs['request-changes-on-failure'].needs]
  for (const jobId of ['test', 'package', 'package-macos', 'package-windows']) {
    assert.ok(prFailureNeeds.includes(jobId), `PR failure review must depend on ${jobId}`)
  }

  const releaseLinuxDependencies =
    release.jobs['build-linux'].steps.find((step) => step.name === 'Install Linux packaging dependencies')?.run ?? ''
  const prLinuxDependencies =
    pr.jobs.package.steps.find((step) => step.name === 'Install Linux packaging dependencies')?.run ?? ''
  const dailyLinuxDependencies =
    daily.jobs['build-linux'].steps.find((step) => step.name === 'Install Linux packaging dependencies')?.run ?? ''
  assert.match(releaseLinuxDependencies, /\bxvfb\b/)
  assert.match(prLinuxDependencies, /\bxvfb\b/)
  assert.match(dailyLinuxDependencies, /\bxvfb\b/)
  assert.match(dailyLinuxDependencies, /\bxauth\b/)
  assert.match(releaseLinuxDependencies, /\butil-linux\b/)
  assert.match(prLinuxDependencies, /\butil-linux\b/)
  assert.match(dailyLinuxDependencies, /\butil-linux\b/)

  const releaseMac = readFileSync(join(root, 'scripts', 'release-mac.sh'), 'utf8')
  assertOrderedSourceMarkers(releaseMac, [
    'npm run check:extension-release-gate || die "Extension public release gate failed"',
    '\nbuild_macos\n',
    '\nsmoke_macos_extensions\n',
    '\nrelease_write_meta_file\n',
    'gh release create "${TAG_NAME}"'
  ])
  assertOrderedSourceMarkers(releaseMac, [
    'npm run smoke:packaged-extensions -- --resources "${x64_resources}"',
    '|| die "macOS x64 packaged Extension Node runtime smoke failed"',
    'npm run smoke:packaged-extensions -- --resources "${arm64_resources}"',
    '|| die "macOS arm64 packaged Extension Node runtime smoke failed"',
    'npm run smoke:packaged-extension-desktop -- --resources "${host_resources}"',
    '|| die "macOS packaged Extension desktop Chromium smoke failed"'
  ])
  assertSourceMarkersAfter(releaseMac, '\nsmoke_macos_extensions\n', [
    'gh release create "${TAG_NAME}"',
    'gh release upload "${tag}"',
    'publish-r2.mjs" upload --platform mac',
    'publish-r2.mjs" promote --tag'
  ])

  const releaseWin = readFileSync(join(root, 'scripts', 'release-win.sh'), 'utf8')
  assertOrderedSourceMarkers(releaseWin, [
    'npm run check:extension-release-gate || die "Extension public release gate failed"',
    'npm run dist:win || die "Windows build failed"',
    'npm run smoke:packaged-extensions -- --resources dist/win-unpacked/resources',
    '|| die "Windows packaged Extension Node runtime smoke failed"',
    desktopCommand,
    '|| die "Windows packaged Extension desktop Chromium smoke failed"',
    'gh release upload "${TAG_NAME}"'
  ])
  assertSourceMarkersAfter(releaseWin, desktopCommand, [
    'gh release upload "${TAG_NAME}"',
    'publish-r2.mjs" upload --platform win',
    'publish-r2.mjs" promote --tag',
    'gh release edit "${TAG_NAME}" --draft=false'
  ])

  const releaseWinPowerShell = readFileSync(join(root, 'scripts', 'release-win.ps1'), 'utf8')
  assertOrderedSourceMarkers(releaseWinPowerShell, [
    '& npm run check:extension-release-gate',
    "Write-Err 'Extension public release gate failed.'",
    '& npm run dist:win',
    '& npm run smoke:packaged-extensions -- --resources dist/win-unpacked/resources',
    "Write-Err 'Windows packaged Extension Node runtime smoke failed.'",
    '& npm run smoke:packaged-extension-desktop',
    "Write-Err 'Windows packaged Extension desktop Chromium smoke failed.'",
    '& gh release upload $TagName'
  ])
  assertSourceMarkersAfter(releaseWinPowerShell, '& npm run smoke:packaged-extension-desktop', [
    '& gh release upload $TagName',
    "'scripts\\publish-r2.mjs') upload --platform win",
    "'scripts\\publish-r2.mjs') promote --tag",
    '& gh release edit $TagName --draft=false'
  ])

  for (const wrapper of ['release.sh', 'release-all-mac.sh']) {
    const source = readFileSync(join(root, 'scripts', wrapper), 'utf8')
    assert.match(source, /exec "\$\{ROOT\}\/scripts\/release-mac\.sh"/)
    assert.doesNotMatch(source, /gh release upload|publish-r2\.mjs/)
  }

  const desktopSource = readFileSync(join(root, 'scripts', 'smoke-packaged-extension-desktop.cjs'), 'utf8')
  assert.match(desktopSource, /Target\.getTargets/)
  assert.match(desktopSource, /Input\.dispatchMouseEvent/)
  assert.match(desktopSource, /data-contribution-id/)
  assert.match(desktopSource, /Page\.setBypassCSP/)
  assert.match(desktopSource, /Reflect\.ownKeys/)
  assert.match(desktopSource, /userGesture: true/)
  assert.match(desktopSource, /ui\.setViewState/)
  assert.match(desktopSource, /waitForPortsClosed/)

  const appImageSource = readFileSync(join(root, 'scripts', 'smoke-packaged-extension-appimage.cjs'), 'utf8')
  const afterPackSource = readFileSync(join(root, 'scripts', 'after-pack.cjs'), 'utf8')
  const builderConfig = readFileSync(join(root, 'electron-builder.config.cjs'), 'utf8')
  assert.match(appImageSource, /--appimage-extract/)
  assert.match(appImageSource, /squashfs-root/)
  assert.match(appImageSource, /inspectExtractedAppImageBundle/)
  assert.match(appImageSource, /--desktop-executable/)
  assert.match(appImageSource, /candidates\.length !== 1/)
  assert.match(appImageSource, /shell: false/)
  assert.match(appImageSource, /APPIMAGE_EXTRACT_AND_RUN/)
  assert.match(appImageSource, /Exec=AppRun --disable-setuid-sandbox --no-first-run %U/)
  assert.match(appImageSource, /linuxElectronLauncherContent/)
  assert.match(appImageSource, /launcherContent\.includes\('--no-sandbox'\)/)
  assert.match(afterPackSource, /installLinuxElectronLauncher/)
  assert.match(afterPackSource, /ELECTRON_RUN_AS_NODE/)
  assert.match(
    afterPackSource,
    /exec "\$real_executable" \$\{LINUX_SANDBOX_LAUNCHER_FLAG\} "\$@"/
  )
  assert.doesNotMatch(afterPackSource, /--no-sandbox/)
  assert.match(
    builderConfig,
    /executableArgs: \['--disable-setuid-sandbox', '--no-first-run'\]/
  )
  assert.doesNotMatch(builderConfig, /--no-sandbox/)
  assert.doesNotMatch(desktopSource, /'--no-sandbox'/)
  assert.doesNotMatch(desktopSource, /'--disable-setuid-sandbox'/)
})

function assertOrderedCommands(job, commands) {
  const runs = job.steps
    .filter((step) => typeof step.run === 'string')
    .flatMap((step) => step.run.split(/\r?\n/).map((line) => line.trim()))
  let prior = -1
  for (const command of commands) {
    const index = runs.findIndex((line, candidate) => candidate > prior && line === command)
    assert.notEqual(index, -1, `missing ordered workflow command: ${command}`)
    prior = index
  }
}

function assertStepAfter(job, stepName, priorCommand) {
  const steps = job.steps ?? []
  const priorIndex = steps.findIndex(
    (step) =>
      typeof step.run === 'string' &&
      step.run.split(/\r?\n/).some((line) => line.trim() === priorCommand)
  )
  const stepIndex = steps.findIndex(
    (step, candidateIndex) =>
      candidateIndex > priorIndex &&
      step.name === stepName &&
      step.if === undefined &&
      (step['continue-on-error'] === undefined || step['continue-on-error'] === false)
  )
  assert.ok(priorIndex >= 0 && stepIndex > priorIndex, `${stepName} must run after ${priorCommand}`)
}

function assertPublishDependencies(workflow, label) {
  const publish = workflow.jobs?.publish
  assert.ok(publish, `${label} must define a publish job`)
  const needs = Array.isArray(publish.needs) ? publish.needs : [publish.needs].filter(Boolean)
  for (const dependency of ['prepare', 'build-macos', 'build-windows', 'build-linux']) {
    assert.ok(needs.includes(dependency), `${label} publish job must depend on ${dependency}`)
  }
  assert.equal(publish.if, undefined, `${label} publish job must not bypass failed jobs`)
}

function assertOrderedSourceMarkers(source, markers) {
  let prior = -1
  for (const marker of markers) {
    const index = source.indexOf(marker, prior + 1)
    assert.notEqual(index, -1, `missing ordered source marker: ${marker}`)
    prior = index
  }
}

function assertSourceMarkersAfter(source, priorMarker, markers) {
  const priorIndex = source.indexOf(priorMarker)
  assert.notEqual(priorIndex, -1, `missing prior source marker: ${priorMarker}`)
  for (const marker of markers) {
    assert.ok(source.indexOf(marker) > priorIndex, `${marker} must appear after ${priorMarker}`)
  }
}

class FakeWebSocket {
  constructor() {
    this.readyState = 1
    this.listeners = new Map()
    this.sent = []
    this.onSend = () => undefined
  }

  addEventListener(name, listener) {
    const listeners = this.listeners.get(name) ?? []
    listeners.push(listener)
    this.listeners.set(name, listeners)
  }

  send(body) {
    const payload = JSON.parse(body)
    this.sent.push(payload)
    queueMicrotask(() => this.onSend(payload))
  }

  emit(name, event) {
    for (const listener of this.listeners.get(name) ?? []) listener(event)
  }

  close() {
    this.readyState = 3
    this.emit('close', {})
  }
}
