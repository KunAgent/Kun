import {
  LINUX_USER_NAMESPACE_SETUP,
  LINUX_USER_NAMESPACE_STEP_NAME,
  access,
  check,
  join,
  parseYaml,
  requireBoundedCommandStep,
  requireBoundedJobTimeout,
  requireJobDependencies,
  requireLinuxUserNamespaceStep,
  requireNamedStepsInOrder,
  requireOrderedCommands,
  requirePublishDependencies,
  requireSharedExtensionReleaseGate,
  requireStepRunMarkers,
  requireUnconditionalStepAfter,
  root,
  text,
  workflowJob
} from './check-extension-release-gate-context.mjs'
import { rootPackage } from './check-extension-release-gate-platform.mjs'

const prWorkflow = await text('.github/workflows/pr-checks.yml')
export const prWorkflowDocument = parseYaml(prWorkflow)
export const appImageDesktopCommand = 'npm run smoke:packaged-extension-appimage'
export const nativeMediaSmokeCommand = 'npm run smoke:extension-native-media'
export const nativeEvidenceCommand = 'npm run evidence:extension-native'
const nativeEvidenceVerifierCommand = 'npm run verify:extension-native-evidence'
export const verifyMacX64Command =
  'npm run verify:packaged-macos-native -- --resources dist/mac-x64-verified/Kun.app/Contents/Resources --arch x64'
export const smokeMacX64ExtensionsCommand =
  'npm run smoke:packaged-extensions -- --resources dist/mac-x64-verified/Kun.app/Contents/Resources'
export const smokeMacX64DesktopCommand =
  'npm run smoke:packaged-extension-desktop -- --resources dist/mac-x64-verified/Kun.app/Contents/Resources'
export const smokePackagedOcrCommand = 'node scripts/smoke-packaged-ocr.cjs'
const updateHandoffSmokeCommand = 'npm run smoke:packaged-update-handoff'
const buildOnlyProbe = prWorkflow.replaceAll(updateHandoffSmokeCommand, '')
export const buildOnlyCi = !buildOnlyProbe.includes('npm run smoke:') &&
  !prWorkflow.includes('npm run test') &&
  prWorkflow.includes('npm run dist:linux')
