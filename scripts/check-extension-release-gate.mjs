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

function requireNamedStepsInOrder(job, jobId, stepNames) {
  if (!job) return
  const steps = Array.isArray(job.steps) ? job.steps : []
  let priorIndex = -1
  for (const stepName of stepNames) {
    const index = steps.findIndex(
      (step, candidateIndex) =>
        candidateIndex > priorIndex &&
        step?.name === stepName &&
        step.if === undefined &&
        (step['continue-on-error'] === undefined || step['continue-on-error'] === false)
    )
    check(index >= 0, `Workflow job ${jobId} must run after prior gates: ${stepName}`)
    if (index >= 0) priorIndex = index
  }
}

function requireStepRunMarkers(job, jobId, stepName, markers) {
  if (!job) return
  const step = (Array.isArray(job.steps) ? job.steps : [])
    .find((candidate) => candidate?.name === stepName)
  const run = typeof step?.run === 'string' ? step.run : ''
  for (const marker of markers) {
    check(run.includes(marker), `Workflow job ${jobId} step ${stepName} omits: ${marker}`)
  }
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
  for (const dependency of [
    'prepare',
    'build-macos',
    'verify-macos-x64',
    'build-windows',
    'build-linux'
  ]) {
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
    const markerIndex = source.indexOf(marker, priorIndex + 1)
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
  mainEntry.includes('registerKunExtensionPlatformSchemesAsPrivileged') &&
    mainEntry.includes('registerExtensionIpcHandlers'),
  'Electron does not register the public Extension/media protocols and IPC bridge'
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

// The current media reference extension is part of the release surface. Keep its
// deterministic, local-only fixture and every example lifecycle command in the
// fail-closed gate; native packaged evidence is still recorded per host.
const videoExampleRoot = 'examples/extensions/kun-video-editor'
for (const path of [
  `${videoExampleRoot}/README.md`,
  `${videoExampleRoot}/kun-extension.json`,
  `${videoExampleRoot}/package.json`,
  `${videoExampleRoot}/fixtures/generate-local-fixture.mjs`,
  `${videoExampleRoot}/fixtures/talking-head.srt`,
  `${videoExampleRoot}/fixtures/talking-head.vtt`,
  `${videoExampleRoot}/fixtures/talking-head.json`,
  `${videoExampleRoot}/tests/local-fixtures.test.ts`,
  'packages/extension-api/fixtures/api-minor-negotiation.json',
  'src/main/extensions/extension-media-protocol.test.ts',
  'kun/src/services/extension-media-process-service.test.ts',
  'kun/src/services/extension-media-native-smoke.test.ts'
]) {
  await requirePath(path, 'video editor release/security surface')
}
const videoExamplePackage = await json(`${videoExampleRoot}/package.json`)
for (const command of [
  'fixture:generate',
  'fixture:check',
  'typecheck',
  'test',
  'build',
  'validate',
  'pack'
]) {
  check(
    typeof videoExamplePackage.scripts?.[command] === 'string' &&
      videoExamplePackage.scripts[command].trim().length > 0,
    `Kun video editor example is missing runnable ${command} coverage`
  )
}
const videoExampleManifest = await json(`${videoExampleRoot}/kun-extension.json`)
check(videoExampleManifest.apiVersion === '1.2.0', 'Kun video editor must exercise Extension API v1.2')
check(
  !videoExampleManifest.permissions.some((permission) => permission.startsWith('network:')),
  'Kun video editor deterministic release fixture must not require remote ASR or generative services'
)
const exampleGateSource = await text('scripts/check-extension-examples.mjs')
for (const marker of [
  "'kun-video-editor'",
  "'typecheck'",
  "'build'",
  "'test'",
  "'run', 'validate'",
  "'run', 'pack'"
]) {
  check(exampleGateSource.includes(marker), `Extension example gate omits video lifecycle marker: ${marker}`)
}
const videoExampleReadme = await text(`${videoExampleRoot}/README.md`)
for (const marker of [
  '## Install the release package',
  'kun-video-editor-0.4.4.kunx',
  'kun extension validate',
  'kun extension install',
  'npm run pack:kun-video-editor',
  'npm run verify:kun-video-editor-package'
]) {
  check(videoExampleReadme.includes(marker), `Kun Video Editor install guide omits: ${marker}`)
}

const mediaProtocolSource = await text('src/main/extensions/extension-media-protocol.ts')
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
const mediaProcessSource = await text('kun/src/services/extension-media-process-service.ts')
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
check(
  typeof afterPack._internals?.validateBundledExtensionResources === 'function' &&
    /async function afterPack\(context\)\s*\{[\s\S]*?validateBundledKunRuntime\(context\)[\s\S]*?validateBundledExtensionResources\(context\)/.test(
      afterPackSource
    ),
  'afterPack does not validate bundled .kunx catalog bytes before release artifacts are created'
)
for (const id of [
  'kun-examples.kun-video-editor',
  'kun-examples.presentation-studio',
  'kun-examples.social-media-sidebar'
]) {
  check(
    afterPack.REQUIRED_BUNDLED_EXTENSION_IDS.includes(id),
    `afterPack does not require bundled default extension: ${id}`
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

const packagedExtensionSmoke = await text('scripts/smoke-packaged-extensions.cjs')
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
  'timeout: timeoutMs',
  'seedDesktopMediaPlaybackFixture',
  "'media.openViewResource'",
  "scheme: new URL(lease.url).protocol",
  "result.mediaPlayback?.scheme !== 'kun-media:'",
  'result.mediaPlayback.currentTime < 0.4'
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
const nativeMediaSmokeCommand = 'npm run smoke:extension-native-media'
const packagedVideoNativeCommand = 'npm run smoke:packaged-video-editor-native'
const packagedVideoReleaseCommand =
  'npm run smoke:packaged-video-editor-native -- --archive dist/kun-video-editor-0.4.4.kunx'
const nativeEvidenceCommand = 'npm run evidence:extension-native'
const nativeEvidenceVerifierCommand = 'npm run verify:extension-native-evidence'
const videoEditorPackCommand = 'npm run pack:kun-video-editor'
const videoEditorVerifyCommand = 'npm run verify:kun-video-editor-package'
const verifyMacX64Command =
  'npm run verify:packaged-macos-native -- --resources dist/mac-x64-verified/Kun.app/Contents/Resources --arch x64'
const smokeMacX64ExtensionsCommand =
  'npm run smoke:packaged-extensions -- --resources dist/mac-x64-verified/Kun.app/Contents/Resources'
const smokeMacX64DesktopCommand =
  'npm run smoke:packaged-extension-desktop -- --resources dist/mac-x64-verified/Kun.app/Contents/Resources'
const smokePackagedOcrCommand = 'node scripts/smoke-packaged-ocr.cjs'
const nativeEvidenceSource = await text('scripts/write-extension-native-evidence.mjs')
const nativeEvidenceVerifierSource = await text('scripts/verify-extension-native-evidence.mjs')
const manualReleaseVerifierSource = await text('scripts/verify-manual-extension-release.mjs')
const nativeMediaSmokeSource = await text('scripts/run-extension-native-media-smoke.cjs')
const packagedVideoNativeSource = await text('scripts/smoke-packaged-video-editor-native.cjs')
const videoEditorPackSource = await text('scripts/pack-kun-video-editor.mjs')
const bundledExtensionsPackSource = await text('scripts/pack-bundled-extensions.mjs')
check(
  rootPackage.scripts?.['build:bundled-extensions'] ===
    'node ./scripts/pack-bundled-extensions.mjs --output ./resources/bundled-extensions' &&
    rootPackage.scripts?.build?.includes('npm run build:bundled-extensions') &&
    rootPackage.scripts?.dev?.includes('npm run build:bundled-extensions'),
  'Kun build and dev must generate the canonical default extension catalog before launch'
)
for (const marker of [
  'BUNDLED_EXTENSION_DEFINITIONS',
  'BUNDLED_EXTENSION_CATALOG_FILE',
  'kun-examples.kun-video-editor',
  'kun-examples.presentation-studio',
  'kun-examples.social-media-sidebar',
  'bundledExtensionCatalog',
  'removeStaleBundledArchives'
]) {
  check(
    bundledExtensionsPackSource.includes(marker),
    `Bundled Extension packer omits default invariant: ${marker}`
  )
}
check(
  rootPackage.scripts?.['check:extension-release-gate']?.includes(
    './scripts/pack-bundled-extensions.test.mjs'
  ),
  'Extension release gate must execute bundled extension catalog tests'
)
check(
  rootPackage.scripts?.['smoke:extension-native-media'] ===
    'node ./scripts/run-extension-native-media-smoke.cjs',
  'package.json must expose the fail-closed host-native FFmpeg broker smoke'
)
check(
  rootPackage.scripts?.['smoke:packaged-video-editor-native'] ===
    'node ./scripts/smoke-packaged-video-editor-native.cjs',
  'package.json must expose the packaged Kun Video Editor native smoke'
)
check(
  rootPackage.scripts?.['check:extension-release-gate']?.includes(
    './scripts/smoke-packaged-video-editor-native.test.cjs'
  ),
  'Extension release gate must execute packaged video editor native smoke source tests'
)
check(
  rootPackage.scripts?.['prepare:macos-native:x64'] ===
    'node ./scripts/ensure-macos-native-dependencies.cjs --arch x64' &&
    rootPackage.scripts?.['prepare:macos-native:arm64'] ===
      'node ./scripts/ensure-macos-native-dependencies.cjs --arch arm64' &&
    rootPackage.scripts?.['dist:mac:x64:dmg']?.startsWith(
      'npm run prepare:macos-native:x64 && '
    ) &&
    rootPackage.scripts?.['dist:mac:arm64:dmg']?.startsWith(
      'npm run prepare:macos-native:arm64 && '
    ),
  'macOS packaging must install target-native Sharp and Canvas dependencies before each architecture'
)
check(
  rootPackage.scripts?.['verify:packaged-macos-native'] ===
    'node ./scripts/verify-packaged-macos-native-architecture.cjs' &&
    rootPackage.scripts?.['check:extension-release-gate']?.includes(
      './scripts/ensure-macos-native-dependencies.test.cjs'
    ) &&
    rootPackage.scripts?.['check:extension-release-gate']?.includes(
      './scripts/verify-packaged-macos-native-architecture.test.cjs'
    ),
  'Extension release gate must expose and test macOS native architecture verification'
)
for (const marker of [
  "KUN_RUN_MEDIA_SMOKE: '1'",
  'resolveHostMediaExecutables',
  'extension-media-native-smoke.test.ts',
  'shell: false',
  'timeout: 180_000'
]) {
  check(nativeMediaSmokeSource.includes(marker), `Host-native media smoke omits fail-closed marker: ${marker}`)
}
for (const marker of [
  'KUN_PACKAGED_VIDEO_EDITOR_NATIVE_SMOKE_REEXEC',
  "ELECTRON_RUN_AS_NODE: '1'",
  'timeout: DEFAULT_SMOKE_TIMEOUT_MS',
  "'extension', 'validate'",
  "'extension', 'pack'",
  "'extension', 'install'",
  "'onTool:video-project'",
  "'video-probe'",
  "'video-update-timeline'",
  "kind: 'proof-frame'",
  "kind: 'h264-mp4'",
  "captionMode = 'both'",
  "captionMode: paths.captionMode",
  'subtitleOutputHandleId',
  "subtitleFormat: 'srt'",
  'application/x-subrip',
  "'video-render-cancel'",
  "approvalCount('video-render-status')",
  "approvalCount('video-render-cancel')",
  'artifacts.listOwned',
  'assertH264Probe',
  'assertSrtSidecar',
  'assertSourcePreserved',
  "argumentValue('--archive')",
  'assertReleaseArchive',
  'archiveHash',
  'smoke archive changed during lifecycle validation',
  "code: 'FFPROBE_UNAVAILABLE'",
  'ffprobe is unavailable',
  "'extension', 'uninstall'"
]) {
  check(packagedVideoNativeSource.includes(marker), `Packaged video editor native smoke omits assertion: ${marker}`)
}
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
check(
  rootPackage.scripts?.['verify:extension-native-evidence'] ===
    'node ./scripts/verify-extension-native-evidence.mjs' &&
    rootPackage.scripts?.['check:extension-release-gate']?.includes(
      './scripts/verify-extension-native-evidence.test.mjs'
    ),
  'package.json must expose and test the cross-platform native evidence verifier'
)
check(
  rootPackage.scripts?.['verify:manual-extension-release'] ===
    'node ./scripts/verify-manual-extension-release.mjs' &&
    rootPackage.scripts?.['check:extension-release-gate']?.includes(
      './scripts/verify-manual-extension-release.test.mjs'
    ),
  'package.json must expose and test complete manual Extension release verification'
)
for (const marker of [
  'assertCleanReleaseCheckout',
  "'--clean-only'",
  "'--porcelain=v1'",
  "'--untracked-files=all'",
  "'--ignore-submodules=none'"
]) {
  check(
    manualReleaseVerifierSource.includes(marker),
    `Manual Extension release verifier omits dirty-checkout assertion: ${marker}`
  )
}
check(
  rootPackage.scripts?.['pack:kun-video-editor'] ===
    'npm run build:kun && npm run build:bundled-extensions && node ./scripts/pack-kun-video-editor.mjs --require-bundled-identity' &&
    rootPackage.scripts?.['verify:kun-video-editor-package'] ===
    'npm run build:kun && npm run build:bundled-extensions && node ./scripts/pack-kun-video-editor.mjs --verify --require-bundled-identity' &&
    rootPackage.scripts?.['check:extension-release-gate']?.includes(
      './scripts/pack-kun-video-editor.test.mjs'
    ),
  'package.json must expose and test deterministic Kun Video Editor release packing'
)
for (const marker of [
  'GITHUB_SHA',
  'GITHUB_RUN_ID',
  'sha256File',
  'details.isSymbolicLink()',
  "flag: 'wx'",
  'mediaToolchain',
  'KUN_FFMPEG_PATH',
  'KUN_FFPROBE_PATH',
  'libx264',
  'drawtext',
  'platformLike',
  'ancillary',
  'Unexpected native ${platform} artifact',
  'linux-x86_64\\\\.AppImage',
  'win-x64\\\\.exe',
  'mac-(arm64|x64)'
]) {
  check(nativeEvidenceSource.includes(marker), `Native artifact evidence omits fail-closed marker: ${marker}`)
}
for (const marker of [
  'git',
  'fetch',
  '+refs/tags/${tag}:refs/tags/${tag}',
  "'gh'",
  "'release'",
  "'download'",
  'verifyNativeEvidenceBundle',
  'verifyVideoEditorArchive',
  'assertTagMatchesCheckout',
  'shell: false',
  "process.argv.includes('--tag-only')"
]) {
  check(
    manualReleaseVerifierSource.includes(marker),
    `Manual Extension release verifier omits fail-closed marker: ${marker}`
  )
}
for (const marker of [
  'verifyNativeEvidenceBundle',
  'extension-native-evidence-${platform}.json',
  'sha256File',
  'details.isSymbolicLink()',
  'duplicate filename',
  'tagCommit',
  'expectedVersion',
  'mediaToolchain',
  'libx264',
  'drawtext',
  'KUN_NAMED_RELEASE_ASSET',
  'ancillaryPattern',
  'unexpected Kun-named asset'
]) {
  check(
    nativeEvidenceVerifierSource.includes(marker),
    `Native evidence bundle verifier omits fail-closed marker: ${marker}`
  )
}
for (const marker of [
  'first.kunx',
  'second.kunx',
  'assertDeterministicArchives',
  "'extension'",
  "'validate'",
  "'pack'",
  'sha256File',
  'details.isSymbolicLink()'
]) {
  check(videoEditorPackSource.includes(marker), `Video editor release pack omits marker: ${marker}`)
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
for (const [label, source] of [
  ['PR', prWorkflow],
  ['Release', releaseWorkflow]
]) {
  check(
    (source.match(/npm run smoke:extension-native-media/g) ?? []).length >= 3 &&
      (source.match(/npm run smoke:packaged-video-editor-native/g) ?? []).length >= 3 &&
      (source.match(/KUN_RUN_MEDIA_SMOKE: '1'/g) ?? []).length >= 3,
    `${label} workflow must fail closed on both native media smokes for macOS, Windows, and Linux`
  )
  check(
    (source.match(/Install host-native FFmpeg/g) ?? []).length >= 2,
    `${label} workflow must provision host-native FFmpeg explicitly on macOS and Windows`
  )
  check(
    source.includes(videoEditorPackCommand) &&
      source.includes('dist/kun-video-editor-*.kunx'),
    `${label} workflow must build and upload the deterministic Kun Video Editor .kunx`
  )
}
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
  (releaseWorkflow.match(/KUN_EVIDENCE_COMMIT: \$\{\{ github\.event\.pull_request\.merge_commit_sha \}\}/g) ?? [])
    .length === 3,
  'Closed-PR release evidence must bind all platforms to the explicitly checked-out merge commit'
)
check(
  /Install Linux packaging dependencies[\s\S]*?\bxvfb\b[\s\S]*?\butil-linux\b[\s\S]*?\bffmpeg\b/.test(releaseWorkflow) &&
    /Install Linux packaging dependencies[\s\S]*?\bxvfb\b[\s\S]*?\butil-linux\b[\s\S]*?\bffmpeg\b/.test(prWorkflow),
  'Linux release and PR package workflows must install xvfb, util-linux, and FFmpeg'
)

const releaseMacJob = workflowJob(releaseWorkflowDocument, 'build-macos', 'macos-latest')
requireBoundedJobTimeout(releaseMacJob, 'build-macos', 90)
requireOrderedCommands(releaseMacJob, 'build-macos', [
  'npm run check:extension-release-gate',
  'npm run dist:mac:signed',
  'npm run verify:packaged-macos-native -- --resources dist/mac/Kun.app/Contents/Resources --arch x64',
  'npm run verify:packaged-macos-native -- --resources dist/mac-arm64/Kun.app/Contents/Resources --arch arm64',
  smokePackagedOcrCommand,
  'npm run smoke:packaged-extensions -- --resources dist/mac/Kun.app/Contents/Resources',
  'npm run smoke:packaged-extensions -- --resources dist/mac-arm64/Kun.app/Contents/Resources',
  nativeMediaSmokeCommand,
  packagedVideoNativeCommand,
  'npm run smoke:packaged-extension-desktop',
  nativeEvidenceCommand
])
requireUnconditionalStepAfter(
  releaseMacJob,
  'build-macos',
  'Upload macOS artifacts',
  nativeEvidenceCommand
)
const releaseMacX64Job = workflowJob(
  releaseWorkflowDocument,
  'verify-macos-x64',
  'macos-15-intel'
)
requireBoundedJobTimeout(releaseMacX64Job, 'verify-macos-x64', 30)
requireJobDependencies(releaseMacX64Job, 'verify-macos-x64', ['prepare', 'build-macos'])
requireOrderedCommands(releaseMacX64Job, 'verify-macos-x64', [
  verifyMacX64Command,
  smokePackagedOcrCommand,
  smokeMacX64ExtensionsCommand,
  smokeMacX64DesktopCommand
])
const releaseWindowsJob = workflowJob(releaseWorkflowDocument, 'build-windows', 'windows-latest')
requireBoundedJobTimeout(releaseWindowsJob, 'build-windows', 90)
requireOrderedCommands(releaseWindowsJob, 'build-windows', [
  'npm run check:extension-release-gate',
  'npm run dist:win',
  'npm run smoke:packaged-extensions -- --resources dist/win-unpacked/resources',
  nativeMediaSmokeCommand,
  packagedVideoNativeCommand,
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
  nativeMediaSmokeCommand,
  videoEditorPackCommand,
  packagedVideoReleaseCommand,
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
const releasePublishJob = workflowJob(releaseWorkflowDocument, 'publish', 'ubuntu-latest')
requireNamedStepsInOrder(releasePublishJob, 'release publish', [
  'Download release artifacts',
  'Ensure release tag',
  'Verify three-platform native evidence bundle',
  'Verify downloadable Kun Video Editor extension package',
  'Upload GitHub Release assets'
])
requireStepRunMarkers(
  releasePublishJob,
  'release publish',
  'Verify three-platform native evidence bundle',
  [nativeEvidenceVerifierCommand, '--directory release-artifacts', '--commit', '--tag', '--version']
)
requireStepRunMarkers(
  releasePublishJob,
  'release publish',
  'Verify downloadable Kun Video Editor extension package',
  [videoEditorVerifyCommand, '--input release-artifacts']
)
requireStepRunMarkers(releasePublishJob, 'release publish', 'Upload GitHub Release assets', [
  'extension-native-evidence-*.json',
  'kun-video-editor-*.kunx',
  'gh release upload'
])

const dailyWorkflow = await text('.github/workflows/daily-dev-prerelease.yml')
const dailyWorkflowDocument = parseYaml(dailyWorkflow)
requirePublishDependencies(dailyWorkflowDocument, 'Daily prerelease workflow')
const dailyMacJob = workflowJob(dailyWorkflowDocument, 'build-macos', 'macos-latest')
requireBoundedJobTimeout(dailyMacJob, 'daily build-macos', 90)
requireOrderedCommands(dailyMacJob, 'daily build-macos', [
  'npm run check:extension-release-gate',
  'npm run dist:mac',
  'npm run verify:packaged-macos-native -- --resources dist/mac/Kun.app/Contents/Resources --arch x64',
  'npm run verify:packaged-macos-native -- --resources dist/mac-arm64/Kun.app/Contents/Resources --arch arm64',
  smokePackagedOcrCommand,
  'npm run smoke:packaged-extensions -- --resources dist/mac/Kun.app/Contents/Resources',
  'npm run smoke:packaged-extensions -- --resources dist/mac-arm64/Kun.app/Contents/Resources',
  nativeMediaSmokeCommand,
  packagedVideoNativeCommand,
  'npm run smoke:packaged-extension-desktop',
  nativeEvidenceCommand
])
requireUnconditionalStepAfter(
  dailyMacJob,
  'daily build-macos',
  'Upload macOS artifacts',
  nativeEvidenceCommand
)
const dailyMacX64Job = workflowJob(
  dailyWorkflowDocument,
  'verify-macos-x64',
  'macos-15-intel'
)
requireBoundedJobTimeout(dailyMacX64Job, 'daily verify-macos-x64', 30)
requireJobDependencies(dailyMacX64Job, 'daily verify-macos-x64', ['prepare', 'build-macos'])
requireOrderedCommands(dailyMacX64Job, 'daily verify-macos-x64', [
  verifyMacX64Command,
  smokePackagedOcrCommand,
  smokeMacX64ExtensionsCommand,
  smokeMacX64DesktopCommand
])
const dailyWindowsJob = workflowJob(dailyWorkflowDocument, 'build-windows', 'windows-latest')
requireBoundedJobTimeout(dailyWindowsJob, 'daily build-windows', 90)
requireOrderedCommands(dailyWindowsJob, 'daily build-windows', [
  'npm run check:extension-release-gate',
  'npm run dist:win',
  'npm run smoke:packaged-extensions -- --resources dist/win-unpacked/resources',
  nativeMediaSmokeCommand,
  packagedVideoNativeCommand,
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
  nativeMediaSmokeCommand,
  videoEditorPackCommand,
  packagedVideoReleaseCommand,
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
    /\butil-linux\b/.test(dailyLinuxDependencies) && /\bffmpeg\b/.test(dailyLinuxDependencies),
  'Daily Linux prerelease must install xvfb, xauth, util-linux, and FFmpeg'
)
check(
  (dailyWorkflow.match(/npm run smoke:extension-native-media/g) ?? []).length >= 3 &&
    (dailyWorkflow.match(/npm run smoke:packaged-video-editor-native/g) ?? []).length >= 3 &&
    (dailyWorkflow.match(/KUN_RUN_MEDIA_SMOKE: '1'/g) ?? []).length >= 3 &&
    (dailyWorkflow.match(/Install host-native FFmpeg/g) ?? []).length >= 2,
  'Daily workflow must provision FFmpeg and fail closed on both native media smokes on every host'
)
check(
  dailyWorkflow.includes(videoEditorPackCommand) &&
    dailyWorkflow.includes('dist/kun-video-editor-*.kunx'),
  'Daily workflow must build and upload the deterministic Kun Video Editor .kunx'
)
check(
  !dailyWorkflow.includes('--no-sandbox'),
  'Daily Linux prerelease must not disable the Chromium sandbox'
)
const dailyPublishJob = workflowJob(dailyWorkflowDocument, 'publish', 'ubuntu-latest')
requireNamedStepsInOrder(dailyPublishJob, 'daily publish', [
  'Download daily dev artifacts',
  'Ensure prerelease tag',
  'Verify three-platform native evidence bundle',
  'Verify downloadable Kun Video Editor extension package',
  'Upload GitHub prerelease assets'
])
requireStepRunMarkers(
  dailyPublishJob,
  'daily publish',
  'Verify three-platform native evidence bundle',
  [nativeEvidenceVerifierCommand, '--directory release-artifacts', '--commit', '--tag', '--version']
)
requireStepRunMarkers(
  dailyPublishJob,
  'daily publish',
  'Verify downloadable Kun Video Editor extension package',
  [videoEditorVerifyCommand, '--input release-artifacts']
)
requireStepRunMarkers(dailyPublishJob, 'daily publish', 'Upload GitHub prerelease assets', [
  'extension-native-evidence-*.json',
  'kun-video-editor-*.kunx',
  'gh release upload'
])

const releaseMacScript = await text('scripts/release-mac.sh')
requireOrderedSourceMarkers(releaseMacScript, 'scripts/release-mac.sh execution path', [
  '-- --clean-only',
  'npm run check:extension-release-gate || die "Extension public release gate failed"',
  '\nbuild_macos\n',
  'npm run pack:kun-video-editor || die "Kun Video Editor extension package failed"',
  '\nsmoke_macos_extensions\n',
  '\nrelease_write_meta_file\n',
  'gh release create "${TAG_NAME}"',
  '|| die "Created release tag does not match the local checkout"',
  'upload_github_assets "${TAG_NAME}"'
])
requireSourceMarkersAfter(releaseMacScript, 'scripts/release-mac.sh', '\nsmoke_macos_extensions\n', [
  'gh release create "${TAG_NAME}"',
  'gh release upload "${tag}"',
  'publish-r2.mjs" upload --platform mac'
])
requireOrderedSourceMarkers(releaseMacScript, 'scripts/release-mac.sh packaged smoke function', [
  'npm run verify:packaged-macos-native -- --resources "${x64_resources}" --arch x64',
  'npm run verify:packaged-macos-native -- --resources "${arm64_resources}" --arch arm64',
  'npm run smoke:packaged-extensions -- --resources "${x64_resources}"',
  'npm run smoke:packaged-extensions -- --resources "${arm64_resources}"',
  'KUN_PACKAGED_RESOURCES_DIR="${host_resources}" node scripts/smoke-packaged-ocr.cjs',
  'npm run smoke:packaged-extension-desktop -- --resources "${host_resources}"',
  '--archive "${ROOT}/dist/kun-video-editor-0.4.4.kunx"'
])
for (const marker of [
  '|| die "macOS x64 packaged Extension Node runtime smoke failed"',
  '|| die "macOS arm64 packaged Extension Node runtime smoke failed"',
  '|| die "macOS x64 packaged native architecture verification failed"',
  '|| die "macOS arm64 packaged native architecture verification failed"',
  '|| die "macOS packaged OCR dependency smoke failed"',
  '|| die "macOS packaged Extension desktop Chromium smoke failed"',
  '--archive "${ROOT}/dist/kun-video-editor-0.4.4.kunx"',
  'verify:manual-extension-release',
  'collect "Kun Video Editor extension" "dist/kun-video-editor-*.kunx"',
  '--r2) R2_UPLOAD=true; R2_PROMOTE=false',
  'macOS release only uploads single-platform R2 metadata'
]) {
  check(releaseMacScript.includes(marker), `scripts/release-mac.sh does not fail closed: ${marker}`)
}
check(
  !releaseMacScript.includes('publish-r2.mjs" promote --tag'),
  'scripts/release-mac.sh must not promote a single-platform R2 release'
)
check(
  !releaseMacScript.includes('build_macos_parallel') &&
    releaseMacScript.includes(
      'Building macOS serially for architecture-specific native dependencies'
    ),
  'scripts/release-mac.sh must not race architecture-specific native package preparation'
)

const releaseWinScript = await text('scripts/release-win.sh')
requireOrderedSourceMarkers(releaseWinScript, 'scripts/release-win.sh execution path', [
  '-- --clean-only',
  '--version "${RELEASE_VERSION}" --tag-only',
  'npm run check:extension-release-gate || die "Extension public release gate failed"',
  'npm run dist:win || die "Windows build failed"',
  'npm run smoke:packaged-extensions -- --resources dist/win-unpacked/resources',
  'npm run smoke:packaged-extension-desktop',
  'gh release upload "${TAG_NAME}"',
  'if $PUBLISH || [[ "${R2_PROMOTE}" == "true" ]]; then',
  'npm run verify:manual-extension-release -- --tag "${TAG_NAME}" --version "${RELEASE_VERSION}"',
  '|| die "Complete three-platform release verification failed"',
  'publish-r2.mjs" promote --tag "${TAG_NAME}" --channel "${RELEASE_CHANNEL}" --platforms mac,win,linux',
  'gh release edit "${TAG_NAME}" --draft=false'
])
requireSourceMarkersAfter(
  releaseWinScript,
  'scripts/release-win.sh',
  'npm run smoke:packaged-extension-desktop',
  [
    'gh release upload "${TAG_NAME}"',
    'if $PUBLISH || [[ "${R2_PROMOTE}" == "true" ]]; then',
    'npm run verify:manual-extension-release -- --tag "${TAG_NAME}" --version "${RELEASE_VERSION}"',
    '|| die "Complete three-platform release verification failed"',
    'publish-r2.mjs" upload --platform win',
    'publish-r2.mjs" promote --tag "${TAG_NAME}" --channel "${RELEASE_CHANNEL}" --platforms mac,win,linux',
    'gh release edit "${TAG_NAME}" --draft=false'
  ]
)
for (const marker of [
  '|| die "Windows packaged Extension Node runtime smoke failed"',
  '|| die "Windows packaged Extension desktop Chromium smoke failed"',
  'Downloading and verifying the complete three-platform release bundle',
  'verify:manual-extension-release'
]) {
  check(releaseWinScript.includes(marker), `scripts/release-win.sh does not fail closed: ${marker}`)
}

const releaseWinPowerShell = await text('scripts/release-win.ps1')
requireOrderedSourceMarkers(releaseWinPowerShell, 'scripts/release-win.ps1 execution path', [
  '-- --clean-only',
  '--version $ReleaseVersion --tag-only',
  '& npm run check:extension-release-gate',
  '& npm run dist:win',
  '& npm run smoke:packaged-extensions -- --resources dist/win-unpacked/resources',
  '& npm run smoke:packaged-extension-desktop',
  '& gh release upload $TagName',
  'if ($Publish -or $PromoteR2)',
  '& npm run verify:manual-extension-release -- --tag $TagName --version $ReleaseVersion',
  "Write-Err 'Complete three-platform release verification failed.'",
  "'scripts\\publish-r2.mjs') promote --tag $TagName --channel $ReleaseChannel --platforms mac,win,linux",
  '& gh release edit $TagName --draft=false'
])
requireSourceMarkersAfter(
  releaseWinPowerShell,
  'scripts/release-win.ps1',
  '& npm run smoke:packaged-extension-desktop',
  [
    '& gh release upload $TagName',
    'if ($Publish -or $PromoteR2)',
    '& npm run verify:manual-extension-release -- --tag $TagName --version $ReleaseVersion',
    "Write-Err 'Complete three-platform release verification failed.'",
    "'scripts\\publish-r2.mjs') upload --platform win",
    "'scripts\\publish-r2.mjs') promote --tag $TagName --channel $ReleaseChannel --platforms mac,win,linux",
    '& gh release edit $TagName --draft=false'
  ]
)
for (const marker of [
  "Write-Err 'Extension public release gate failed.'",
  "Write-Err 'Windows packaged Extension Node runtime smoke failed.'",
  "Write-Err 'Windows packaged Extension desktop Chromium smoke failed.'",
  "Write-Err 'Complete three-platform release verification failed.'",
  'verify:manual-extension-release'
]) {
  check(releaseWinPowerShell.includes(marker), `scripts/release-win.ps1 does not fail closed: ${marker}`)
}

const releaseCommonSource = await text('scripts/lib/release-common.sh')
for (const marker of [
  'dist/extension-native-evidence-*.json',
  'dist/kun-video-editor-*.kunx'
]) {
  check(releaseCommonSource.includes(marker), `Manual release cleanup omits stale generated asset: ${marker}`)
  check(releaseWinPowerShell.includes(marker.replaceAll('/', '\\')), `PowerShell cleanup omits stale generated asset: ${marker}`)
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
  nativeMediaSmokeCommand,
  videoEditorPackCommand,
  packagedVideoReleaseCommand,
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
  'npm run verify:packaged-macos-native -- --resources dist/mac/Kun.app/Contents/Resources --arch x64',
  'npm run verify:packaged-macos-native -- --resources dist/mac-arm64/Kun.app/Contents/Resources --arch arm64',
  smokePackagedOcrCommand,
  'npm run smoke:packaged-extensions -- --resources dist/mac/Kun.app/Contents/Resources',
  'npm run smoke:packaged-extensions -- --resources dist/mac-arm64/Kun.app/Contents/Resources',
  nativeMediaSmokeCommand,
  packagedVideoNativeCommand,
  'npm run smoke:packaged-extension-desktop',
  nativeEvidenceCommand
])
requireUnconditionalStepAfter(
  prMacJob,
  'package-macos',
  'Upload ad-hoc macOS PR packages',
  nativeEvidenceCommand
)
const prMacX64Job = workflowJob(
  prWorkflowDocument,
  'package-macos-x64-runtime',
  'macos-15-intel'
)
requireBoundedJobTimeout(prMacX64Job, 'package-macos-x64-runtime', 30)
requireJobDependencies(prMacX64Job, 'package-macos-x64-runtime', ['package-macos'])
requireOrderedCommands(prMacX64Job, 'package-macos-x64-runtime', [
  verifyMacX64Command,
  smokePackagedOcrCommand,
  smokeMacX64ExtensionsCommand,
  smokeMacX64DesktopCommand
])
const prWindowsJob = workflowJob(prWorkflowDocument, 'package-windows', 'windows-latest')
requireBoundedJobTimeout(prWindowsJob, 'package-windows', 90)
requireJobDependencies(prWindowsJob, 'package-windows', ['test'])
requireOrderedCommands(prWindowsJob, 'package-windows', [
  'npm run dist:win',
  'npm run smoke:packaged-extensions -- --resources dist/win-unpacked/resources',
  nativeMediaSmokeCommand,
  packagedVideoNativeCommand,
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
  'package-macos-x64-runtime',
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
  label: 'Extension media protocol isolation release suite',
  command: process.execPath,
  args: [
    vitestEntry,
    'run',
    'src/main/extensions/extension-media-protocol.test.ts',
    'src/main/extensions/extension-view-methods.test.ts',
    'src/main/ipc/register-extension-ipc-handlers.test.ts'
  ],
  cwd: root
})
runRequiredCommand({
  label: 'Extension native media supervision and cancellation release suite',
  command: process.execPath,
  args: [
    vitestEntry,
    'run',
    '--pool=threads',
    '--maxWorkers=1',
    'src/services/extension-media-handle-service.test.ts',
    'src/services/extension-media-process-service.test.ts',
    'src/services/extension-media-ffmpeg-service.test.ts',
    'src/services/extension-media-job-service.test.ts',
    'src/services/extension-media-native-smoke.test.ts'
  ],
  cwd: join(root, 'kun')
})
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
  'Extension public release gate OK: platform exposed, API v1.2/v1.1/v1.0 compatibility, media protocol isolation, native process cleanup, external tarball acceptance, legacy behaviors, packaged resources, bundled defaults, and video editor lifecycle wiring passed. Host-native packaged playback evidence remains a separate per-platform release sign-off.\n'
)
