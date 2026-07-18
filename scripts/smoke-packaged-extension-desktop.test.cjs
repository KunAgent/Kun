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
  createPackagedExtensionSmokeReexecEnvironment,
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
  desktopSmokeWorkspaceParent,
  desktopUserDataCandidates,
  findUnexpectedPopupTargets,
  hasWorkbenchContribution,
  WORKBENCH_DISCOVERY_RETRY_DELAYS_MS,
  runGuestAsyncInspection,
  sendToGuestSession,
  synchronizeWorkbenchContributionDiscovery,
  waitForSuccessfulGuestInspection,
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

test('forces headless packaged runtime smokes onto the encrypted file-key fallback', () => {
  const environment = createPackagedExtensionSmokeReexecEnvironment({
    PATH: '/usr/bin',
    KUN_DISABLE_OS_CREDENTIAL_STORE: '0'
  })
  assert.equal(environment.PATH, '/usr/bin')
  assert.equal(environment.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(environment.KUN_DISABLE_OS_CREDENTIAL_STORE, '1')
  assert.equal(environment.KUN_PACKAGED_EXTENSION_SMOKE_REEXEC, '1')
})

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
  const workspaceRoot = resolve('/workspace')
  const macArm64Resources = resolve(
    workspaceRoot,
    'dist/mac-arm64/Kun.app/Contents/Resources'
  )
  assert.deepEqual(resolvedPackagedResourceCandidates('darwin', 'arm64', workspaceRoot), [
    macArm64Resources
  ])
  assert.deepEqual(resolvedDesktopResourceCandidates('darwin', 'arm64', workspaceRoot), [
    macArm64Resources
  ])
  assert.equal(desktopApplicationEntry('/packaged/Resources', '/packaged/Kun', '/packaged/Kun'), undefined)
  assert.equal(
    desktopApplicationEntry('/packaged/Resources', '/host/Electron', '/packaged/Kun'),
    join('/packaged/Resources', 'app.asar')
  )
  const smokeSettings = desktopSmokeSettings(
    43123,
    '/isolated-home/.kun/default_workspace',
    '/isolated-home/.kun/data'
  )
  assert.equal(smokeSettings.workspaceRoot, '/isolated-home/.kun/default_workspace')
  assert.equal(smokeSettings.agents.kun.dataDir, '/isolated-home/.kun/data')
  assert.throws(
    () => desktopSmokeSettings(43123, '/workspace', '~/.kun/data'),
    /dataDir must be absolute/
  )
  assert.equal(
    desktopSmokeWorkspaceParent('/source-checkout'),
    join('/source-checkout', 'dist', '.kun-desktop-smoke')
  )
  assert.deepEqual(
    desktopUserDataCandidates({
      platform: 'linux',
      home: '/isolated-home',
      appData: '/isolated-app-data',
      explicitUserData: '/isolated-user-data'
    }),
    [
      '/isolated-user-data',
      join('/isolated-app-data', 'Kun'),
      join('/isolated-home', '.config', 'Kun')
    ]
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
    environment: {
      ELECTRON_RUN_AS_NODE: '1',
      KUN_DISABLE_OS_CREDENTIAL_STORE: '1'
    },
    platform: 'linux',
    hasDisplay: false,
    xvfbExecutable: '/usr/bin/xvfb-run'
  })
  assert.equal(linux.command, '/usr/bin/xvfb-run')
  assert.deepEqual(linux.args, ['-a', '-s', '-screen 0 1280x900x24', '/packaged/kun', '--remote-debugging-port=12345'])
  assert.equal(linux.env.ELECTRON_RUN_AS_NODE, undefined)
  assert.equal(linux.env.KUN_DISABLE_OS_CREDENTIAL_STORE, '1')
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
      KUN_DISABLE_OS_CREDENTIAL_STORE: '0',
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
  assert.equal(isolated.KUN_DISABLE_OS_CREDENTIAL_STORE, '1')
  assert.equal(isolated.NO_AT_BRIDGE, '1')
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
  assert.equal(
    smokeWebviewCsp(),
    "default-src 'none'; style-src 'self'; img-src 'self' data: kun-media:; media-src 'self' kun-media:; connect-src 'none'"
  )
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

