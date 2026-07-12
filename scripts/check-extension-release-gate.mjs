import { access, readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { validateExtensionDocumentation } from './lib/extension-docs-validation.mjs'
import {
  assertExecutableApiConformance,
  expectedApiMajors,
  runRequiredCommand
} from './lib/extension-release-execution.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const requireKun = createRequire(join(root, 'kun', 'package.json'))
const problems = []
const LINUX_USER_NAMESPACE_STEP_NAME = 'Prepare and verify Linux user namespace sandbox'
const LINUX_USER_NAMESPACE_SETUP = [
  'if [[ -e /proc/sys/kernel/unprivileged_userns_clone ]]; then',
  '  sudo sysctl -w kernel.unprivileged_userns_clone=1',
  'fi',
  'if [[ -e /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]]; then',
  '  sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0',
  'fi',
  'unshare --user --map-root-user /bin/true'
].join('\n')
let currentApiVersion
let currentApiMajor
let canonicalSupportedApiVersions = []

const documentation = await validateExtensionDocumentation(root)
for (const problem of documentation.problems) problems.push(`Documentation/API gate: ${problem}`)

function check(condition, message) {
  if (!condition) problems.push(message)
}

async function text(relativePath) {
  return readFile(join(root, relativePath), 'utf8')
}

async function json(relativePath) {
  return JSON.parse(await text(relativePath))
}

async function requirePath(relativePath, label = relativePath) {
  try {
    await access(join(root, relativePath))
  } catch {
    problems.push(`Missing ${label}: ${relativePath}`)
  }
}

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'dist' || entry.name === 'node_modules') continue
      files.push(...(await collectSourceFiles(path)))
      continue
    }
    if (!/\.(?:cjs|mjs|ts|tsx)$/.test(entry.name) || /\.test\.[cm]?tsx?$/.test(entry.name)) continue
    files.push(path)
  }
  return files
}

function major(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version)
  if (!match) {
    problems.push(`Invalid SemVer in release gate: ${String(version)}`)
    return Number.NaN
  }
  return Number(match[1])
}

function sameNumbers(left, right) {
  return JSON.stringify([...left]) === JSON.stringify([...right])
}

function workflowJob(document, jobId, runner) {
  const job = document?.jobs?.[jobId]
  check(Boolean(job), `Workflow is missing job: ${jobId}`)
  if (!job) return undefined
  check(job['runs-on'] === runner, `Workflow job ${jobId} must run on ${runner}`)
  check(job.if === undefined, `Workflow job ${jobId} must not conditionally skip its release gates`)
  return job
}

function requireOrderedCommands(job, jobId, commands) {
  if (!job) return
  const steps = Array.isArray(job.steps) ? job.steps : []
  let priorIndex = -1
  for (const command of commands) {
    const index = steps.findIndex(
      (step, candidateIndex) =>
        candidateIndex > priorIndex &&
        typeof step?.run === 'string' &&
        step.run.split(/\r?\n/).some((line) => line.trim() === command) &&
        step.if === undefined &&
        (step['continue-on-error'] === undefined || step['continue-on-error'] === false)
    )
    check(index >= 0, `Workflow job ${jobId} must run after prior gates and fail on: ${command}`)
    if (index >= 0) priorIndex = index
  }
}

function requireBoundedJobTimeout(job, jobId, maximumMinutes) {
  if (!job) return
  const timeout = job['timeout-minutes']
  check(
    Number.isSafeInteger(timeout) && timeout > 0 && timeout <= maximumMinutes,
    `Workflow job ${jobId} must set timeout-minutes between 1 and ${maximumMinutes}`
  )
}

function requireJobDependencies(job, jobId, dependencies) {
  if (!job) return
  const needs = Array.isArray(job.needs) ? job.needs : [job.needs].filter(Boolean)
  for (const dependency of dependencies) {
    check(needs.includes(dependency), `Workflow job ${jobId} must depend on successful ${dependency}`)
  }
}

function requireBoundedCommandStep(job, jobId, stepName, command, maximumMinutes) {
  if (!job) return
  const step = (Array.isArray(job.steps) ? job.steps : []).find((candidate) => candidate?.name === stepName)
  const hasCommand = typeof step?.run === 'string' &&
    step.run.split(/\r?\n/).some((line) => line.trim() === command)
  check(
    Boolean(step) && hasCommand && step.if === undefined &&
      (step['continue-on-error'] === undefined || step['continue-on-error'] === false),
    `Workflow job ${jobId} must run ${stepName} unconditionally and fail on: ${command}`
  )
  const timeout = step?.['timeout-minutes']
  check(
    Number.isSafeInteger(timeout) && timeout > 0 && timeout <= maximumMinutes,
    `Workflow job ${jobId} step ${stepName} must set timeout-minutes between 1 and ${maximumMinutes}`
  )
}

