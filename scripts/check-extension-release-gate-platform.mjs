import { assertNativeBootstrapLock } from './lib/native-bootstrap-lock.mjs'
import {
  apiContract,
  check,
  collectSourceFiles,
  join,
  major,
  pathToFileURL,
  problems,
  readFile,
  relative,
  requireKun,
  requireOrderedSourceMarkers,
  requirePath,
  root,
  sameNumbers,
  text,
  json
} from './check-extension-release-gate-context.mjs'

const implementationRoots = [
  'kun/src',
  'src/main',
  'src/preload',
  'src/renderer/src',
  'packages/extension-api/src',
  'packages/extension-react/src',
  'packages/extension-test/src',
  'packages/create-kun-extension/src'
]
const forbiddenGatePatterns = [
  /\bKUN_(?:ENABLE|DISABLE)_EXTENSIONS?\b/,
  /\bKUN_EXTENSION_PLATFORM_(?:ENABLED|DISABLED|GATE)\b/,
  /\bENABLE_KUN_EXTENSION_PLATFORM\b/,
  /\bVITE_KUN_EXTENSIONS?(?:_ENABLED)?\b/,
  /\bextensionPlatform(?:Enabled|Gate)\b/,
  /\benableExtensionPlatform\b/
]
for (const sourceRoot of implementationRoots) {
  const absoluteRoot = join(root, sourceRoot)
  for (const path of await collectSourceFiles(absoluteRoot)) {
    const source = await readFile(path, 'utf8')
    for (const pattern of forbiddenGatePatterns) {
      if (pattern.test(source)) {
        problems.push(`Internal Extension Platform gate remains in ${relative(root, path)} (${pattern})`)
      }
    }
  }
}