test('synchronizes renderer discovery after the trusted bridge sees the installed smoke view', async () => {
  assert.deepEqual(WORKBENCH_DISCOVERY_RETRY_DELAYS_MS, [0, 250, 1_000])
  const response = {
    ok: true,
    status: 200,
    body: JSON.stringify({
      schemaVersion: 1,
      revision: 7,
      extensions: [{
        id: EXTENSION_ID,
        contributes: { 'views.rightSidebar': [{ id: 'smoke' }] }
      }]
    })
  }
  assert.equal(hasWorkbenchContribution(response, CONTRIBUTION_ID), true)
  assert.equal(hasWorkbenchContribution(response, 'extension:other.example/smoke'), false)
  const calls = []
  const session = { targetId: 'workbench-target', sessionId: 'workbench-session' }
  await synchronizeWorkbenchContributionDiscovery({
    cdp: {
      send: async (...args) => {
        calls.push(args)
        return args[1].expression.includes('extensionGetWorkbench')
          ? { result: { value: response } }
          : { result: { value: true } }
      }
    },
    session,
    workspaceRoot: '/workspace',
    contributionId: CONTRIBUTION_ID,
    timeoutMs: 1_000,
    processState: () => ({ exitCode: null, signalCode: null })
  })
  assert.deepEqual(calls.map(([method, params, sessionId]) => ({ method, sessionId, params: {
    awaitPromise: params.awaitPromise,
    returnByValue: params.returnByValue
  } })), [
    {
      method: 'Runtime.evaluate',
      sessionId: 'workbench-session',
      params: { awaitPromise: true, returnByValue: true }
    },
    {
      method: 'Runtime.evaluate',
      sessionId: 'workbench-session',
      params: { awaitPromise: undefined, returnByValue: true }
    }
  ])
  assert.match(calls[0][1].expression, /extensionGetWorkbench/)
  assert.match(calls[1][1].expression, /window\.setTimeout/)
})

test('reattaches renderer discovery when the packaged workbench CDP session is replaced', async () => {
  const response = {
    ok: true,
    status: 200,
    body: JSON.stringify({
      extensions: [{
        id: EXTENSION_ID,
        contributes: { 'views.rightSidebar': [{ id: 'smoke' }] }
      }]
    })
  }
  const calls = []
  let rejectedOldSession = false
  const session = { targetId: 'old-target', sessionId: 'old-session' }
  await synchronizeWorkbenchContributionDiscovery({
    cdp: {
      send: async (method, params, sessionId) => {
        calls.push([method, params, sessionId])
        if (method === 'Runtime.evaluate' && sessionId === 'old-session' && !rejectedOldSession) {
          rejectedOldSession = true
          throw new Error('CDP Runtime.evaluate failed (-32001): Session with given id not found.')
        }
        if (method === 'Target.getTargets') {
          return {
            targetInfos: [{
              targetId: 'replacement-target',
              type: 'page',
              url: 'file:///opt/Kun/resources/app.asar/out/renderer/index.html'
            }]
          }
        }
        if (method === 'Target.attachToTarget') return { sessionId: 'replacement-session' }
        if (method === 'Runtime.enable') return {}
        return params.expression.includes('extensionGetWorkbench')
          ? { result: { value: response } }
          : { result: { value: true } }
      }
    },
    session,
    workspaceRoot: '/workspace',
    contributionId: CONTRIBUTION_ID,
    timeoutMs: 1_000,
    processState: () => ({ exitCode: null, signalCode: null })
  })
  assert.deepEqual(session, {
    targetId: 'replacement-target',
    sessionId: 'replacement-session'
  })
  assert.equal(calls.some(([method]) => method === 'Target.getTargets'), true)
  assert.equal(calls.some(([method]) => method === 'Target.attachToTarget'), true)
  assert.equal(
    calls.filter(([method, , sessionId]) =>
      method === 'Runtime.evaluate' && sessionId === 'replacement-session').length,
    2
  )
})