function requireUnconditionalStepAfter(job, jobId, stepName, priorCommand) {
  if (!job) return
  const steps = Array.isArray(job.steps) ? job.steps : []
  const priorIndex = steps.findIndex(
    (step) =>
      typeof step?.run === 'string' &&
      step.run.split(/\r?\n/).some((line) => line.trim() === priorCommand)
  )
  const stepIndex = steps.findIndex(
    (step, candidateIndex) =>
      candidateIndex > priorIndex &&
      step?.name === stepName &&
      step.if === undefined &&
      (step['continue-on-error'] === undefined || step['continue-on-error'] === false)
  )
  check(
    priorIndex >= 0 && stepIndex > priorIndex,
    `Workflow job ${jobId} must run ${stepName} unconditionally after: ${priorCommand}`
  )
}

function requireLinuxUserNamespaceStep(job, jobId) {
  if (!job) return
  const steps = Array.isArray(job.steps) ? job.steps : []
  const step = steps.find((candidate) => candidate?.name === LINUX_USER_NAMESPACE_STEP_NAME)
  const run = typeof step?.run === 'string' ? step.run.trim() : ''
  check(
    Boolean(step) && run === LINUX_USER_NAMESPACE_SETUP && step.if === undefined &&
      (step['continue-on-error'] === undefined || step['continue-on-error'] === false),
    `Workflow job ${jobId} must use the fixed fail-closed Linux user namespace setup`
  )
  check(
    !/\bdist\b|\$\{\{|AppImage|chrome-sandbox|chown|chmod/.test(run),
    `Workflow job ${jobId} user namespace setup must not accept or mutate artifact paths`
  )
}

function requirePublishDependencies(document, workflowLabel) {
  const publish = document?.jobs?.publish
  check(Boolean(publish), `${workflowLabel} must define a publish job`)
  if (!publish) return
  const needs = Array.isArray(publish.needs) ? publish.needs : [publish.needs].filter(Boolean)
  for (const dependency of ['prepare', 'build-macos', 'build-windows', 'build-linux']) {
    check(
      needs.includes(dependency),
      `${workflowLabel} publish job must depend on successful ${dependency}`
    )
  }
  check(publish.if === undefined, `${workflowLabel} publish job must not bypass failed build/smoke jobs`)
}

function requireOrderedSourceMarkers(source, label, markers) {
  source = source.replace(/\r\n/gu, '\n')
  let priorIndex = -1
  for (const marker of markers) {
    const index = source.indexOf(marker, priorIndex + 1)
    check(index >= 0, `${label} must run after prior gates and fail closed at: ${marker}`)
    if (index >= 0) priorIndex = index
  }
}

function requireSourceMarkersAfter(source, label, priorMarker, markers) {
  source = source.replace(/\r\n/gu, '\n')
  const priorIndex = source.indexOf(priorMarker)
  check(priorIndex >= 0, `${label} is missing required gate marker: ${priorMarker}`)
  for (const marker of markers) {
    const markerIndex = source.indexOf(marker)
    check(
      priorIndex >= 0 && markerIndex > priorIndex,
      `${label} must keep public release operation after ${priorMarker}: ${marker}`
    )
  }
}

// The public platform must not be hidden by an internal build/runtime feature flag.
// KUN_EXTENSION_HOST_RUNNER is intentionally not a gate: it marks the dedicated
// child entrypoint and remains allowed.
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

const runtimeFactory = await text('kun/src/server/runtime-factory.ts')
check(
  /extensions\s*:\s*\{[\s\S]{0,240}?enabled\s*:\s*true/.test(runtimeFactory),
  'Kun runtime info does not expose the Extension Platform as unconditionally enabled'
)
check(
  runtimeFactory.includes('SUPPORTED_EXTENSION_API_VERSIONS'),
  'Kun runtime does not derive reported Extension API versions from the canonical SDK contract'
)
const serveEntry = await text('kun/src/cli/serve-entry.ts')
check(
  serveEntry.includes("argv[0] === 'extension'") && serveEntry.includes('runExtensionCommand'),
  'The public `kun extension` CLI dispatch is absent or gated'
)
const mainEntry = await text('src/main/index.ts')
check(
  mainEntry.includes('registerKunExtensionSchemeAsPrivileged') && mainEntry.includes('registerExtensionIpcHandlers'),
  'Electron does not register the public Extension protocol and IPC bridge'
)
const stageRouter = await text('src/renderer/src/components/workbench/WorkbenchStageRouter.tsx')
check(
  stageRouter.includes("route === 'extensions'") && stageRouter.includes('ExtensionManagementCenter'),
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
  currentApiVersion = currentVersion
  currentApiMajor = currentMajor
  canonicalSupportedApiVersions = supportedVersions
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
const routeIndex = await text('kun/src/server/routes/index.ts')
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
for (const marker of ['mcpProviders.providers', 'buildSkillToolProviders(skillRuntime)', 'mcpServers:', 'skills:']) {
  check(runtimeFactory.includes(marker), `Legacy Kun runtime composition disappeared: ${marker}`)
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
const rootPackage = await json('package.json')
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
const semver = requireKun('semver')
const wasmRuntimeLock = kunLock.packages?.['node_modules/@napi-rs/wasm-runtime']
for (const dependency of ['@emnapi/core', '@emnapi/runtime']) {
  const version = kunLock.packages?.[`node_modules/${dependency}`]?.version
  const peerRange = wasmRuntimeLock?.peerDependencies?.[dependency]
  check(
    semver.valid(version) !== null,
    `Kun npm 10 lock is missing a top-level ${dependency} node with a valid SemVer`
  )
  check(
    typeof peerRange === 'string' && semver.satisfies(version ?? '', peerRange),
    `Kun npm 10 lock top-level ${dependency}@${String(version)} does not satisfy @napi-rs/wasm-runtime ${String(peerRange)}`
  )
}

// Static packaged-resource and cross-platform release coverage.
const builderConfig = require(join(root, 'electron-builder.config.cjs'))
const afterPack = require(join(root, 'scripts/after-pack.cjs'))
const afterPackSource = await text('scripts/after-pack.cjs')
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
for (const pattern of [
  '**/kun/dist/**/*',
  '**/kun/node_modules/**/*',
  '**/packages/extension-api/**/*',
  '**/packages/create-kun-extension/**/*'
]) {
  check(
    builderConfig.asarUnpack.includes(pattern),
    `electron-builder asarUnpack omits Extension runtime resource: ${pattern}`
  )
}
for (const path of [
  'kun/dist/cli/extension-cli.js',
  'kun/dist/extensions/host-runner.js',
  'kun/node_modules/@kun/extension-api/dist/index.js',
  'kun/node_modules/create-kun-extension/src/cli.mjs',
  'node_modules/better-sqlite3/package.json',
  'node_modules/bindings/package.json',
  'node_modules/file-uri-to-path/package.json',
  'packages/extension-api/schema/kun-extension.schema.json',
  'packages/extension-api/fixtures/api-major-negotiation.json',
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

const packagedExtensionSmoke = await text('scripts/smoke-packaged-extensions.cjs')
for (const marker of [
  'resolvePackagedRuntimeExecutable',
  'KUN_PACKAGED_EXTENSION_SMOKE_REEXEC',
  "ELECTRON_RUN_AS_NODE: '1'",
  'smokeAgentTool',
  'assertConfinedPackagedPath',
  'readAsarHeader'
]) {
  check(packagedExtensionSmoke.includes(marker), `Packaged Extension smoke omits release assertion: ${marker}`)
}

const packagedDesktopSmoke = await text('scripts/smoke-packaged-extension-desktop.cjs')
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
  'timeout: timeoutMs'
]) {
  check(packagedDesktopSmoke.includes(marker), `Packaged desktop Chromium smoke omits assertion: ${marker}`)
}
check(
  !packagedDesktopSmoke.includes("'--no-sandbox'"),
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
check(
  JSON.stringify(packagedDesktopSmokeModule.platformDesktopArguments?.('linux')) ===
    JSON.stringify(['--disable-gpu', '--disable-dev-shm-usage']) &&
    !packagedDesktopSmokeModule.platformDesktopArguments?.('linux').includes(
      '--disable-setuid-sandbox'
    ) &&
    !packagedDesktopSmokeModule.platformDesktopArguments?.('linux').includes('--no-sandbox'),
  'Packaged Linux desktop smoke must not inject sandbox flags that hide launcher defects'
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
    resourcesDir: '/extract/squashfs-root/resources',
    desktopSmokePath: '/repo/scripts/smoke-packaged-extension-desktop.cjs',
    environment: { APPDIR: '/untrusted', APPIMAGE: '/untrusted', ELECTRON_RUN_AS_NODE: '1' }
  })
  check(
    invocation.command === process.execPath &&
      invocation.options.env.APPIMAGE_EXTRACT_AND_RUN === '1' &&
      invocation.options.env.ELECTRON_RUN_AS_NODE === undefined &&
      invocation.options.env.APPDIR === undefined &&
      invocation.options.env.APPIMAGE === undefined &&
      invocation.args.includes('--desktop-executable') &&
      invocation.args.includes(resolve('/release/Kun-1.2.3-linux-x86_64.AppImage')) &&
      invocation.args.includes(resolve('/extract/squashfs-root/resources')) &&
      invocation.options.timeout === undefined &&
      invocation.options.killSignal === undefined &&
      !invocation.args.some((argument) => argument.endsWith('app.asar')),
    'Final Linux AppImage smoke must let the desktop smoke own bounded cleanup while directly launching the final artifact'
  )
}

const electronBuilderConfig = await text('electron-builder.config.cjs')
check(
  electronBuilderConfig.includes(
    "executableArgs: ['--disable-setuid-sandbox', '--no-first-run']"
  ) &&
    !electronBuilderConfig.includes('--no-sandbox') &&
    !packagedDesktopSmoke.includes("'--no-sandbox'") &&
    !packagedDesktopSmoke.includes("'--disable-setuid-sandbox'"),
  'Linux packaging and native smokes must retain user namespace and seccomp sandboxing'
)

const prWorkflow = await text('.github/workflows/pr-checks.yml')
const prWorkflowDocument = parseYaml(prWorkflow)
const appImageDesktopCommand = 'npm run smoke:packaged-extension-appimage'
const nativeEvidenceCommand = 'npm run evidence:extension-native'
const nativeEvidenceSource = await text('scripts/write-extension-native-evidence.mjs')
check(
  rootPackage.scripts?.['evidence:extension-native'] ===
    'node ./scripts/write-extension-native-evidence.mjs',
  'package.json must expose the commit-bound native artifact evidence command'
)
check(
  rootPackage.scripts?.['check:extension-release-gate']?.includes(
    './scripts/write-extension-native-evidence.test.mjs'
  ),
  'Extension release gate must execute native artifact evidence tests'
)
for (const marker of [
  'GITHUB_SHA',
  'GITHUB_RUN_ID',
  'sha256File',
  'details.isSymbolicLink()',
  "flag: 'wx'",
  'linux-x86_64\\\\.AppImage',
  'win-x64\\\\.exe',
  'mac-(arm64|x64)'
]) {
  check(nativeEvidenceSource.includes(marker), `Native artifact evidence omits fail-closed marker: ${marker}`)
}
for (const command of ['npm run check:extensions', 'npm run test', 'npm --prefix kun run test', 'npm run dist:linux']) {
  check(prWorkflow.includes(command), `PR checks omit release prerequisite: ${command}`)
}
const releaseWorkflow = await text('.github/workflows/release.yml')
const releaseWorkflowDocument = parseYaml(releaseWorkflow)
requirePublishDependencies(releaseWorkflowDocument, 'Stable release workflow')
for (const marker of [
  'runs-on: macos-latest',
  'runs-on: windows-latest',
  'runs-on: ubuntu-latest',
  'npm run dist:mac:signed',
  'npm run dist:win',
  'npm run dist:linux'
]) {
  check(releaseWorkflow.includes(marker), `Release workflow omits platform/resource build: ${marker}`)
}
check(
  (releaseWorkflow.match(/npm run check:extension-release-gate/g) ?? []).length >= 3,
  'Release workflow must run the Extension release gate on macOS, Windows, and Linux'
)
check(
  (releaseWorkflow.match(/npm run smoke:packaged-extensions/g) ?? []).length >= 4,
  'Release workflow must run the packaged Node runtime smoke on macOS x64/arm64, Windows, and Linux'
)
check(
  (releaseWorkflow.match(/npm run smoke:packaged-extension-desktop/g) ?? []).length >= 3,
  'Release workflow must run the packaged desktop Chromium smoke on host-native macOS, Windows, and Linux'
)
check(
  prWorkflow.includes('npm run smoke:packaged-extensions'),
  'PR package checks must run the packaged Node runtime smoke'
)
check(
  prWorkflow.includes('npm run smoke:packaged-extension-desktop'),
  'PR package checks must run the packaged desktop Chromium smoke'
)
check(
  releaseWorkflow.includes(appImageDesktopCommand) && prWorkflow.includes(appImageDesktopCommand),
  'Release and PR Linux jobs must directly smoke the final AppImage artifact'
)
check(
  !releaseWorkflow.includes('--no-sandbox') && !prWorkflow.includes('--no-sandbox'),
  'Release and PR workflows must not disable the Chromium sandbox'
)
check(
  (releaseWorkflow.match(/npm run evidence:extension-native/g) ?? []).length >= 3 &&
    (prWorkflow.match(/npm run evidence:extension-native/g) ?? []).length >= 3,
  'Release and PR jobs must record commit-bound native evidence on macOS, Windows, and Linux'
)
check(
  /Install Linux packaging dependencies[\s\S]*?\bxvfb\b[\s\S]*?\butil-linux\b/.test(releaseWorkflow) &&
    /Install Linux packaging dependencies[\s\S]*?\bxvfb\b[\s\S]*?\butil-linux\b/.test(prWorkflow),
  'Linux release and PR package workflows must install xvfb and util-linux'
)

const releaseMacJob = workflowJob(releaseWorkflowDocument, 'build-macos', 'macos-latest')
requireBoundedJobTimeout(releaseMacJob, 'build-macos', 90)
requireOrderedCommands(releaseMacJob, 'build-macos', [
  'npm run check:extension-release-gate',
  'npm run dist:mac:signed',
  'npm run smoke:packaged-extensions -- --resources dist/mac/Kun.app/Contents/Resources',
  'npm run smoke:packaged-extensions -- --resources dist/mac-arm64/Kun.app/Contents/Resources',
  'npm run smoke:packaged-extension-desktop',
  nativeEvidenceCommand
])
requireUnconditionalStepAfter(
  releaseMacJob,
  'build-macos',
  'Upload macOS artifacts',
  nativeEvidenceCommand
)
const releaseWindowsJob = workflowJob(releaseWorkflowDocument, 'build-windows', 'windows-latest')
requireBoundedJobTimeout(releaseWindowsJob, 'build-windows', 90)
requireOrderedCommands(releaseWindowsJob, 'build-windows', [
  'npm run check:extension-release-gate',
  'npm run dist:win',
  'npm run smoke:packaged-extensions -- --resources dist/win-unpacked/resources',
  'npm run smoke:packaged-extension-desktop',
  nativeEvidenceCommand
])
requireUnconditionalStepAfter(
  releaseWindowsJob,
  'build-windows',
  'Upload Windows artifacts',
  nativeEvidenceCommand
)
const releaseLinuxJob = workflowJob(releaseWorkflowDocument, 'build-linux', 'ubuntu-latest')
requireBoundedJobTimeout(releaseLinuxJob, 'build-linux', 90)
requireOrderedCommands(releaseLinuxJob, 'build-linux', [
  'npm run check:extension-release-gate',
  'npm run dist:linux',
  'npm run smoke:packaged-extensions -- --resources dist/linux-unpacked/resources',
  'unshare --user --map-root-user /bin/true',
  'npm run smoke:packaged-extension-desktop',
  appImageDesktopCommand,
  nativeEvidenceCommand
])
requireLinuxUserNamespaceStep(releaseLinuxJob, 'build-linux')
requireBoundedCommandStep(
  releaseLinuxJob,
  'build-linux',
  'Smoke final Linux AppImage desktop Chromium',
  appImageDesktopCommand,
  10
)
requireUnconditionalStepAfter(
  releaseLinuxJob,
  'build-linux',
  'Upload Linux artifacts',
  nativeEvidenceCommand
)

const dailyWorkflow = await text('.github/workflows/daily-dev-prerelease.yml')
const dailyWorkflowDocument = parseYaml(dailyWorkflow)
requirePublishDependencies(dailyWorkflowDocument, 'Daily prerelease workflow')
const dailyMacJob = workflowJob(dailyWorkflowDocument, 'build-macos', 'macos-latest')
requireBoundedJobTimeout(dailyMacJob, 'daily build-macos', 90)
requireOrderedCommands(dailyMacJob, 'daily build-macos', [
  'npm run check:extension-release-gate',
  'npm run dist:mac',
  'npm run smoke:packaged-extensions -- --resources dist/mac/Kun.app/Contents/Resources',
  'npm run smoke:packaged-extensions -- --resources dist/mac-arm64/Kun.app/Contents/Resources',
  'npm run smoke:packaged-extension-desktop',
  nativeEvidenceCommand
])
requireUnconditionalStepAfter(
  dailyMacJob,
  'daily build-macos',
  'Upload macOS artifacts',
  nativeEvidenceCommand
)
const dailyWindowsJob = workflowJob(dailyWorkflowDocument, 'build-windows', 'windows-latest')
requireBoundedJobTimeout(dailyWindowsJob, 'daily build-windows', 90)
requireOrderedCommands(dailyWindowsJob, 'daily build-windows', [
  'npm run check:extension-release-gate',
  'npm run dist:win',
  'npm run smoke:packaged-extensions -- --resources dist/win-unpacked/resources',
  'npm run smoke:packaged-extension-desktop',
  nativeEvidenceCommand
])
requireUnconditionalStepAfter(
  dailyWindowsJob,
  'daily build-windows',
  'Upload Windows artifacts',
  nativeEvidenceCommand
)
const dailyLinuxJob = workflowJob(dailyWorkflowDocument, 'build-linux', 'ubuntu-latest')
requireBoundedJobTimeout(dailyLinuxJob, 'daily build-linux', 90)
requireOrderedCommands(dailyLinuxJob, 'daily build-linux', [
  'npm run check:extension-release-gate',
  'npm run dist:linux',
  'npm run smoke:packaged-extensions -- --resources dist/linux-unpacked/resources',
  'unshare --user --map-root-user /bin/true',
  'npm run smoke:packaged-extension-desktop',
  appImageDesktopCommand,
  nativeEvidenceCommand
])
requireLinuxUserNamespaceStep(dailyLinuxJob, 'daily build-linux')
requireBoundedCommandStep(
  dailyLinuxJob,
  'daily build-linux',
  'Smoke final Linux AppImage desktop Chromium',
  appImageDesktopCommand,
  10
)
requireUnconditionalStepAfter(
  dailyLinuxJob,
  'daily build-linux',
  'Upload Linux artifacts',
  nativeEvidenceCommand
)
const dailyLinuxDependencies =
  dailyLinuxJob?.steps?.find((step) => step?.name === 'Install Linux packaging dependencies')?.run ?? ''
check(
  /\bxvfb\b/.test(dailyLinuxDependencies) && /\bxauth\b/.test(dailyLinuxDependencies) &&
    /\butil-linux\b/.test(dailyLinuxDependencies),
  'Daily Linux prerelease must install xvfb, xauth, and util-linux'
)
check(
  !dailyWorkflow.includes('--no-sandbox'),
  'Daily Linux prerelease must not disable the Chromium sandbox'
)

const releaseMacScript = await text('scripts/release-mac.sh')
requireOrderedSourceMarkers(releaseMacScript, 'scripts/release-mac.sh execution path', [
  'npm run check:extension-release-gate || die "Extension public release gate failed"',
  '\nbuild_macos\n',
  '\nsmoke_macos_extensions\n',
  '\nrelease_write_meta_file\n',
  'gh release create "${TAG_NAME}"'
])
requireSourceMarkersAfter(releaseMacScript, 'scripts/release-mac.sh', '\nsmoke_macos_extensions\n', [
  'gh release create "${TAG_NAME}"',
  'gh release upload "${tag}"',
  'publish-r2.mjs" upload --platform mac',
  'publish-r2.mjs" promote --tag'
])
requireOrderedSourceMarkers(releaseMacScript, 'scripts/release-mac.sh packaged smoke function', [
  'npm run smoke:packaged-extensions -- --resources "${x64_resources}"',
  'npm run smoke:packaged-extensions -- --resources "${arm64_resources}"',
  'npm run smoke:packaged-extension-desktop -- --resources "${host_resources}"'
])
for (const marker of [
  '|| die "macOS x64 packaged Extension Node runtime smoke failed"',
  '|| die "macOS arm64 packaged Extension Node runtime smoke failed"',
  '|| die "macOS packaged Extension desktop Chromium smoke failed"'
]) {
  check(releaseMacScript.includes(marker), `scripts/release-mac.sh does not fail closed: ${marker}`)
}

const releaseWinScript = await text('scripts/release-win.sh')
requireOrderedSourceMarkers(releaseWinScript, 'scripts/release-win.sh execution path', [
  'npm run check:extension-release-gate || die "Extension public release gate failed"',
  'npm run dist:win || die "Windows build failed"',
  'npm run smoke:packaged-extensions -- --resources dist/win-unpacked/resources',
  'npm run smoke:packaged-extension-desktop',
  'gh release upload "${TAG_NAME}"'
])
requireSourceMarkersAfter(
  releaseWinScript,
  'scripts/release-win.sh',
  'npm run smoke:packaged-extension-desktop',
  [
    'gh release upload "${TAG_NAME}"',
    'publish-r2.mjs" upload --platform win',
    'publish-r2.mjs" promote --tag',
    'gh release edit "${TAG_NAME}" --draft=false'
  ]
)
for (const marker of [
  '|| die "Windows packaged Extension Node runtime smoke failed"',
  '|| die "Windows packaged Extension desktop Chromium smoke failed"'
]) {
  check(releaseWinScript.includes(marker), `scripts/release-win.sh does not fail closed: ${marker}`)
}

const releaseWinPowerShell = await text('scripts/release-win.ps1')
requireOrderedSourceMarkers(releaseWinPowerShell, 'scripts/release-win.ps1 execution path', [
  '& npm run check:extension-release-gate',
  '& npm run dist:win',
  '& npm run smoke:packaged-extensions -- --resources dist/win-unpacked/resources',
  '& npm run smoke:packaged-extension-desktop',
  '& gh release upload $TagName'
])
requireSourceMarkersAfter(
  releaseWinPowerShell,
  'scripts/release-win.ps1',
  '& npm run smoke:packaged-extension-desktop',
  [
    '& gh release upload $TagName',
    "'scripts\\publish-r2.mjs') upload --platform win",
    "'scripts\\publish-r2.mjs') promote --tag",
    '& gh release edit $TagName --draft=false'
  ]
)
for (const marker of [
  "Write-Err 'Extension public release gate failed.'",
  "Write-Err 'Windows packaged Extension Node runtime smoke failed.'",
  "Write-Err 'Windows packaged Extension desktop Chromium smoke failed.'"
]) {
  check(releaseWinPowerShell.includes(marker), `scripts/release-win.ps1 does not fail closed: ${marker}`)
}

for (const wrapper of ['scripts/release.sh', 'scripts/release-all-mac.sh']) {
  const source = await text(wrapper)
  check(
    source.includes('exec "${ROOT}/scripts/release-mac.sh"'),
    `${wrapper} must delegate to the gated scripts/release-mac.sh path`
  )
  check(
    !source.includes('gh release upload') && !source.includes('publish-r2.mjs'),
    `${wrapper} must not bypass release-mac.sh with a direct public artifact upload`
  )
}
const prTestJob = workflowJob(prWorkflowDocument, 'test', 'ubuntu-latest')
requireOrderedCommands(prTestJob, 'test', ['npm run check:extensions', 'npm run test', 'npm --prefix kun run test'])
const prPackageJob = workflowJob(prWorkflowDocument, 'package', 'ubuntu-latest')
requireBoundedJobTimeout(prPackageJob, 'package', 60)
requireJobDependencies(prPackageJob, 'package', ['test'])
requireOrderedCommands(prPackageJob, 'package', [
  'npm run dist:linux',
  'npm run smoke:packaged-extensions -- --resources dist/linux-unpacked/resources',
  'unshare --user --map-root-user /bin/true',
  'npm run smoke:packaged-extension-desktop',
  appImageDesktopCommand,
  nativeEvidenceCommand
])
requireLinuxUserNamespaceStep(prPackageJob, 'package')
requireBoundedCommandStep(
  prPackageJob,
  'package',
  'Smoke final Linux AppImage desktop Chromium',
  appImageDesktopCommand,
  10
)
requireUnconditionalStepAfter(
  prPackageJob,
  'package',
  'Upload Linux package',
  nativeEvidenceCommand
)
const prMacJob = workflowJob(prWorkflowDocument, 'package-macos', 'macos-latest')
requireBoundedJobTimeout(prMacJob, 'package-macos', 90)
requireJobDependencies(prMacJob, 'package-macos', ['test'])
requireOrderedCommands(prMacJob, 'package-macos', [
  'npm run dist:mac',
  'npm run smoke:packaged-extensions -- --resources dist/mac/Kun.app/Contents/Resources',
  'npm run smoke:packaged-extensions -- --resources dist/mac-arm64/Kun.app/Contents/Resources',
  'npm run smoke:packaged-extension-desktop',
  nativeEvidenceCommand
])
requireUnconditionalStepAfter(
  prMacJob,
  'package-macos',
  'Upload ad-hoc macOS PR packages',
  nativeEvidenceCommand
)
const prWindowsJob = workflowJob(prWorkflowDocument, 'package-windows', 'windows-latest')
requireBoundedJobTimeout(prWindowsJob, 'package-windows', 90)
requireJobDependencies(prWindowsJob, 'package-windows', ['test'])
requireOrderedCommands(prWindowsJob, 'package-windows', [
  'npm run dist:win',
  'npm run smoke:packaged-extensions -- --resources dist/win-unpacked/resources',
  'npm run smoke:packaged-extension-desktop',
  nativeEvidenceCommand
])
requireUnconditionalStepAfter(
  prWindowsJob,
  'package-windows',
  'Upload Windows PR package',
  nativeEvidenceCommand
)
const prFailureJob = prWorkflowDocument?.jobs?.['request-changes-on-failure']
requireJobDependencies(prFailureJob, 'request-changes-on-failure', [
  'test',
  'package',
  'package-macos',
  'package-windows'
])

const checklistPairs = [
  [
    'docs/extensions/release-troubleshooting-changelog.md',
    [
      '### 0. Kun 平台公开发布门禁',
      '内部平台 gate',
      'UI 外观包、MCP、Skill',
      'macOS、Windows、Linux',
      'packaged Node runtime',
      'Chromium desktop',
      '最终 AppImage',
      'evidence:extension-native',
      'SHA-256',
      '发布证据记录'
    ]
  ],
  [
    'docs/extensions/release-troubleshooting-changelog.en.md',
    [
      '### 0. Kun public platform release gate',
      'internal platform gate',
      'UI appearance packs, MCP, and Skills',
      'macOS, Windows, and Linux',
      'packaged Node runtime',
      'Chromium desktop',
      'final AppImage',
      'evidence:extension-native',
      'SHA-256',
      'Release evidence record'
    ]
  ]
]
for (const [path, requiredText] of checklistPairs) {
  const body = await text(path)
  for (const value of requiredText) check(body.includes(value), `${path} release checklist is missing: ${value}`)
}

if (problems.length > 0) {
  throw new Error(`Extension public release gate failed:\n- ${problems.join('\n- ')}`)
}

if (currentApiVersion === undefined || currentApiMajor === undefined || canonicalSupportedApiVersions.length === 0) {
  throw new Error('Extension public release gate could not resolve the canonical API version')
}

const expectedConformanceMajors = expectedApiMajors(currentApiVersion)
const executedConformanceMajors = []

// API v1 is both the current major and the documented no-previous-major
// exception. Once v2 ships, this gate fails closed until a retained v1 SDK and
// executable Host-adapter conformance runner are checked in at these paths.
// A successful manifest negotiation never counts as adaptation evidence.
if (expectedConformanceMajors.length > 1) {
  const previousMajor = expectedConformanceMajors[1]
  const previousSdk = `packages/extension-api-compat/v${previousMajor}/package.json`
  const previousConformance = `scripts/fixtures/extension-api-conformance/v${previousMajor}.mjs`
  try {
    await Promise.all([access(join(root, previousSdk)), access(join(root, previousConformance))])
  } catch {
    throw new Error(
      `Extension API v${currentApiMajor} requires executable v${previousMajor} Host adaptation. ` +
        `Add the retained SDK at ${previousSdk} and conformance runner at ${previousConformance}.`
    )
  }
  runRequiredCommand({
    label: `Extension API v${previousMajor} previous-major Host adapter conformance`,
    command: process.execPath,
    args: [join(root, previousConformance), '--sdk-package', join(root, dirname(previousSdk))],
    cwd: root
  })
  executedConformanceMajors.push(previousMajor)
}

runRequiredCommand({
  label: `Extension API v${currentApiMajor} external packaged-artifact conformance`,
  command: process.execPath,
  args: [join(root, 'scripts/check-extension-external-project.mjs'), '--expected-api-major', String(currentApiMajor)],
  cwd: root
})
executedConformanceMajors.push(currentApiMajor)

assertExecutableApiConformance({
  currentVersion: currentApiVersion,
  supportedVersions: canonicalSupportedApiVersions,
  executedMajors: executedConformanceMajors
})

const vitestEntry = join(root, 'node_modules/vitest/vitest.mjs')
runRequiredCommand({
  label: 'legacy desktop Plugin, Skill, and provider behavior regression suite',
  command: process.execPath,
  args: [
    vitestEntry,
    'run',
    'src/main/services/ui-plugin-service.test.ts',
    'src/renderer/src/components/PluginMarketplaceView.test.ts',
    'src/main/services/skill-service.test.ts',
    'src/main/legacy-provider-settings-migration.test.ts',
    'src/main/provider-connection.test.ts'
  ],
  cwd: root
})
runRequiredCommand({
  label: 'legacy single-runtime, MCP, Skill, provider, and Extension Host regression suite',
  command: process.execPath,
  args: [
    vitestEntry,
    'run',
    'tests/runtime-factory.test.ts',
    'tests/extension-compatibility.test.ts',
    'tests/extension-host.test.ts',
    'tests/skill-runtime.test.ts',
    'src/adapters/tool/mcp-tool-provider.test.ts',
    'src/adapters/model/multi-provider-model-client.test.ts',
    'src/services/legacy-provider-credential-migration.test.ts'
  ],
  cwd: join(root, 'kun')
})

process.stdout.write(
  'Extension public release gate OK: platform exposed, executable API compatibility and external tarball acceptance passed, legacy behaviors passed, packaged resources asserted, and three-platform packaged smoke wiring enforced. Native platform evidence remains a separate release sign-off.\n'
)