if (!buildOnlyCi) {
const nativeEvidenceSource = await text('scripts/write-extension-native-evidence.mjs')
const nativeEvidenceVerifierSource = await text('scripts/verify-extension-native-evidence.mjs')
const manualReleaseVerifierSource = await text('scripts/verify-manual-extension-release.mjs')
const nativeMediaSmokeSource = await text('scripts/run-extension-native-media-smoke.cjs')
const bundledExtensionsPackSource = await text('scripts/pack-bundled-extensions.mjs')
check(
  rootPackage.scripts?.['build:bundled-extensions'] ===
    'node ./scripts/pack-bundled-extensions.mjs --output ./resources/bundled-extensions' &&
    rootPackage.scripts?.build?.includes('npm run build:bundled-extensions') &&
    (
      rootPackage.scripts?.dev?.includes('npm run build:bundled-extensions') ||
      (
        rootPackage.scripts?.dev?.includes('npm run dev:app') &&
        rootPackage.scripts?.['dev:app']?.includes('npm run build:bundled-extensions')
      )
    ),
  'Kun build and dev must generate the canonical default extension catalog before launch'
)
for (const marker of [
  'BUNDLED_EXTENSION_DEFINITIONS',
  'BUNDLED_EXTENSION_CATALOG_FILE',
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
  bundledExtensionsPackSource.includes("'kun-video-editor'") &&
    bundledExtensionsPackSource.includes("'presentation-studio'") &&
    bundledExtensionsPackSource.includes("'kun-examples.kun-video-editor'") &&
    bundledExtensionsPackSource.includes("'kun-examples.presentation-studio'") &&
    !bundledExtensionsPackSource.includes("id: 'kun-examples.kun-video-editor'") &&
    !bundledExtensionsPackSource.includes("id: 'kun-examples.presentation-studio'"),
  'Bundled Extension packer must remove stale retired archives without packaging them as defaults'
)
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
  !rootPackage.scripts?.['pack:kun-video-editor'] &&
    !rootPackage.scripts?.['verify:kun-video-editor-package'] &&
    !rootPackage.scripts?.['smoke:packaged-video-editor-native'] &&
    !rootPackage.scripts?.['check:extension-release-gate']?.includes('video-editor'),
  'package.json must not expose video editor packaging or packaged smoke commands'
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
  'amd64\\\\.deb',
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
check(
  rootPackage.scripts?.['check:extensions']?.includes('npm run check:extension-release-gate'),
  'Shared Extension validation must include the complete Extension release gate'
)
for (const command of ['npm run check:extensions', 'npm run test', 'npm run dist:linux']) {
  check(prWorkflow.includes(command), `PR checks omit release prerequisite: ${command}`)
}
requireSharedExtensionReleaseGate(prWorkflowDocument, 'PR', 'test', [
  'package',
  'package-macos',
  'package-windows'
])
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
requireSharedExtensionReleaseGate(releaseWorkflowDocument, 'Stable release', 'validate', [
  'build-macos',
  'build-windows',
  'build-linux'
])
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
      (source.match(/KUN_RUN_MEDIA_SMOKE: '1'/g) ?? []).length >= 3,
    `${label} workflow must fail closed on the native media smoke for macOS, Windows, and Linux`
  )
  check(
    (source.match(/Install host-native FFmpeg/g) ?? []).length >= 2,
    `${label} workflow must provision host-native FFmpeg explicitly on macOS and Windows`
  )
  check(
    !source.includes('kun-video-editor') &&
      !source.includes('packaged-video-editor'),
    `${label} workflow must not build, smoke, or upload the source-only video editor`
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
for (const [label, source] of [
  ['PR', prWorkflow],
  ['Release', releaseWorkflow]
]) {
  check(
    (source.match(/npm run smoke:packaged-update-handoff/g) ?? []).length >= 4,
    `${label} workflow must run packaged update handoff acceptance on macOS, Windows, and both Linux architectures`
  )
}
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
  'npm run dist:mac:signed',
  'npm run verify:packaged-macos-native -- --resources dist/mac/Kun.app/Contents/Resources --arch x64',
  'npm run verify:packaged-macos-native -- --resources dist/mac-arm64/Kun.app/Contents/Resources --arch arm64',
  smokePackagedOcrCommand,
  'npm run smoke:packaged-extensions -- --resources dist/mac/Kun.app/Contents/Resources',
  'npm run smoke:packaged-extensions -- --resources dist/mac-arm64/Kun.app/Contents/Resources',
  nativeMediaSmokeCommand,
  'npm run smoke:packaged-extension-desktop',
  nativeEvidenceCommand
])
requireBoundedCommandStep(
  releaseMacJob,
  'build-macos',
  'Smoke packaged Extension desktop Chromium (host-native macOS)',
  'npm run smoke:packaged-extension-desktop',
  10
)
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
requireBoundedCommandStep(
  releaseMacX64Job,
  'verify-macos-x64',
  'Smoke final macOS x64 desktop Chromium',
  smokeMacX64DesktopCommand,
  10
)
const releaseWindowsJob = workflowJob(releaseWorkflowDocument, 'build-windows', 'windows-latest')
requireBoundedJobTimeout(releaseWindowsJob, 'build-windows', 90)
requireOrderedCommands(releaseWindowsJob, 'build-windows', [
  'npm run dist:win',
  'npm run smoke:packaged-extensions -- --resources dist/win-unpacked/resources',
  nativeMediaSmokeCommand,
  'npm run smoke:packaged-extension-desktop',
  nativeEvidenceCommand
])
requireBoundedCommandStep(
  releaseWindowsJob,
  'build-windows',
  'Smoke packaged Extension desktop Chromium',
  'npm run smoke:packaged-extension-desktop',
  10
)
requireUnconditionalStepAfter(
  releaseWindowsJob,
  'build-windows',
  'Upload Windows artifacts',
  nativeEvidenceCommand
)
const releaseLinuxJob = workflowJob(releaseWorkflowDocument, 'build-linux', 'ubuntu-latest')
requireBoundedJobTimeout(releaseLinuxJob, 'build-linux', 90)
requireOrderedCommands(releaseLinuxJob, 'build-linux', [
  'npm run dist:linux',
  'npm run smoke:packaged-extensions -- --resources dist/linux-unpacked/resources',
  nativeMediaSmokeCommand,
  'unshare --user --map-root-user /bin/true',
  'npm run smoke:packaged-extension-desktop',
  appImageDesktopCommand,
  nativeEvidenceCommand
])
requireLinuxUserNamespaceStep(releaseLinuxJob, 'build-linux')
requireBoundedCommandStep(
  releaseLinuxJob,
  'build-linux',
  'Smoke packaged Extension desktop Chromium',
  'npm run smoke:packaged-extension-desktop',
  10
)
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
  'Upload GitHub Release assets'
])
requireStepRunMarkers(
  releasePublishJob,
  'release publish',
  'Verify three-platform native evidence bundle',
  [nativeEvidenceVerifierCommand, '--directory release-artifacts', '--commit', '--tag', '--version']
)
requireStepRunMarkers(releasePublishJob, 'release publish', 'Upload GitHub Release assets', [
  'extension-native-evidence-*.json',
  'gh release upload'
])
for (const marker of [
  'node-version: \'22.23.1\'',
  'darwin-arm64',
  'darwin-x64',
  'linux-x64',
  'win32-x64',
  'npm run package:tui',
  'npm run assemble:tui-release',
  'publish-r2.mjs upload-tui',
  '--require-tui',
  '--expected-build-id'
]) {
  check(releaseWorkflow.includes(marker), `Release workflow omits joint GUI/TUI gate: ${marker}`)
}