const runtimeInfoSource = await text('kun/src/server/runtime-composition-runtime.ts')
check(
  /extensions\s*:\s*\{[\s\S]{0,240}?enabled\s*:\s*true/.test(runtimeInfoSource),
  'Kun runtime info does not expose the Extension Platform as unconditionally enabled'
)
check(
  runtimeInfoSource.includes('SUPPORTED_EXTENSION_API_VERSIONS'),
  'Kun runtime does not derive reported Extension API versions from the canonical SDK contract'
)
const serveEntry = await text('kun/src/cli/serve-entry.ts')
check(
  serveEntry.includes("argv[0] === 'extension'") && serveEntry.includes('runExtensionCommand'),
  'The public `kun extension` CLI dispatch is absent or gated'
)
const mainEntry = [
  await text('src/main/index.ts'),
  await text('src/main/main-lifecycle.ts'),
  await text('src/main/main-app-context.ts'),
  await text('src/main/main-ready-ipc.ts')
].join('\n')
check(
  mainEntry.includes('registerKunExtensionPlatformSchemesAsPrivileged') &&
    mainEntry.includes('registerExtensionIpcHandlers'),
  'Electron does not register the public Extension/media protocols and IPC bridge'
)
const stageRouter = await text('src/renderer/src/components/workbench/WorkbenchStageRouter.tsx')
check(
  stageRouter.includes("normalizedRoute === 'extensions'") &&
    stageRouter.includes('ExtensionManagementCenter'),
  'The public Extension management route is absent from the workbench'
)

// Verify the executable current/previous-major policy, including the v1 exception.
const apiDistPath = join(root, 'packages/extension-api/dist/index.js')
let api
try {
  api = await import(pathToFileURL(apiDistPath).href)
} catch (error) {
  problems.push(
    `Cannot load built @kun/extension-api for compatibility checks; run its build first (${error instanceof Error ? error.message : String(error)})`
  )
}

if (api) {
  const supportedVersions = [...api.SUPPORTED_EXTENSION_API_VERSIONS]
  const currentVersion = api.CURRENT_EXTENSION_API_VERSION
  const currentMajor = major(currentVersion)
  apiContract.currentApiVersion = currentVersion
  apiContract.currentApiMajor = currentMajor
  apiContract.canonicalSupportedApiVersions = supportedVersions
  const supportedMajors = api.supportedApiMajors(supportedVersions)
  const expectedMajors = currentMajor === 1 ? [1] : [currentMajor, currentMajor - 1]

  check(
    supportedVersions[0] === currentVersion,
    'Current Extension API version must be first in the supported-version list'
  )
  check(
    sameNumbers(supportedMajors, expectedMajors),
    `Supported Extension API majors must be ${expectedMajors.join(', ')}, got ${supportedMajors.join(', ')}`
  )
  check(
    sameNumbers(
      [...new Set(supportedVersions.map(major))].sort((a, b) => b - a),
      expectedMajors
    ),
    'Canonical supported Extension API versions do not contain exactly current and previous majors'
  )

  const sdkPackage = await json('packages/extension-api/package.json')
  check(
    major(sdkPackage.version) === currentMajor,
    `@kun/extension-api package major ${sdkPackage.version} does not match API major ${currentMajor}`
  )

  const fixture = await json('packages/extension-api/fixtures/api-major-negotiation.json')
  const fixtureCurrentMajor = major(fixture.host.current)
  const fixturePreviousMajor = major(fixture.host.previous)
  check(
    fixtureCurrentMajor === fixturePreviousMajor + 1,
    'API negotiation fixture does not model adjacent current and previous majors'
  )
  for (const name of [
    'current major',
    'previous major',
    'removed major',
    'future major',
    'future minor',
    'required capability missing'
  ]) {
    check(
      fixture.cases.some((entry) => entry.name === name),
      `API negotiation fixture is missing case: ${name}`
    )
  }
  for (const testCase of fixture.cases) {
    const result = api.negotiateApiVersion({
      declaredApiVersion: testCase.declaredApiVersion,
      supportedApiVersions: [fixture.host.current, fixture.host.previous],
      requiredCapabilities: testCase.requiredCapabilities,
      capabilitiesByVersion: fixture.host.capabilitiesByVersion
    })
    check(result.compatible === testCase.compatible, `Compatibility fixture failed: ${testCase.name}`)
    if (result.compatible) {
      check(result.adapter === testCase.adapter, `Compatibility adapter mismatch: ${testCase.name}`)
    } else {
      check(result.code === testCase.code, `Compatibility error mismatch: ${testCase.name}`)
    }
  }

  const minorFixture = await json('packages/extension-api/fixtures/api-minor-negotiation.json')
  check(
    sameNumbers(
      minorFixture.host.supportedApiVersions.map((version) => {
        const [versionMajor, versionMinor] = version.split('.').map(Number)
        return versionMajor * 1_000 + versionMinor
      }),
      [1_002, 1_001, 1_000]
    ),
    'API v1.2/v1.1/v1.0 negotiation fixture must retain current and legacy minor support in order'
  )
  for (const name of [
    'current v1.2 manifest',
    'previous v1.1 manifest',
    'legacy v1.0 manifest',
    'future v1 minor',
    'unsupported major'
  ]) {
    check(
      minorFixture.cases.some((entry) => entry.name === name),
      `API minor negotiation fixture is missing case: ${name}`
    )
  }
  for (const testCase of minorFixture.cases) {
    const result = api.negotiateApiVersion({
      declaredApiVersion: testCase.declaredApiVersion,
      supportedApiVersions: minorFixture.host.supportedApiVersions,
      requiredCapabilities: testCase.requiredCapabilities,
      capabilitiesByVersion: minorFixture.host.capabilitiesByVersion
    })
    check(
      result.compatible === testCase.compatible,
      `API v1.2/v1.1/v1.0 compatibility fixture failed: ${testCase.name}`
    )
    if (result.compatible) {
      check(
        result.negotiatedApiVersion === testCase.negotiatedApiVersion,
        `API minor negotiated version mismatch: ${testCase.name}`
      )
    } else {
      check(result.code === testCase.code, `API minor compatibility error mismatch: ${testCase.name}`)
    }
  }

  const actualCurrent = api.negotiateApiVersion({
    declaredApiVersion: currentVersion,
    supportedApiVersions: supportedVersions,
    requiredCapabilities: [],
    capabilitiesByVersion: {}
  })
  check(actualCurrent.compatible, `Published current API ${currentVersion} cannot negotiate with Kun`)
  const actualFuture = api.negotiateApiVersion({
    declaredApiVersion: `${currentMajor + 1}.0.0`,
    supportedApiVersions: supportedVersions,
    requiredCapabilities: [],
    capabilitiesByVersion: {}
  })
  check(
    !actualFuture.compatible && actualFuture.code === 'API_MAJOR_UNSUPPORTED',
    'Future Extension API major is not rejected fail-closed'
  )

  for (const docPath of [
    'docs/extensions/README.md',
    'docs/extensions/README.en.md',
    'docs/extensions/api-reference.md',
    'docs/extensions/api-reference.en.md',
    'docs/extensions/release-troubleshooting-changelog.md',
    'docs/extensions/release-troubleshooting-changelog.en.md'
  ]) {
    check((await text(docPath)).includes(`v${currentMajor}`), `${docPath} does not identify API v${currentMajor}`)
  }
}

const mediaProtocolSource = (await Promise.all([
  'src/main/extensions/extension-media-protocol.ts',
  'src/main/extensions/extension-media-protocol-registry.ts',
  'src/main/extensions/extension-media-protocol-types.ts',
  'src/main/extensions/extension-media-protocol-utils.ts',
  'src/main/extensions/extension-view-sessions.ts'
].map(text))).join('\n')
const mediaProtocolTests = await text('src/main/extensions/extension-media-protocol.test.ts')
for (const marker of [
  "scheme: KUN_MEDIA_SCHEME",
  'bypassCSP: false',
  'maxConcurrentStreamsPerLease',
  'fileIdentity',
  'viewSessionId'
]) {
  check(mediaProtocolSource.includes(marker), `kun-media protocol omits isolation marker: ${marker}`)
}
for (const marker of [
  'rejects copied URLs in another isolated View and stale sessions',
  'serves HEAD, full GET and single byte ranges with exact headers',
  'uses a bounded stream window and enforces concurrent-reader quotas',
  'aborts active streams and revokes URLs on View and extension lifecycle cleanup'
]) {
  check(mediaProtocolTests.includes(marker), `kun-media protocol tests omit security case: ${marker}`)
}
const mediaProcessSource = (await Promise.all([
  'kun/src/services/extension-media-process-service.ts',
  'kun/src/services/extension-media-process-service-core.ts',
  'kun/src/services/extension-media-process-service-process-discovery.ts'
].map(text))).join('\n')
const mediaProcessTests = await text('kun/src/services/extension-media-process-service.test.ts')
for (const marker of ['shell: false', "detached: process.platform !== 'win32'", 'terminateSpawnTree(child)']) {
  check(mediaProcessSource.includes(marker), `Native media process supervision omits marker: ${marker}`)
}
check(
  mediaProcessTests.includes('terminates the supervised descendant process tree on cancellation'),
  'Native media process tests do not prove descendant cleanup on cancellation'
)

// Appearance packs, MCP, Skills, and existing HTTP/SSE runtime paths remain
// independent public surfaces. The full test suites exercise their behavior;
// this gate prevents accidental deletion, absorption into .kunx, or CI omission.
const legacyPaths = [
  'src/main/services/ui-plugin-service.ts',
  'src/renderer/src/components/PluginMarketplaceView.tsx',
  'src/renderer/src/store/ui-plugin-store.ts',
  'kun/src/adapters/tool/mcp-tool-provider.ts',
  'kun/src/server/routes/mcp-oauth.ts',
  'kun/src/skills/skill-runtime.ts',
  'kun/src/server/routes/skills.ts',
  'src/main/services/ui-plugin-service.test.ts',
  'src/renderer/src/components/PluginMarketplaceView.test.ts',
  'kun/src/adapters/tool/mcp-tool-provider.test.ts',
  'src/main/services/skill-service.test.ts'
]
await Promise.all(legacyPaths.map((path) => requirePath(path, 'legacy non-regression surface')))

for (const path of [
  'scripts/check-extension-external-project.mjs',
  'scripts/check-extension-release-execution.test.mjs',
  'scripts/fixtures/external-extension-project/LICENSE',
  'scripts/fixtures/external-extension-project/README.md',
  'scripts/fixtures/external-extension-project/package.template.json',
  'scripts/fixtures/external-extension-project/kun-extension.json',
  'scripts/fixtures/external-extension-project/src/extension.ts',
  'scripts/fixtures/external-extension-project/tsconfig.json',
  'scripts/fixtures/external-extension-project/view/index.html',
  'scripts/fixtures/external-extension-project/acceptance.mjs'
]) {
  await requirePath(path, 'external packaged-artifact acceptance fixture')
}

const legacyPreload = await text('src/preload/index.ts')
check(
  legacyPreload.includes("ipcRenderer.invoke('ui-plugin:list'") &&
    legacyPreload.includes("ipcRenderer.invoke('skill:list'") &&
    legacyPreload.includes("ipcRenderer.invoke('skill:list-roots'"),
  'Legacy UI Plugin or Skill preload methods were removed'
)
const managementCenter = await text('src/renderer/src/extensions/ExtensionManagementCenter.tsx')
check(
  managementCenter.includes('Looking for UI appearance packs, MCP, or Skills?') &&
    managementCenter.includes('Those systems remain separate'),
  'Extension management no longer tells users that UI appearance packs, MCP, and Skills remain separate'
)
const routeIndex = (await Promise.all([
  'kun/src/server/routes/index.ts',
  'kun/src/server/routes/register-core-routes.ts',
  'kun/src/server/routes/register-resource-routes.ts',
  'kun/src/server/routes/register-thread-routes.ts'
].map(text))).join('\n')
for (const route of [
  "'/v1/mcp/oauth'",
  "'/v1/skills'",
  "'/v1/threads'",
  "'/v1/threads/:id/events'",
  "'/v1/approvals/:id'",
  "'/v1/user-inputs/:id'",
  "'/v1/usage'"
]) {
  check(routeIndex.includes(route), `Legacy Kun runtime route disappeared: ${route}`)
}
const runtimeCompositionSource = (await Promise.all([
  'kun/src/server/runtime-composition-services.ts',
  'kun/src/server/runtime-composition-runtime.ts'
].map(text))).join('\n')
for (const marker of ['mcpProviders.providers', 'buildSkillToolProviders(skillRuntime)', 'mcpServers:', 'skills:']) {
  check(runtimeCompositionSource.includes(marker), `Legacy Kun runtime composition disappeared: ${marker}`)
}
const extensionBackendSources = await Promise.all(
  (await collectSourceFiles(join(root, 'kun/src/extensions'))).map(async (path) => [path, await readFile(path, 'utf8')])
)
for (const [path, source] of extensionBackendSources) {
  check(
    !/from\s+['"][^'"]*(?:ui-plugin|\/mcp|\/skills?)[^'"]*['"]/.test(source),
    `.kunx backend imports a legacy Plugin/MCP/Skill lifecycle: ${relative(root, path)}`
  )
  check(
    !source.includes('.kun/ui-plugins'),
    `.kunx backend reuses the legacy appearance-pack directory: ${relative(root, path)}`
  )
}

// A clean npm ci must build the public API before Kun resolves its file-linked
// package. Keep postinstall on the canonical build:kun sequence so release
// runners cannot accidentally compile Kun against a missing SDK dist directory.
export const rootPackage = await json('package.json')
const buildKunBootstrap = rootPackage.scripts?.['build:kun'] ?? ''
requireOrderedSourceMarkers(buildKunBootstrap, 'package.json build:kun bootstrap', [
  'npm run build --workspace @kun/extension-api',
  'node ./scripts/ensure-kun-install.cjs',
  'npm --prefix kun run build'
])
const postinstallSource = await text('scripts/postinstall.cjs')
const canonicalPostinstallBuild = "run('npm', ['run', 'build:kun'])"
check(
  postinstallSource.includes(canonicalPostinstallBuild),
  'Root postinstall must delegate to the canonical build:kun bootstrap'
)
check(
  !/require\(['"]\.\/ensure-kun-install\.cjs['"]\)/.test(postinstallSource),
  'Root postinstall must not install/build Kun before Extension API dist exists'
)
check(
  postinstallSource.indexOf(canonicalPostinstallBuild) <
    postinstallSource.indexOf("require('electron/package.json')"),
  'Root postinstall must complete the Extension API/Kun bootstrap before native rebuilds'
)
const kunLock = await json('kun/package-lock.json')
const kunPackage = await json('kun/package.json')
for (const [dependency, version] of [
  ['typescript', '5.9.3'],
  ['typescript-language-server', '5.3.0']
]) {
  check(
    kunPackage.dependencies?.[dependency] === version,
    `Kun must pin bundled ${dependency}@${version} as a production dependency`
  )
  check(
    kunLock.packages?.['']?.dependencies?.[dependency] === version &&
      kunLock.packages?.[`node_modules/${dependency}`]?.dev !== true,
    `Kun lockfile does not retain bundled production dependency ${dependency}@${version}`
  )
}
const ensureKunInstallSource = await text('scripts/ensure-kun-install.cjs')
for (const path of [
  'kun/node_modules/typescript/package.json',
  'kun/node_modules/typescript/lib/typescript.js',
  'kun/node_modules/typescript-language-server/package.json',
  'kun/node_modules/typescript-language-server/lib/cli.mjs'
]) {
  check(
    ensureKunInstallSource.includes(`'${path}'`),
    `Kun bootstrap does not require bundled LSP resource: ${path}`
  )
}
const semver = requireKun('semver')
try {
  assertNativeBootstrapLock(kunLock, semver)
} catch (error) {
  check(false, error.message)
}

// Static packaged-resource and cross-platform release coverage.