test('retries renderer discovery when the initial packaged workbench target is replaced before attach', async () => {
  const response = {
    ok: true,
    status: 200,
    body: JSON.stringify({
      extensions: [{
        id: EXTENSION_ID,
        contributes: { 'views.rightSidebar': [{ id: 'smoke' }] }
      }]
    })
  }
  const calls = []
  let targetLookupCount = 0
  const session = { targetId: 'initial-target', sessionId: undefined }
  await synchronizeWorkbenchContributionDiscovery({
    cdp: {
      send: async (method, params, sessionId) => {
        calls.push([method, params, sessionId])
        if (method === 'Target.getTargets') {
          targetLookupCount += 1
          return {
            targetInfos: [{
              targetId: targetLookupCount === 1 ? 'initial-target' : 'replacement-target',
              type: 'page',
              url: 'file:///opt/Kun/resources/app.asar/out/renderer/index.html'
            }]
          }
        }
        if (method === 'Target.attachToTarget') {
          return {
            sessionId: params.targetId === 'initial-target'
              ? 'initial-session'
              : 'replacement-session'
          }
        }
        if (method === 'Runtime.enable' && sessionId === 'initial-session') {
          throw new Error('CDP Runtime.enable failed (-32001): Session with given id not found.')
        }
        if (method === 'Runtime.enable') return {}
        return params.expression.includes('extensionGetWorkbench')
          ? { result: { value: response } }
          : { result: { value: true } }
      }
    },
    session,
    workspaceRoot: '/workspace',
    contributionId: CONTRIBUTION_ID,
    timeoutMs: 1_000,
    processState: () => ({ exitCode: null, signalCode: null })
  })
  assert.deepEqual(session, {
    targetId: 'replacement-target',
    sessionId: 'replacement-session'
  })
  assert.equal(targetLookupCount, 2)
  assert.equal(calls.some(([method, params]) =>
    method === 'Target.attachToTarget' && params.targetId === 'replacement-target'), true)
  assert.equal(
    calls.filter(([method, , sessionId]) =>
      method === 'Runtime.evaluate' && sessionId === 'replacement-session').length,
    2
  )
})

test('reattaches a replaced packaged Extension guest before replaying its CDP command', async () => {
  const calls = []
  let rejectedOldSession = false
  const session = { targetId: 'old-guest', sessionId: 'old-guest-session' }
  const response = await sendToGuestSession({
    cdp: {
      send: async (method, params, sessionId) => {
        calls.push([method, params, sessionId])
        if (method === 'Runtime.evaluate' && sessionId === 'old-guest-session' && !rejectedOldSession) {
          rejectedOldSession = true
          throw new Error('CDP Runtime.evaluate failed (-32001): Session with given id not found.')
        }
        if (method === 'Target.getTargets') {
          return {
            targetInfos: [{
              targetId: 'replacement-guest',
              type: 'webview',
              url: `kun-extension://${EXTENSION_ID}/dist/webview/index.html?kunViewSession=replacement`
            }]
          }
        }
        if (method === 'Target.attachToTarget') return { sessionId: 'replacement-guest-session' }
        if (method === 'Runtime.enable') return {}
        return { result: { value: 'replayed' } }
      }
    },
    session,
    method: 'Runtime.evaluate',
    params: { expression: 'location.href', returnByValue: true },
    timeoutMs: 1_000,
    processState: () => ({ exitCode: null, signalCode: null }),
    operation: 'testing guest recovery'
  })
  assert.deepEqual(response, { result: { value: 'replayed' } })
  assert.deepEqual(session, {
    targetId: 'replacement-guest',
    sessionId: 'replacement-guest-session'
  })
  assert.equal(calls.some(([method, params]) =>
    method === 'Target.attachToTarget' && params.targetId === 'replacement-guest'), true)
  assert.equal(calls.at(-1)?.[2], 'replacement-guest-session')
})

