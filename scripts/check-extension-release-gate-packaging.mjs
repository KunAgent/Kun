import {
  LINUX_USER_NAMESPACE_SETUP,
  LINUX_USER_NAMESPACE_STEP_NAME,
  check,
  join,
  require,
  resolve,
  root,
  text
} from './check-extension-release-gate-context.mjs'
import { rootPackage } from './check-extension-release-gate-platform.mjs'

const builderConfig = require(join(root, 'electron-builder.config.cjs'))
const afterPack = require(join(root, 'scripts/after-pack.cjs'))
const afterPackSource = [
  await text('scripts/after-pack.cjs'),
  await text('scripts/after-pack-launchers.cjs')
].join('\n')
check(
  typeof afterPack._internals?.materializePackedWorkspaceDependencies === 'function',
  'afterPack does not materialize workspace packages inside the packed Kun dependency tree'
)
check(
  /async function afterPack\(context\)\s*\{[\s\S]*?materializePackedWorkspaceDependencies\(context\)[\s\S]*?validateBundledKunRuntime\(context\)/.test(
    afterPackSource
  ),
  'afterPack does not materialize workspace packages before validating the bundled Kun runtime'
)
check(
  typeof afterPack._internals?.validateBundledExtensionResources === 'function' &&
    /async function afterPack\(context\)\s*\{[\s\S]*?validateBundledKunRuntime\(context\)[\s\S]*?validateBundledExtensionResources\(context\)/.test(
      afterPackSource
    ),
  'afterPack does not validate bundled .kunx catalog bytes before release artifacts are created'
)
for (const id of ['kun-examples.social-media-sidebar']) {
  check(
    afterPack.REQUIRED_BUNDLED_EXTENSION_IDS.includes(id),
    `afterPack does not require bundled default extension: ${id}`
  )
}
for (const id of [
  'kun-examples.kun-video-editor',
  'kun-examples.presentation-studio'
]) {
  check(
    afterPack.REQUIRED_RETIRED_BUNDLED_EXTENSION_IDS.includes(id),
    `afterPack does not require retired bundled extension marker: ${id}`
  )
}
for (const pattern of [
  'packages/extension-api/package.json',
  'packages/extension-api/dist/**/*',
  'packages/extension-api/schema/**/*',
  'packages/extension-api/fixtures/**/*',
  'packages/create-kun-extension/package.json',
  'packages/create-kun-extension/src/**/*',
  'packages/create-kun-extension/templates/**/*'
]) {
  check(builderConfig.files.includes(pattern), `electron-builder files omit Extension resource: ${pattern}`)
}
check(
  builderConfig.extraResources.some((resource) =>
    resource?.from === 'resources/bundled-extensions' &&
    resource?.to === 'bundled-extensions' &&
    Array.isArray(resource?.filter) &&
    resource.filter.includes('catalog.json') &&
    resource.filter.includes('*.kunx')
  ),
  'electron-builder extraResources omit the default bundled .kunx catalog'
)
for (const pattern of [
  '**/kun/dist/**/*',
  '**/kun/node_modules/**/*',
  '**/packages/extension-api/**/*',
  '**/packages/create-kun-extension/**/*',
  '**/node_modules/sharp/**/*',
  '**/node_modules/@img/**/*'
]) {
  check(
    builderConfig.asarUnpack.includes(pattern),
    `electron-builder asarUnpack omits Extension runtime resource: ${pattern}`
  )
}
for (const path of [
  'kun/dist/cli/extension-cli.js',
  'kun/dist/extensions/host-runner.js',
  'kun/node_modules/typescript/package.json',
  'kun/node_modules/typescript/lib/typescript.js',
  'kun/node_modules/typescript-language-server/package.json',
  'kun/node_modules/typescript-language-server/lib/cli.mjs',
  'kun/node_modules/@kun/extension-api/dist/index.js',
  'kun/node_modules/create-kun-extension/src/cli.mjs',
  'node_modules/better-sqlite3/package.json',
  'node_modules/bindings/package.json',
  'node_modules/file-uri-to-path/package.json',
  'packages/extension-api/schema/kun-extension.schema.json',
  'packages/extension-api/fixtures/api-major-negotiation.json',
  'packages/extension-api/fixtures/api-minor-negotiation.json',
  'packages/create-kun-extension/src/cli.mjs',
  'packages/create-kun-extension/templates/node/src/extension.ts',
  'packages/create-kun-extension/templates/react/src/host/extension.ts',
  'packages/create-kun-extension/templates/react/src/webview/main.tsx',
  'packages/create-kun-extension/templates/webview/src/webview/main.ts'
]) {
  check(afterPack.KUN_RUNTIME_REQUIRED_PATHS.includes(path), `afterPack does not assert Extension resource: ${path}`)
}

const viteConfig = await text('electron.vite.config.ts')
for (const entry of [
  "'extension-view': resolve('src/preload/extension-view.ts')",
  "'extension-protected-surface': resolve('src/preload/extension-protected-surface.ts')"
]) {
  check(viteConfig.includes(entry), `Electron build omits packaged preload entry: ${entry}`)
}

const packagedExtensionSmoke = [
  await text('scripts/smoke-packaged-extensions.cjs'),
  await text('scripts/smoke-packaged-extensions-resources.cjs')
].join('\n')
for (const marker of [
  'resolvePackagedRuntimeExecutable',
  'KUN_PACKAGED_EXTENSION_SMOKE_REEXEC',
  "ELECTRON_RUN_AS_NODE: '1'",
  'smokeAgentTool',
  'smokeHeadlessTool',
  "'extension', 'install'",
  "'extension', 'uninstall'",
  'DEFAULT_EXTENSION_ID',
  'validateBundledDefaultExtension',
  "'--bundled-extensions-dir'",
  'was resurrected after explicit uninstall',
  "apiVersion: '1.2.0'",
  'assertConfinedPackagedPath',
  'readAsarHeader'
]) {
  check(packagedExtensionSmoke.includes(marker), `Packaged Extension smoke omits release assertion: ${marker}`)
}

const packagedDesktopSmoke = (
  await Promise.all([
    'scripts/smoke-packaged-extension-desktop.cjs',
    'scripts/smoke-packaged-extension-desktop-constants.cjs',
    'scripts/smoke-packaged-extension-desktop-process.cjs',
    'scripts/smoke-packaged-extension-desktop-runtime.cjs',
    'scripts/smoke-packaged-extension-desktop-cdp.cjs',
    'scripts/smoke-packaged-extension-desktop-guest.cjs',
    'scripts/smoke-packaged-extension-desktop-media.cjs'
  ].map((path) => text(path)))
).join('\n')
const packagedDesktopSmokeModule = require(join(root, 'scripts/smoke-packaged-extension-desktop.cjs'))
for (const marker of [
  'installSmokeExtensionFixture',
  '--remote-debugging-port=',
  '--user-data-dir=',
  'Target.getTargets',
  'Target.attachToTarget',
  'Input.dispatchMouseEvent',
  'data-contribution-id',
  "url.protocol === 'kun-extension:'",
  'globalThis.kunExtension',
  'Reflect.ownKeys',
  "request('ui.getTheme'",
  "'ui.setViewState'",
  "request('ui.getViewState'",
  'startNetworkCanary',
  'webviewConnectUrls',
  'Page.setBypassCSP',
  'networkCanary.requestCount()',
  "'kunGui' in globalThis",
  "'ipcRenderer' in globalThis",
  "'Buffer' in globalThis",
  'globalThis.require',
  'globalThis.process',
  'globalThis.fetch',
  'globalThis.open',
  'userGesture: true',
  'popupTargets',
  'waitForPortsClosed',
  'ELECTRON_RENDERER_URL',
  'timeout: timeoutMs',
  'seedDesktopMediaPlaybackFixture',
  "'media.openViewResource'",
  "scheme: new URL(lease.url).protocol",
  "result.mediaPlayback?.scheme !== 'kun-media:'",
  'result.mediaPlayback.currentTime < 0.4'
]) {
  check(packagedDesktopSmoke.includes(marker), `Packaged desktop Chromium smoke omits assertion: ${marker}`)
}
// The smoke sources may mention --no-sandbox only behind both the CI marker
// and an explicit authorization flag, never as an unconditional argument.
check(
  !packagedDesktopSmoke.includes("'--no-sandbox'") ||
    (/process\.env\.CI\s*===\s*'true'/.test(packagedDesktopSmoke) &&
      /KUN_CI_ALLOW_NO_SANDBOX\s*===\s*'1'/.test(packagedDesktopSmoke)),
  'Packaged desktop Chromium smoke must not disable the Chromium sandbox'
)
check(
  !packagedDesktopSmoke.includes("'--disable-setuid-sandbox'"),
  'Packaged desktop Chromium smoke must verify the product launcher without injecting its sandbox flag'
)
check(
  typeof packagedDesktopSmokeModule.createDesktopLaunchPlan === 'function',
  'Packaged desktop Chromium smoke does not export its launch contract for release validation'
)
// The default Linux smoke launch keeps the Chromium sandbox enabled. The
// KUN_CI_ALLOW_NO_SANDBOX escape hatch exists only for explicitly authorized
// CI runners whose SUID setup cannot be used. It never affects production.
check(
  JSON.stringify(packagedDesktopSmokeModule.platformDesktopArguments?.('linux')) ===
    JSON.stringify(['--disable-gpu', '--disable-dev-shm-usage']) &&
    !packagedDesktopSmokeModule.platformDesktopArguments?.('linux').includes(
      '--disable-setuid-sandbox'
    ) &&
    !packagedDesktopSmokeModule.platformDesktopArguments?.('linux').includes('--no-sandbox'),
  'Packaged Linux desktop smoke must not inject sandbox flags that hide launcher defects'
)
{
  const previousCi = process.env.CI
  const previousAuthorization = process.env.KUN_CI_ALLOW_NO_SANDBOX
  try {
    process.env.CI = 'true'
    process.env.KUN_CI_ALLOW_NO_SANDBOX = '1'
    check(
      JSON.stringify(packagedDesktopSmokeModule.platformDesktopArguments?.('linux')) ===
        JSON.stringify(['--disable-gpu', '--disable-dev-shm-usage', '--no-sandbox']),
      'Packaged Linux desktop smoke escape hatch must add exactly --no-sandbox'
    )
  } finally {
    if (previousCi === undefined) delete process.env.CI
    else process.env.CI = previousCi
    if (previousAuthorization === undefined) delete process.env.KUN_CI_ALLOW_NO_SANDBOX
    else process.env.KUN_CI_ALLOW_NO_SANDBOX = previousAuthorization
  }
}
check(
  /process\.env\.CI\s*===\s*'true'/.test(packagedDesktopSmoke) &&
    /KUN_CI_ALLOW_NO_SANDBOX\s*===\s*'1'/.test(packagedDesktopSmoke),
  'Packaged Linux desktop smoke sandbox escape hatch must stay behind an explicit CI flag'
)
check(
  packagedDesktopSmokeModule.CONTRIBUTION_ID === 'extension:kun-smoke.packaged/smoke',
  'Packaged desktop Chromium smoke does not click the canonical smoke contribution'
)
if (typeof packagedDesktopSmokeModule.createDesktopLaunchPlan === 'function') {
  const desktopLaunch = packagedDesktopSmokeModule.createDesktopLaunchPlan({
    executable: '/packaged/Kun',
    applicationArguments: ['--remote-debugging-port=12345'],
    environment: { ELECTRON_RUN_AS_NODE: '1' },
    platform: 'darwin',
    hasDisplay: false
  })
  check(
    desktopLaunch.command === '/packaged/Kun' && desktopLaunch.env.ELECTRON_RUN_AS_NODE === undefined,
    'Packaged desktop Chromium smoke must launch normal Electron without ELECTRON_RUN_AS_NODE'
  )
  const linuxDesktopLaunch = packagedDesktopSmokeModule.createDesktopLaunchPlan({
    executable: '/packaged/kun',
    applicationArguments: ['--remote-debugging-port=12345'],
    environment: {},
    platform: 'linux',
    hasDisplay: false,
    xvfbExecutable: 'xvfb-run'
  })
  check(
    linuxDesktopLaunch.command === 'xvfb-run' && linuxDesktopLaunch.args.includes('/packaged/kun'),
    'Packaged desktop Chromium smoke must support a Linux xvfb-run launch'
  )
}
if (typeof packagedDesktopSmokeModule.createIsolatedEnvironment === 'function') {
  const isolatedDesktopEnvironment = packagedDesktopSmokeModule.createIsolatedEnvironment(
    {
      ELECTRON_RENDERER_URL: 'http://localhost:5173',
      KUN_RUNTIME_TOKEN: 'inherited',
      DEEPSEEK_API_KEY: 'inherited'
    },
    {
      home: '/isolated-home',
      appData: '/isolated-app-data',
      localAppData: '/isolated-local-app-data',
      temporaryDirectory: '/isolated-tmp'
    }
  )
  check(
    isolatedDesktopEnvironment.ELECTRON_RENDERER_URL === undefined &&
      isolatedDesktopEnvironment.KUN_RUNTIME_TOKEN === undefined &&
      isolatedDesktopEnvironment.DEEPSEEK_API_KEY === undefined,
    'Packaged desktop Chromium smoke must scrub inherited renderer and runtime/model overrides'
  )
}
check(
  packagedDesktopSmokeModule.isWorkbenchTarget?.({
    type: 'page',
    url: 'http://localhost:5173/'
  }) === false,
  'Packaged desktop Chromium smoke must reject a development renderer target'
)

const packagedAppImageSmoke = await text('scripts/smoke-packaged-extension-appimage.cjs')
const packagedAppImageSmokeModule = require(join(root, 'scripts/smoke-packaged-extension-appimage.cjs'))
check(
  rootPackage.scripts?.['smoke:packaged-extension-appimage'] ===
    'node ./scripts/smoke-packaged-extension-appimage.cjs',
  'package.json must expose the final Linux AppImage Extension smoke command'
)
check(
  rootPackage.scripts?.['configure:linux-chrome-sandbox'] === undefined,
  'package.json must not expose a privileged Chromium SUID helper configuration command'
)
check(
  rootPackage.scripts?.['check:extension-release-gate']?.includes(
    './scripts/smoke-packaged-extension-appimage.test.cjs'
  ),
  'Extension release gate must execute the final Linux AppImage smoke tests'
)
check(
  rootPackage.scripts?.['check:extension-release-gate']?.includes('./scripts/after-pack.test.cjs'),
  'Extension release gate must execute the Linux product launcher tests'
)
for (const marker of [
  'installLinuxElectronLauncher',
  'linuxElectronLauncherContent',
  'assertElfExecutable',
  'electronFuses cannot be applied',
  'chmodSync(realExecutable, 0o755)',
  'ELECTRON_RUN_AS_NODE',
  '--disable-setuid-sandbox',
  'exec "$real_executable" "$@"',
  'exec "$real_executable" ${LINUX_SANDBOX_LAUNCHER_FLAG} "$@"'
]) check(afterPackSource.includes(marker), `Linux product launcher omits release contract: ${marker}`)
const approvedLinuxLauncher = afterPack._internals.linuxElectronLauncherContent('kun-gui')
check(
  approvedLinuxLauncher.includes('launcher_path=$PWD/$0') &&
    approvedLinuxLauncher.includes('pwd -P') &&
    !approvedLinuxLauncher.includes('dirname') &&
    !approvedLinuxLauncher.includes('readlink') &&
    !approvedLinuxLauncher.includes('--no-sandbox'),
  'Linux product launcher must never disable all Chromium sandboxing'
)
for (const marker of [
  '--appimage-extract',
  'squashfs-root',
  'inspectExtractedAppImageBundle',
  '--desktop-executable',
  'APPIMAGE_EXTRACT_AND_RUN',
  'candidates.length !== 1',
  'chmodSync',
  'shell: false'
]) {
  check(packagedAppImageSmoke.includes(marker), `Final Linux AppImage smoke omits fail-closed marker: ${marker}`)
}
for (const marker of [
  'lstatSync',
  'realpathSync',
  'isSymbolicLink()',
  "entry.name.endsWith('.desktop')",
  'linuxElectronLauncherContent',
  'linuxRealExecutableName',
  "Exec=AppRun --disable-setuid-sandbox --no-first-run %U"
]) check(packagedAppImageSmoke.includes(marker), `AppImage extraction validation omits: ${marker}`)
check(
  packagedAppImageSmokeModule.APPIMAGE_FILE_PATTERN?.test(
    'Kun-1.2.3-linux-x86_64.AppImage'
  ) === true &&
    packagedAppImageSmokeModule.APPIMAGE_FILE_PATTERN?.test(
      'Kun-1.2.3-linux-arm64.AppImage'
    ) === false,
  'Final Linux AppImage smoke must select only the canonical x86_64 artifact'
)
if (typeof packagedAppImageSmokeModule.createAppImageSmokeInvocation === 'function') {
  const invocation = packagedAppImageSmokeModule.createAppImageSmokeInvocation({
    appImage: '/release/Kun-1.2.3-linux-x86_64.AppImage',
    appRoot: '/extract/squashfs-root',
    appRun: '/extract/squashfs-root/AppRun',
    resourcesDir: '/extract/squashfs-root/resources',
    desktopSmokePath: '/repo/scripts/smoke-packaged-extension-desktop.cjs',
    environment: { APPDIR: '/untrusted', APPIMAGE: '/untrusted', ELECTRON_RUN_AS_NODE: '1' }
  })
  check(
    invocation.command === process.execPath &&
      invocation.options.env.APPIMAGE_EXTRACT_AND_RUN === undefined &&
      invocation.options.env.ELECTRON_RUN_AS_NODE === undefined &&
      invocation.options.env.APPDIR === resolve('/extract/squashfs-root') &&
      invocation.options.env.APPIMAGE === resolve('/release/Kun-1.2.3-linux-x86_64.AppImage') &&
      invocation.args.includes('--desktop-executable') &&
      invocation.args.includes(resolve('/extract/squashfs-root/AppRun')) &&
      invocation.args.includes(resolve('/extract/squashfs-root/resources')) &&
      invocation.options.timeout === undefined &&
      invocation.options.killSignal === undefined &&
      !invocation.args.some((argument) => argument.endsWith('app.asar')),
    'Final Linux AppImage smoke must launch the verified AppRun with bounded desktop cleanup'
  )
}

const electronBuilderConfig = await text('electron-builder.config.cjs')
check(
  electronBuilderConfig.includes(
    "executableArgs: ['--disable-setuid-sandbox', '--no-first-run']"
  ) &&
    !electronBuilderConfig.includes('--no-sandbox') &&
    !packagedDesktopSmoke.includes("'--disable-setuid-sandbox'"),
  'Linux packaging and native smokes must retain user namespace and seccomp sandboxing'
)
check(
  /process\.env\.CI\s*===\s*'true'/.test(packagedDesktopSmoke) &&
    /KUN_CI_ALLOW_NO_SANDBOX\s*===\s*'1'/.test(packagedDesktopSmoke) &&
    (packagedDesktopSmoke.match(/'--no-sandbox'/g) ?? []).length === 1,
  'Linux desktop smoke --no-sandbox may only appear behind the CI escape hatch'
)
check(
  electronBuilderConfig.includes("{ target: 'deb', arch: ['arm64', 'x64'] }") &&
    String(rootPackage.scripts?.['dist:linux:x64'] || '').includes('deb') &&
    String(rootPackage.scripts?.['dist:linux:arm64'] || '').includes('deb'),
  'Linux packaging must ship both AppImage and deb for Debian-family installers'
)