const dailyWorkflow = await text('.github/workflows/daily-dev-prerelease.yml')
const dailyWorkflowDocument = parseYaml(dailyWorkflow)
check(
  (dailyWorkflow.match(/npm run smoke:packaged-update-handoff/g) ?? []).length >= 4,
  'Daily workflow must run packaged update handoff acceptance on macOS, Windows, and both Linux architectures'
)
requirePublishDependencies(dailyWorkflowDocument, 'Daily prerelease workflow')
requireSharedExtensionReleaseGate(dailyWorkflowDocument, 'Daily prerelease', 'validate', [
  'build-macos',
  'build-windows',
  'build-linux'
])
const dailyMacJob = workflowJob(dailyWorkflowDocument, 'build-macos', 'macos-latest')
requireBoundedJobTimeout(dailyMacJob, 'daily build-macos', 90)
requireOrderedCommands(dailyMacJob, 'daily build-macos', [
  'npm run dist:mac',
  'npm run verify:packaged-macos-native -- --resources dist/mac/Kun.app/Contents/Resources --arch x64',
  'npm run verify:packaged-macos-native -- --resources dist/mac-arm64/Kun.app/Contents/Resources --arch arm64',
  smokePackagedOcrCommand,
  'npm run smoke:packaged-extensions -- --resources dist/mac/Kun.app/Contents/Resources',
  'npm run smoke:packaged-extensions -- --resources dist/mac-arm64/Kun.app/Contents/Resources',
  nativeMediaSmokeCommand,
  'npm run smoke:packaged-extension-desktop',
  nativeEvidenceCommand
])
requireBoundedCommandStep(
  dailyMacJob,
  'daily build-macos',
  'Smoke packaged Extension desktop Chromium (host-native macOS)',
  'npm run smoke:packaged-extension-desktop',
  10
)
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
requireBoundedCommandStep(
  dailyMacX64Job,
  'daily verify-macos-x64',
  'Smoke final macOS x64 desktop Chromium',
  smokeMacX64DesktopCommand,
  10
)
const dailyWindowsJob = workflowJob(dailyWorkflowDocument, 'build-windows', 'windows-latest')
requireBoundedJobTimeout(dailyWindowsJob, 'daily build-windows', 90)
requireOrderedCommands(dailyWindowsJob, 'daily build-windows', [
  'npm run dist:win',
  'npm run smoke:packaged-extensions -- --resources dist/win-unpacked/resources',
  nativeMediaSmokeCommand,
  'npm run smoke:packaged-extension-desktop',
  nativeEvidenceCommand
])
requireBoundedCommandStep(
  dailyWindowsJob,
  'daily build-windows',
  'Smoke packaged Extension desktop Chromium',
  'npm run smoke:packaged-extension-desktop',
  10
)
requireUnconditionalStepAfter(
  dailyWindowsJob,
  'daily build-windows',
  'Upload Windows artifacts',
  nativeEvidenceCommand
)
const dailyLinuxJob = workflowJob(dailyWorkflowDocument, 'build-linux', 'ubuntu-latest')
requireBoundedJobTimeout(dailyLinuxJob, 'daily build-linux', 90)
requireOrderedCommands(dailyLinuxJob, 'daily build-linux', [
  'npm run dist:linux',
  'npm run smoke:packaged-extensions -- --resources dist/linux-unpacked/resources',
  nativeMediaSmokeCommand,
  'unshare --user --map-root-user /bin/true',
  'npm run smoke:packaged-extension-desktop',
  appImageDesktopCommand,
  nativeEvidenceCommand
])
requireLinuxUserNamespaceStep(dailyLinuxJob, 'daily build-linux')
requireBoundedCommandStep(
  dailyLinuxJob,
  'daily build-linux',
  'Smoke packaged Extension desktop Chromium',
  'npm run smoke:packaged-extension-desktop',
  10
)
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
    (dailyWorkflow.match(/KUN_RUN_MEDIA_SMOKE: '1'/g) ?? []).length >= 3 &&
    (dailyWorkflow.match(/Install host-native FFmpeg/g) ?? []).length >= 2,
  'Daily workflow must provision FFmpeg and fail closed on the native media smoke on every host'
)
check(
  !dailyWorkflow.includes('kun-video-editor') &&
    !dailyWorkflow.includes('packaged-video-editor'),
  'Daily workflow must not build, smoke, or upload the source-only video editor'
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
  'Upload GitHub prerelease assets'
])
requireStepRunMarkers(
  dailyPublishJob,
  'daily publish',
  'Verify three-platform native evidence bundle',
  [nativeEvidenceVerifierCommand, '--directory release-artifacts', '--commit', '--tag', '--version']
)
requireStepRunMarkers(dailyPublishJob, 'daily publish', 'Upload GitHub prerelease assets', [
  'extension-native-evidence-*.json',
  'gh release upload'
])
for (const marker of [
  'node-version: \'22.23.1\'',
  'darwin-arm64',
  'darwin-x64',
  'linux-x64',
  'win32-x64',
  'npm run package:tui',
  'npm run assemble:tui-release',
  'publish-r2.mjs upload-tui',
  '--require-tui',
  '--expected-build-id'
]) {
  check(dailyWorkflow.includes(marker), `Daily workflow omits joint GUI/TUI gate: ${marker}`)
}

}