test('reattaches and replays a guest Runtime evaluation after a silent CDP timeout', async () => {
  let timedOut = false
  const session = { targetId: 'guest-target', sessionId: 'timed-out-session' }
  const response = await sendToGuestSession({
    cdp: {
      send: async (method, params, sessionId) => {
        if (method === 'Runtime.evaluate' && !timedOut) {
          timedOut = true
          throw new Error('CDP command timed out: Runtime.evaluate')
        }
        if (method === 'Target.getTargets') {
          return {
            targetInfos: [{
              targetId: 'guest-target',
              type: 'webview',
              url: `kun-extension://${EXTENSION_ID}/dist/webview/index.html?kunViewSession=current`
            }]
          }
        }
        if (method === 'Target.attachToTarget') return { sessionId: 'reattached-session' }
        if (method === 'Runtime.enable') return {}
        return { result: { value: params.expression } }
      }
    },
    session,
    method: 'Runtime.evaluate',
    params: { expression: 'document.readyState', returnByValue: true },
    timeoutMs: 1_000,
    processState: () => ({ exitCode: null, signalCode: null }),
    operation: 'testing silent guest timeout recovery'
  })
  assert.deepEqual(response, { result: { value: 'document.readyState' } })
  assert.equal(session.sessionId, 'reattached-session')
})

test('runs long guest inspections as a started task with short result polls', async () => {
  const expressions = []
  let polls = 0
  let starts = 0
  const result = await runGuestAsyncInspection({
    cdp: {},
    sessionId: 'guest-session',
    sendCommand: async (_method, params) => {
      expressions.push(params.expression)
      if (params.expression.includes('Promise.resolve')) {
        starts += 1
        return { result: { value: '__kunPackagedGuestInspectionTest' } }
      }
      if (params.expression.startsWith('delete ')) return { result: { value: true } }
      polls += 1
      if (polls === 1) return { result: { value: null } }
      if (polls === 2) return { result: { value: { state: 'pending' } } }
      return { result: { value: { state: 'fulfilled', value: { mode: 'ok' } } } }
    },
    expression: '(async () => ({ mode: \'ok\' }))()',
    userGesture: true,
    timeoutMs: 1_000,
    description: 'test asynchronous guest inspection'
  })
  assert.deepEqual(result, { mode: 'ok' })
  assert.equal(polls, 3)
  assert.equal(starts, 2)
  assert.equal(expressions.some((expression) => expression.includes('Promise.resolve')), true)
  assert.equal(expressions.at(-1)?.startsWith('delete '), true)
})

test('waits for the packaged Extension guest main-frame media binding to become current', async () => {
  let attempts = 0
  const result = await waitForSuccessfulGuestInspection({
    inspect: async () => {
      attempts += 1
      return attempts === 1
        ? { mediaPlaybackMode: 'rejected', mediaPlaybackError: { message: 'binding pending' } }
        : { mediaPlaybackMode: 'ok', mediaPlayback: { leaseId: 'lease-1' } }
    },
    isSuccessful: (value) => value.mediaPlaybackMode === 'ok',
    timeoutMs: 1_000,
    description: 'test guest media binding'
  })
  assert.equal(attempts, 2)
  assert.deepEqual(result, {
    mediaPlaybackMode: 'ok',
    mediaPlayback: { leaseId: 'lease-1' }
  })
})

