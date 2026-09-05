const { existsSync, readFileSync } = require('node:fs')
const { join } = require('node:path')
const {
  configureElectronNativeBuildEnvironment
} = require('./scripts/electron-native-build-env.cjs')
const {
  KUN_ROOT_UNPACKED_SHARED_JS_PACKAGES
} = require('./scripts/after-pack-hoisted-dependencies.cjs')

// 品牌升级后构建环境变量改用 KUN_* 前缀;旧的 DEEPSEEK_GUI_* 仍然
// 兼容读取,避免 CI / 本地发布脚本一刀切失效。
function envWithLegacyFallback(kunName, legacyName) {
  const value = process.env[kunName]
  if (value !== undefined && value !== '') return value
  return process.env[legacyName]
}

function loadLocalReleaseEnv() {
  const candidates = [
    envWithLegacyFallback('KUN_RELEASE_ENV', 'DEEPSEEK_GUI_RELEASE_ENV'),
    join(__dirname, 'scripts', 'release.local.env'),
    join(__dirname, 'release.local.env')
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    for (const rawLine of readFileSync(candidate, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
      if (!match) continue
      let value = match[2].trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (!process.env[match[1]]) process.env[match[1]] = value
    }
    break
  }
}

loadLocalReleaseEnv()
configureElectronNativeBuildEnvironment(process.platform, process.env)

const hasExplicitMacSigningIdentity = Boolean(
  process.env.CSC_LINK ||
    process.env.CSC_NAME ||
    process.env.CSC_KEY_PASSWORD ||
    process.env.MAC_SIGN === '1'
)

const hasNotaryToolCredentials = Boolean(
  process.env.APPLE_API_KEY_ID &&
    process.env.APPLE_API_ISSUER &&
    (process.env.APPLE_API_KEY || process.env.APPLE_API_KEY_BASE64)
)

// R2 release prefix 维持旧值不动:线上老版本轮询的就是
// `…/deepseek-gui/channels/<channel>/latest/`,prefix 一改老客户端就再也
// 收不到更新。默认公开域名优先使用 kun-agent,运行时仍会兜底旧域名。
const r2PublicBaseUrl = (process.env.R2_PUBLIC_BASE_URL || 'https://www.kun-agent.com/api/r2')
  .trim()
  .replace(/\/+$/, '')
const r2ReleasePrefix = (process.env.R2_RELEASE_PREFIX || 'deepseek-gui')
  .trim()
  .replace(/^\/+|\/+$/g, '')
const updateChannel = normalizeUpdateChannel(
  envWithLegacyFallback('KUN_UPDATE_CHANNEL', 'DEEPSEEK_GUI_UPDATE_CHANNEL') || 'stable'
)
const genericUpdateUrl = `${r2PublicBaseUrl}/${r2ReleasePrefix}/channels/${updateChannel}/latest/`
const releaseAppVersion = (
  envWithLegacyFallback('KUN_APP_VERSION', 'DEEPSEEK_GUI_APP_VERSION') || ''
).trim()
const releaseArtifactVersion = (
  envWithLegacyFallback('KUN_ARTIFACT_VERSION', 'DEEPSEEK_GUI_ARTIFACT_VERSION') || ''
).trim()
const artifactVersion = releaseArtifactVersion || releaseAppVersion || '${version}'
const semverVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const artifactVersionPattern = /^[0-9A-Za-z][0-9A-Za-z._-]*$/
const chromiumPakLanguages = ['en-US', 'en-GB', 'zh-CN', 'zh-TW', 'ru', 'hi', 'th', 'ja', 'ko']
const chromiumMacLanguages = ['en', 'en_GB', 'zh_CN', 'zh_TW', 'ru', 'hi', 'th', 'ja', 'ko']
const appFlavor = normalizeAppFlavor(process.env.KUN_APP_FLAVOR || 'production')
const developmentFlavor = appFlavor === 'development'
const appId = developmentFlavor
  ? 'com.xingyuzhong.deepseekgui.dv'
  : 'com.xingyuzhong.deepseekgui'
const productName = developmentFlavor ? 'kun-dv' : 'Kun'
const linuxBuildArch = normalizeOptionalLinuxBuildArch(process.env.KUN_LINUX_BUILD_ARCH)

function normalizeUpdateChannel(raw) {
  const value = String(raw || '').trim()
  if (value === 'stable' || value === 'frontier') return value
  throw new Error(`KUN_UPDATE_CHANNEL (or legacy DEEPSEEK_GUI_UPDATE_CHANNEL) must be "stable" or "frontier", got: ${raw}`)
}

function normalizeAppFlavor(raw) {
  const value = String(raw || '').trim()
  if (value === 'production' || value === 'development') return value
  throw new Error(`KUN_APP_FLAVOR must be "production" or "development", got: ${raw}`)
}

function normalizeOptionalLinuxBuildArch(raw) {
  const value = String(raw || '').trim()
  if (!value) return undefined
  if (value === 'x64' || value === 'arm64') return value
  throw new Error(`KUN_LINUX_BUILD_ARCH must be "x64" or "arm64", got: ${raw}`)
}

if (releaseAppVersion && !semverVersionPattern.test(releaseAppVersion)) {
  throw new Error(
    `KUN_APP_VERSION (or legacy DEEPSEEK_GUI_APP_VERSION) must be a valid semver for electron-updater, got: ${releaseAppVersion}`
  )
}

if (releaseArtifactVersion && !artifactVersionPattern.test(releaseArtifactVersion)) {
  throw new Error(
    `KUN_ARTIFACT_VERSION (or legacy DEEPSEEK_GUI_ARTIFACT_VERSION) must use only letters, numbers, dots, dashes, and underscores, got: ${releaseArtifactVersion}`
  )
}

module.exports = {
  // 正式版 appId 永远保持旧值；DV 使用独立 appId，绝不进入正式更新链路：
  //  - macOS 端 Squirrel.Mac 校验更新包签名时锚定 bundle identifier,
  //    换了 id 老版本会拒绝安装新版本;
  //  - Windows 端 NSIS 以 appId 派生卸载 GUID,换了 id 升级安装不会
  //    卸载旧版本,用户会装出两份应用;
  //  - macOS TCC 权限、通知授权也都挂在这个 id 上。
  appId,
  productName,
  asar: true,
  asarUnpack: [
    '**/kun/dist/**/*',
    '**/kun/package*.json',
    '**/kun/node_modules/**/*',
    '**/packages/extension-api/**/*',
    '**/packages/provider-catalog/**/*',
    '**/packages/create-kun-extension/**/*',
    '**/node_modules/better-sqlite3/**/*',
    '**/node_modules/node-pty/**/*',
    '**/node_modules/bindings/**/*',
    '**/node_modules/file-uri-to-path/**/*',
    // Computer-use native automation (@computer-use/nut-js + its libnut
    // binding + node-mac-permissions) ships prebuilt .node files that must
    // live outside the asar archive to load.
    '**/node_modules/@computer-use/**/*',
    // CUA Driver is a Rust/UniFFI native SDK. Keep the generated JS, selected
    // platform library, and Node runtime outside ASAR for Electron Main.
    '**/node_modules/@trycua/**/*',
    '**/node_modules/@ubjs/**/*',
    // OCR fallback loads native canvas bindings plus Tesseract worker/core
    // wasm and language data by filesystem path at runtime.
    '**/node_modules/@napi-rs/canvas*/**/*',
    // Shared JS runtimes that the packaged Kun child process resolves upward
    // from kun/node_modules after after-pack removes its duplicate copies.
    // They must exist on disk under app.asar.unpacked/node_modules.
    ...KUN_ROOT_UNPACKED_SHARED_JS_PACKAGES.map(
      (packageName) => `**/node_modules/${packageName}/**/*`
    ),
    // UI Plugin image validation uses Sharp's native binding and its separately
    // packaged libvips runtime; both must remain outside app.asar.
    '**/node_modules/sharp/**/*',
    '**/node_modules/@img/**/*',
    '**/node_modules/tesseract.js/**/*',
    '**/node_modules/tesseract.js-core/**/*',
    '**/node_modules/@tesseract.js-data/**/*',
    '**/node_modules/bmp-js/**/*',
    '**/node_modules/idb-keyval/**/*',
    '**/node_modules/is-url/**/*',
    '**/node_modules/node-fetch/**/*',
    '**/node_modules/whatwg-url/**/*',
    '**/node_modules/tr46/**/*',
    '**/node_modules/webidl-conversions/**/*',
    '**/node_modules/regenerator-runtime/**/*',
    '**/node_modules/wasm-feature-detect/**/*',
    '**/node_modules/zlibjs/**/*'
  ],
  npmRebuild: true,
  directories: {
    output: envWithLegacyFallback('KUN_DIST_DIR', 'DEEPSEEK_GUI_DIST_DIR') || 'dist'
  },
  files: [
    'out/**/*',
    'package.json',
    'kun/dist/**/*',
    'kun/package.json',
    'kun/package-lock.json',
    'kun/node_modules/**/*',
    'packages/extension-api/package.json',
    'packages/extension-api/dist/**/*',
    'packages/extension-api/schema/**/*',
    'packages/extension-api/fixtures/**/*',
    'packages/provider-catalog/package.json',
    'packages/provider-catalog/dist/**/*',
    'packages/create-kun-extension/package.json',
    'packages/create-kun-extension/src/**/*',
    // The Agent SDK ships a ~222MB per-platform Claude Code binary as an optional
    // dep; do NOT bundle it into the installer. It's downloaded on demand into the
    // user-data dir (see src/main/agent-sdk-installer.ts). The small SDK JS stays.
    '!kun/node_modules/@anthropic-ai/claude-agent-sdk-*/**',
    '!**/*.map',
    '!**/*.d.ts',
    '!**/*.ts',
    '!**/tsconfig*.json',
    '!**/README*',
    '!**/CHANGELOG*',
    'packages/create-kun-extension/templates/**/*',
    // @computer-use/libnut-linux currently publishes an x86-64 libnut.node
    // even though its npm metadata also declares arm64. Keep that incompatible
    // binary out of ARM64 packages; HostController already degrades the optional
    // Computer Use backend when its runtime-only import is unavailable.
    ...(linuxBuildArch === 'arm64'
      ? ['!**/node_modules/@computer-use/libnut-linux/**/*']
      : [])
    // node_modules/openclaw (the vendor/openclaw-shim file: dep) must ship:
    // the WeChat bridge imports @tencent-weixin/openclaw-weixin/dist at
    // runtime to send media, and that chain resolves openclaw/plugin-sdk/*.
  ],
  extraResources: [
    {
      // Ship third-party prompt attribution with packaged applications, not
      // only in source checkouts.
      from: 'THIRD_PARTY_NOTICES.md',
      to: 'THIRD_PARTY_NOTICES.md'
    },
    {
      from: 'build',
      to: 'installer-recovery',
      filter: ['windows-installer-migration*.ps1']
    },
    {
      from: 'resources/bundled-extensions',
      to: 'bundled-extensions',
      filter: ['catalog.json', '*.kunx']
    },
    {
      from: 'resources/bundled-skills',
      to: 'bundled-skills',
      filter: ['**/*']
    },
    {
      from: 'resources/whisper',
      to: 'whisper',
      filter: ['**/*']
    },
    {
      from: 'resources/officecli/current',
      to: 'officecli',
      filter: ['officecli', 'officecli.exe', 'selected.json']
    },
    {
      from: 'resources/ppt-toolchain',
      to: 'ppt-toolchain',
      filter: ['**/*']
    },
    {
      from: 'resources/officecli/manifest.json',
      to: 'officecli/manifest.json'
    },
    {
      from: 'resources/officecli/legal',
      to: 'officecli/legal',
      filter: ['LICENSE', 'NOTICE', 'THIRD-PARTY-NOTICES.txt']
    },
  ],
  artifactName: `${productName}-${artifactVersion}-\${os}-\${arch}.\${ext}`,
  ...(developmentFlavor
    ? { publish: [] }
    : {
        publish: [
          {
            provider: 'generic',
            url: genericUpdateUrl
          }
        ]
      }),
  beforePack: './scripts/before-pack.cjs',
  afterPack: './scripts/after-pack.cjs',
  afterSign: './scripts/mac-notarize.cjs',
  mac: {
    // macOS stores Chromium locales in language-named .lproj directories.
    electronLanguages: chromiumMacLanguages,
    category: 'public.app-category.developer-tools',
    identity: hasExplicitMacSigningIdentity ? undefined : null,
    // We notarize in scripts/mac-notarize.cjs so APPLE_API_KEY_BASE64 can be supported.
    notarize: false,
    hardenedRuntime: hasExplicitMacSigningIdentity,
    forceCodeSigning: hasExplicitMacSigningIdentity,
    timestamp: hasExplicitMacSigningIdentity ? 'http://timestamp.apple.com/ts01' : null,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.inherit.plist',
    extendInfo: {
      // 语音输入：渲染进程通过 getUserMedia 录音做语音转文字。
      NSMicrophoneUsageDescription: 'Kun uses the microphone for voice-to-text input.'
    },
    // macOS 不会自动套圆角遮罩,图标文件本身需要是「圆角方块 + 透明边距」
    icon: './src/asset/img/kun_mac.png',
    // arm64 (Apple Silicon) + x64 (Intel). On M 系列 Mac 本地打包会各出一组 dmg/zip。
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] }
    ]
  },
  dmg: {
    sign: hasExplicitMacSigningIdentity,
    // Volume name carries the same artifact version as artifactName so users
    // can tell installers apart in Finder; without release env overrides,
    // electron-builder expands the ${version} macro from package.json.
    title: `${productName} Installer ${artifactVersion}`,
    background: './build/dmg-background.png',
    iconSize: 88,
    iconTextSize: 13,
    window: {
      width: 660,
      height: 430
    },
    contents: [
      { x: 350, y: 310, type: 'file' },
      { x: 535, y: 310, type: 'link', path: '/Applications' }
    ]
  },
  win: {
    // Windows and Linux use BCP 47 locale names for Chromium .pak files.
    electronLanguages: chromiumPakLanguages,
    // Windows does not mask app icons for us; use the rounded asset so
    // desktop/start-menu/taskbar shortcuts do not show a hard square edge.
    // Ship a multi-size .ico (16/24/32/48/64/72/96/128/256) so Explorer and
    // the desktop render crisp icons at small sizes (#222). Regenerate with:
    // npx --yes png2icons src/asset/img/kun_mac.png build/icon -icowe -bc
    icon: './build/icon.ico',
    target: [{ target: 'nsis', arch: ['x64'] }]
  },
  nsis: {
    oneClick: false,
    installerHeader: './build/installerHeader.bmp',
    installerSidebar: './build/installerSidebar.bmp',
    uninstallerSidebar: './build/installerSidebar.bmp',
    // The stock assisted directory page appends APP_FILENAME by substring and
    // turns a registered `DeepSeek GUI` location into `DeepSeek GUI\Kun`.
    // installer.nsh adds one MUI directory page with component-aware migration.
    allowToChangeInstallationDirectory: false,
    perMachine: false,
    allowElevation: true,
    selectPerMachineByDefault: false,
    include: 'build/installer.nsh',
    // 明确创建快捷方式；always 在覆盖安装时也会重建（即使用户曾删掉桌面图标）
    createDesktopShortcut: 'always',
    createStartMenuShortcut: true,
    shortcutName: productName,
    uninstallDisplayName: productName,
    deleteAppDataOnUninstall: false
  },
  linux: {
    electronLanguages: chromiumPakLanguages,
    category: 'Development',
    icon: './src/asset/img/kun.png',
    maintainer: 'Kun Contributors <1736101137@qq.com>',
    // AppImage covers generic Linux; deb covers Debian-family installers such as
    // openKylin / Ubuntu that expect apt/software-store packages.
    target: [
      { target: 'AppImage', arch: ['arm64', 'x64'] },
      { target: 'deb', arch: ['arm64', 'x64'] }
    ]
  },
  // Override electron-builder's sandbox-disabling default desktop argument.
  // Linux uses user namespaces and seccomp; only the legacy SUID helper is disabled.
  // afterPack also installs a product launcher that prepends the same flag for
  // both AppImage and deb entrypoints (deb .desktop Exec hits that launcher).
  appImage: {
    executableArgs: ['--disable-setuid-sandbox', '--no-first-run']
  },
  extraMetadata: {
    ...(releaseAppVersion ? { version: releaseAppVersion } : {}),
    kunAppFlavor: appFlavor,
    updateChannel,
    buildHints: {
      macSigningEnabled: hasExplicitMacSigningIdentity,
      notarizationEnabled: hasNotaryToolCredentials
    }
  }
}
