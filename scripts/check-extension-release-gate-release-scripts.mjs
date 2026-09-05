import {
  check,
  problems,
  requireBoundedCommandStep,
  requireBoundedJobTimeout,
  requireJobDependencies,
  requireLinuxUserNamespaceStep,
  requireNamedStepsInOrder,
  requireOrderedCommands,
  requireOrderedSourceMarkers,
  requireSourceMarkersAfter,
  requireUnconditionalStepAfter,
  text,
  workflowJob
} from './check-extension-release-gate-context.mjs'
import {
  appImageDesktopCommand,
  buildOnlyCi,
  nativeEvidenceCommand,
  nativeMediaSmokeCommand,
  prWorkflowDocument,
  smokeMacX64DesktopCommand,
  smokeMacX64ExtensionsCommand,
  smokePackagedOcrCommand,
  verifyMacX64Command
} from './check-extension-release-gate-workflows.mjs'

const releaseMacScript = await text('scripts/release-mac.sh')
requireOrderedSourceMarkers(releaseMacScript, 'scripts/release-mac.sh execution path', [
  '-- --clean-only',
  'npm run check:extension-release-gate || die "Extension public release gate failed"',
  '\nbuild_macos\n',
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
  'npm run smoke:packaged-extension-desktop -- --resources "${host_resources}"'
])
for (const marker of [
  '|| die "macOS x64 packaged Extension Node runtime smoke failed"',
  '|| die "macOS arm64 packaged Extension Node runtime smoke failed"',
  '|| die "macOS x64 packaged native architecture verification failed"',
  '|| die "macOS arm64 packaged native architecture verification failed"',
  '|| die "macOS packaged Kun terminal command smoke failed"',
  '|| die "macOS packaged OCR dependency smoke failed"',
  '|| die "macOS packaged Extension desktop Chromium smoke failed"',
  'verify:manual-extension-release',
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
  '|| die "Windows packaged Kun terminal command smoke failed"',
  '|| die "Windows packaged Extension desktop Chromium smoke failed"',
  'Downloading and verifying the complete three-platform release bundle',
  'verify:manual-extension-release',
  '--require-all-platforms'
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
  "Write-Err 'Windows packaged Kun terminal command smoke failed.'",
  "Write-Err 'Windows packaged Extension desktop Chromium smoke failed.'",
  "Write-Err 'Complete three-platform release verification failed.'",
  'verify:manual-extension-release',
  '--require-all-platforms'
]) {
  check(releaseWinPowerShell.includes(marker), `scripts/release-win.ps1 does not fail closed: ${marker}`)
}

const releaseCommonSource = await text('scripts/lib/release-common.sh')
for (const marker of ['dist/extension-native-evidence-*.json']) {
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
if (!buildOnlyCi) {
const prTestJob = workflowJob(prWorkflowDocument, 'test', 'ubuntu-latest')
requireOrderedCommands(prTestJob, 'test', ['npm run check:extensions', 'npm run test'])
const prPackageJob = workflowJob(prWorkflowDocument, 'package', 'ubuntu-latest')
requireBoundedJobTimeout(prPackageJob, 'package', 60)
requireJobDependencies(prPackageJob, 'package', ['test'])
requireOrderedCommands(prPackageJob, 'package', [
  'npm run dist:linux',
  'unshare --user --map-root-user /bin/true',
  'xvfb-run -a npm run smoke:development-graph-workbench',
  'npm run smoke:packaged-extensions -- --resources dist/linux-unpacked/resources',
  nativeMediaSmokeCommand,
  'npm run smoke:packaged-extension-desktop',
  appImageDesktopCommand,
  nativeEvidenceCommand
])
requireLinuxUserNamespaceStep(prPackageJob, 'package')
requireBoundedCommandStep(
  prPackageJob,
  'package',
  'Smoke packaged Extension desktop Chromium',
  'npm run smoke:packaged-extension-desktop',
  10
)
requireBoundedCommandStep(
  prPackageJob,
  'package',
  'Smoke Graph workbench pointer interactions on native Linux',
  'xvfb-run -a npm run smoke:development-graph-workbench',
  10
)
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
  'npm run smoke:packaged-extension-desktop',
  nativeEvidenceCommand
])
requireBoundedCommandStep(
  prMacJob,
  'package-macos',
  'Smoke packaged Extension desktop Chromium (host-native macOS)',
  'npm run smoke:packaged-extension-desktop',
  10
)
requireBoundedCommandStep(
  prMacJob,
  'package-macos',
  'Smoke Graph workbench pointer interactions on native macOS',
  'npm run smoke:development-graph-workbench',
  10
)
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
requireBoundedCommandStep(
  prMacX64Job,
  'package-macos-x64-runtime',
  'Smoke final macOS x64 desktop Chromium',
  smokeMacX64DesktopCommand,
  10
)
const prWindowsJob = workflowJob(prWorkflowDocument, 'package-windows', 'windows-latest')
requireBoundedJobTimeout(prWindowsJob, 'package-windows', 90)
requireJobDependencies(prWindowsJob, 'package-windows', ['test'])
requireOrderedCommands(prWindowsJob, 'package-windows', [
  'npm run dist:win',
  'npm run smoke:packaged-extensions -- --resources dist/win-unpacked/resources',
  nativeMediaSmokeCommand,
  'npm run smoke:packaged-extension-desktop',
  nativeEvidenceCommand
])
requireBoundedCommandStep(
  prWindowsJob,
  'package-windows',
  'Smoke packaged Extension desktop Chromium (host-native Windows)',
  'npm run smoke:packaged-extension-desktop',
  10
)
requireBoundedCommandStep(
  prWindowsJob,
  'package-windows',
  'Smoke Graph workbench pointer interactions on native Windows',
  'npm run smoke:development-graph-workbench',
  10
)
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
}

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