if (buildOnlyCi) {
  const releaseWorkflow = await text('.github/workflows/release.yml')
  const dailyWorkflow = await text('.github/workflows/daily-dev-prerelease.yml')
  for (const [label, source] of [
    ['PR', prWorkflow],
    ['Release', releaseWorkflow],
    ['Daily prerelease', dailyWorkflow]
  ]) {
    check((source.match(/npm run smoke:packaged-update-handoff/g) ?? []).length >= 4,
      `${label} workflow must run packaged update handoff acceptance on every packaged architecture`)
    const buildOnlySource = source.replaceAll(updateHandoffSmokeCommand, '')
    check(source.includes('npm run dist:'), `${label} workflow must build distributable artifacts`)
    for (const forbidden of [
      'npm run typecheck',
      'npm run lint',
      'npm run audit:production',
      'npm run check:extensions',
      'npm run test',
      'npm run smoke:',
      'npm run evidence:',
      'npm run verify:packaged-'
    ]) {
      check(!buildOnlySource.includes(forbidden), `${label} workflow must not invoke ${forbidden}`)
    }
  }
  const release = parseYaml(releaseWorkflow)
  const daily = parseYaml(dailyWorkflow)
  for (const [label, workflow, buildJobs] of [
    ['Stable release', release, ['build-macos', 'build-windows', 'build-linux', 'build-linux-arm64', 'build-tui']],
    ['Daily prerelease', daily, ['build-macos', 'build-windows', 'build-linux', 'build-linux-arm64', 'build-tui']]
  ]) {
    check(!workflow.jobs.validate, `${label} must not define a validation job`)
    check(!workflow.jobs['verify-macos-x64'], `${label} must not define a macOS artifact verification job`)
    for (const jobId of buildJobs) {
      const needs = Array.isArray(workflow.jobs[jobId]?.needs)
        ? workflow.jobs[jobId].needs
        : [workflow.jobs[jobId]?.needs]
      check(needs.length === 1 && needs[0] === 'prepare', `${label} ${jobId} must depend only on prepare`)
    }
    const publishNeeds = Array.isArray(workflow.jobs.publish?.needs)
      ? workflow.jobs.publish.needs
      : [workflow.jobs.publish?.needs]
    check(
      publishNeeds.length === buildJobs.length + 1 &&
        publishNeeds.includes('prepare') &&
        buildJobs.every((jobId) => publishNeeds.includes(jobId)),
      `${label} publish must depend on all build jobs`
    )
  }
  for (const [jobId, buildCommand] of [
    ['package', 'npm run dist:linux'],
    ['package-linux-arm64', 'npm run dist:linux:arm64'],
    ['package-macos', 'npm run dist:mac'],
    ['package-windows', 'npm run dist:win']
  ]) {
    const job = prWorkflowDocument.jobs?.[jobId]
    check(Boolean(job), `PR workflow must define ${jobId}`)
    check(job?.needs === undefined, `PR ${jobId} must not depend on a validation job`)
    check(
      (job?.steps ?? []).some((step) => String(step.run ?? '').includes(buildCommand)),
      `PR ${jobId} must run ${buildCommand}`
    )
  }
  const prFailureNeeds = Array.isArray(prWorkflowDocument.jobs?.['request-changes-on-failure']?.needs)
    ? prWorkflowDocument.jobs['request-changes-on-failure'].needs
    : []
  check(
    prFailureNeeds.length === 4 &&
      ['package', 'package-linux-arm64', 'package-macos', 'package-windows']
        .every((jobId) => prFailureNeeds.includes(jobId)),
    'PR failure feedback must depend only on platform builds'
  )
}