test('uses a command budget that covers bounded packaged guest security checks', () => {
  const cdp = new CdpConnection(new FakeWebSocket())
  assert.equal(cdp.commandTimeoutMs, 30_000)
  cdp.close()
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
    mediaPlaybackMode: 'ok',
    mediaPlayback: {
      scheme: 'kun-media:',
      duration: 2,
      currentTime: 0.5,
      readyState: 4,
      leaseId: 'media_lease_packaged_test'
    },
    imagePlaybackMode: 'ok',
    imagePlayback: {
      scheme: 'kun-media:',
      naturalWidth: 1,
      naturalHeight: 1,
      leaseId: 'image_lease_packaged_test'
    },
    imageReleaseMode: 'ok',
    copiedMediaUrlMode: 'blocked',
    arbitraryLocalPathMode: 'blocked',
    releaseMode: 'ok',
    postReleaseMediaUrlMode: 'blocked',
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
    () => assertGuestSecurityResult({ ...secure, mediaPlayback: { ...secure.mediaPlayback, scheme: 'file:' } }),
    /kun-media desktop playback\/seek failed/
  )
  assert.throws(
    () => assertGuestSecurityResult({
      ...secure,
      imagePlayback: { ...secure.imagePlayback, naturalWidth: 0 }
    }),
    /kun-media desktop image playback failed/
  )
  assert.throws(
    () => assertGuestSecurityResult({
      ...secure,
      mediaPlaybackMode: 'rejected',
      mediaPlayback: null,
      copiedMediaUrlMode: 'invalid-url'
    }),
    /kun-media desktop playback\/seek failed: rejected null/
  )
  assert.throws(
    () => assertGuestSecurityResult({ ...secure, fetchMode: 'allowed' }),
    /loopback fetch was not rejected by the Host filter/
  )
  assert.throws(
    () => assertGuestSecurityResult({ ...secure, copiedMediaUrlMode: 'allowed' }),
    /copied sender URL was not blocked/
  )
  assert.throws(
    () => assertGuestSecurityResult({ ...secure, arbitraryLocalPathMode: 'allowed' }),
    /arbitrary local file URL was not blocked/
  )
  assert.throws(
    () => assertGuestSecurityResult({ ...secure, releaseMode: 'rejected' }),
    /media lease release failed/
  )
  assert.throws(
    () => assertGuestSecurityResult({ ...secure, postReleaseMediaUrlMode: 'allowed' }),
    /post-release URL was not blocked/
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
  const packagedOcrCommand = 'node scripts/smoke-packaged-ocr.cjs'
  const verifyMacX64Command =
    'npm run verify:packaged-macos-native -- --resources dist/mac-x64-verified/Kun.app/Contents/Resources --arch x64'
  const smokeMacX64ExtensionsCommand =
    'npm run smoke:packaged-extensions -- --resources dist/mac-x64-verified/Kun.app/Contents/Resources'
  const smokeMacX64DesktopCommand =
    'npm run smoke:packaged-extension-desktop -- --resources dist/mac-x64-verified/Kun.app/Contents/Resources'

  assertPublishDependencies(release, 'stable release')
  assertPublishDependencies(daily, 'daily prerelease')

  assertOrderedCommands(release.jobs['build-macos'], [
    'npm run verify:packaged-macos-native -- --resources dist/mac/Kun.app/Contents/Resources --arch x64',
    'npm run verify:packaged-macos-native -- --resources dist/mac-arm64/Kun.app/Contents/Resources --arch arm64',
    packagedOcrCommand,
    'npm run smoke:packaged-extensions -- --resources dist/mac/Kun.app/Contents/Resources',
    'npm run smoke:packaged-extensions -- --resources dist/mac-arm64/Kun.app/Contents/Resources',
    desktopCommand,
    nativeEvidenceCommand
  ])
  assertStepAfter(release.jobs['build-macos'], 'Upload macOS artifacts', nativeEvidenceCommand)
  assertOrderedCommands(release.jobs['verify-macos-x64'], [
    verifyMacX64Command,
    packagedOcrCommand,
    smokeMacX64ExtensionsCommand,
    smokeMacX64DesktopCommand
  ])
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
    'npm run check:extension-release-gate',
    'npm run dist:mac',
    'npm run verify:packaged-macos-native -- --resources dist/mac/Kun.app/Contents/Resources --arch x64',
    'npm run verify:packaged-macos-native -- --resources dist/mac-arm64/Kun.app/Contents/Resources --arch arm64',
    packagedOcrCommand,
    'npm run smoke:packaged-extensions -- --resources dist/mac/Kun.app/Contents/Resources',
    'npm run smoke:packaged-extensions -- --resources dist/mac-arm64/Kun.app/Contents/Resources',
    desktopCommand,
    nativeEvidenceCommand
  ])
  assertStepAfter(pr.jobs['package-macos'], 'Upload ad-hoc macOS PR packages', nativeEvidenceCommand)
  assertOrderedCommands(pr.jobs['package-macos-x64-runtime'], [
    verifyMacX64Command,
    packagedOcrCommand,
    smokeMacX64ExtensionsCommand,
    smokeMacX64DesktopCommand
  ])
  assertOrderedCommands(pr.jobs['package-windows'], [
    'npm run check:extension-release-gate',
    'npm run dist:win',
    'npm run smoke:packaged-extensions -- --resources dist/win-unpacked/resources',
    desktopCommand,
    nativeEvidenceCommand
  ])
  assertStepAfter(pr.jobs['package-windows'], 'Upload Windows PR package', nativeEvidenceCommand)
  assertOrderedCommands(daily.jobs['build-macos'], [
    'npm run check:extension-release-gate',
    'npm run dist:mac',
    'npm run verify:packaged-macos-native -- --resources dist/mac/Kun.app/Contents/Resources --arch x64',
    'npm run verify:packaged-macos-native -- --resources dist/mac-arm64/Kun.app/Contents/Resources --arch arm64',
    packagedOcrCommand,
    'npm run smoke:packaged-extensions -- --resources dist/mac/Kun.app/Contents/Resources',
    'npm run smoke:packaged-extensions -- --resources dist/mac-arm64/Kun.app/Contents/Resources',
    desktopCommand,
    nativeEvidenceCommand
  ])
  assertStepAfter(daily.jobs['build-macos'], 'Upload macOS artifacts', nativeEvidenceCommand)
  assertOrderedCommands(daily.jobs['verify-macos-x64'], [
    verifyMacX64Command,
    packagedOcrCommand,
    smokeMacX64ExtensionsCommand,
    smokeMacX64DesktopCommand
  ])
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
  assert.equal(pr.jobs['package-macos-x64-runtime']['timeout-minutes'], 30)
  assert.equal(pr.jobs['package-windows']['timeout-minutes'], 90, 'PR Windows package job must have a bounded timeout')
  for (const jobId of ['package', 'package-macos', 'package-windows']) {
    const needs = Array.isArray(pr.jobs[jobId].needs) ? pr.jobs[jobId].needs : [pr.jobs[jobId].needs]
    assert.ok(needs.includes('test'), `${jobId} must depend on the test gate`)
  }
  for (const [label, job, dependency] of [
    ['release macOS x64', release.jobs['verify-macos-x64'], 'build-macos'],
    ['daily macOS x64', daily.jobs['verify-macos-x64'], 'build-macos'],
    ['PR macOS x64', pr.jobs['package-macos-x64-runtime'], 'package-macos']
  ]) {
    const needs = Array.isArray(job.needs) ? job.needs : [job.needs]
    assert.ok(needs.includes(dependency), `${label} must depend on ${dependency}`)
    assert.equal(job['runs-on'], 'macos-15-intel', `${label} must execute on Intel macOS`)
    assert.equal(job['timeout-minutes'], 30, `${label} must have a bounded timeout`)
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
  for (const jobId of [
    'test',
    'package',
    'package-macos',
    'package-macos-x64-runtime',
    'package-windows'
  ]) {
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
    'npm run verify:packaged-macos-native -- --resources "${x64_resources}" --arch x64',
    'npm run verify:packaged-macos-native -- --resources "${arm64_resources}" --arch arm64',
    'npm run smoke:packaged-extensions -- --resources "${x64_resources}"',
    '|| die "macOS x64 packaged Extension Node runtime smoke failed"',
    'npm run smoke:packaged-extensions -- --resources "${arm64_resources}"',
    '|| die "macOS arm64 packaged Extension Node runtime smoke failed"',
    'KUN_PACKAGED_RESOURCES_DIR="${host_resources}" node scripts/smoke-packaged-ocr.cjs',
    'npm run smoke:packaged-extension-desktop -- --resources "${host_resources}"',
    '|| die "macOS packaged Extension desktop Chromium smoke failed"'
  ])
  assertSourceMarkersAfter(releaseMac, '\nsmoke_macos_extensions\n', [
    'gh release create "${TAG_NAME}"',
    'gh release upload "${tag}"',
    'publish-r2.mjs" upload --platform mac'
  ])
  assert.doesNotMatch(releaseMac, /publish-r2\.mjs" promote --tag/)
  assert.doesNotMatch(releaseMac, /build_macos_parallel/)
  assert.match(releaseMac, /Building macOS serially for architecture-specific native dependencies/)
  assert.match(releaseMac, /macOS release only uploads single-platform R2 metadata/)

  const releaseWin = readFileSync(join(root, 'scripts', 'release-win.sh'), 'utf8')
  assertOrderedSourceMarkers(releaseWin, [
    'npm run check:extension-release-gate || die "Extension public release gate failed"',
    'npm run dist:win || die "Windows build failed"',
    'npm run smoke:packaged-extensions -- --resources dist/win-unpacked/resources',
    '|| die "Windows packaged Extension Node runtime smoke failed"',
    desktopCommand,
    '|| die "Windows packaged Extension desktop Chromium smoke failed"',
    'gh release upload "${TAG_NAME}"',
    'if $PUBLISH || [[ "${R2_PROMOTE}" == "true" ]]; then',
    'npm run verify:manual-extension-release -- --tag "${TAG_NAME}" --version "${RELEASE_VERSION}"',
    'publish-r2.mjs" promote --tag "${TAG_NAME}" --channel "${RELEASE_CHANNEL}" --platforms mac,win,linux',
    'gh release edit "${TAG_NAME}" --draft=false'
  ])
  assertSourceMarkersAfter(releaseWin, desktopCommand, [
    'gh release upload "${TAG_NAME}"',
    'publish-r2.mjs" upload --platform win',
    'publish-r2.mjs" promote --tag "${TAG_NAME}" --channel "${RELEASE_CHANNEL}" --platforms mac,win,linux',
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
    '& gh release upload $TagName',
    'if ($Publish -or $PromoteR2)',
    '& npm run verify:manual-extension-release -- --tag $TagName --version $ReleaseVersion',
    "'scripts\\publish-r2.mjs') promote --tag $TagName --channel $ReleaseChannel --platforms mac,win,linux",
    '& gh release edit $TagName --draft=false'
  ])
  assertSourceMarkersAfter(releaseWinPowerShell, '& npm run smoke:packaged-extension-desktop', [
    '& gh release upload $TagName',
    "'scripts\\publish-r2.mjs') upload --platform win",
    "'scripts\\publish-r2.mjs') promote --tag $TagName --channel $ReleaseChannel --platforms mac,win,linux",
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
  assert.match(desktopSource, /copied kun-media URL from the workbench sender/)
  assert.match(desktopSource, /arbitrary file URL from the extension guest/)
  assert.match(desktopSource, /released kun-media URL from its original guest/)
  assert.match(desktopSource, /replacement kun-extension guest for stale View Session validation/)
  assert.match(desktopSource, /Page\.setBypassCSP/)
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
  for (const dependency of [
    'prepare',
    'build-macos',
    'verify-macos-x64',
    'build-windows',
    'build-linux'
  ]) {
    assert.ok(needs.includes(dependency), `${label} publish job must depend on ${dependency}`)
  }
  assert.equal(publish.if, undefined, `${label} publish job must not bypass failed jobs`)
}

function assertOrderedSourceMarkers(source, markers) {
  source = source.replace(/\r\n/gu, '\n')
  let prior = -1
  for (const marker of markers) {
    const index = source.indexOf(marker, prior + 1)
    assert.notEqual(index, -1, `missing ordered source marker: ${marker}`)
    prior = index
  }
}

function assertSourceMarkersAfter(source, priorMarker, markers) {
  source = source.replace(/\r\n/gu, '\n')
  const priorIndex = source.indexOf(priorMarker)
  assert.notEqual(priorIndex, -1, `missing prior source marker: ${priorMarker}`)
  for (const marker of markers) {
    assert.ok(
      source.indexOf(marker, priorIndex + 1) > priorIndex,
      `${marker} must appear after ${priorMarker}`
    )
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
