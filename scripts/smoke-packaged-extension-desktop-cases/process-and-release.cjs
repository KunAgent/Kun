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
} = require('../smoke-packaged-extensions.cjs')
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
  isVerifiedIsolatedKunCommand,
  platformDesktopArguments,
  resolvedDesktopResourceCandidates,
  resolveDesktopLaunchSelection,
  runPackagedKun,
  terminateProcessTree,
  waitForPortsClosed
} = require('../smoke-packaged-extension-desktop.cjs')
const {
  withTimeout: withGraphWorkbenchTimeout
} = require('../smoke-development-graph-workbench.cjs')

const root = resolve(__dirname, '../..')
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

function readDesktopSmokeSource() {
  return [
    'smoke-packaged-extension-desktop.cjs',
    'smoke-packaged-extension-desktop-runtime.cjs',
    'smoke-packaged-extension-desktop-cdp.cjs',
    'smoke-packaged-extension-desktop-guest.cjs',
    'smoke-packaged-extension-desktop-media.cjs',
    'smoke-packaged-extension-desktop-process.cjs'
  ].map((name) => readFileSync(join(root, 'scripts', name), 'utf8')).join('\n')
}

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

test('automated release workflows use build gates while local release paths retain smokes', () => {
  const release = parseYaml(readFileSync(join(root, '.github', 'workflows', 'release.yml'), 'utf8'))
  const daily = parseYaml(readFileSync(join(root, '.github', 'workflows', 'daily-dev-prerelease.yml'), 'utf8'))
  const pr = parseYaml(readFileSync(join(root, '.github', 'workflows', 'pr-checks.yml'), 'utf8'))
  const desktopCommand = 'npm run smoke:packaged-extension-desktop'
  const appImageDesktopCommand = 'npm run smoke:packaged-extension-appimage'
  const updateHandoffCommand = 'npm run smoke:packaged-update-handoff'
  const nativeEvidenceCommand = 'npm run evidence:extension-native'
  const packagedOcrCommand = 'node scripts/smoke-packaged-ocr.cjs'
  const verifyMacX64Command =
    'npm run verify:packaged-macos-native -- --resources dist/mac-x64-verified/Kun.app/Contents/Resources --arch x64'
  const smokeMacX64ExtensionsCommand =
    'npm run smoke:packaged-extensions -- --resources dist/mac-x64-verified/Kun.app/Contents/Resources'
  const smokeMacX64DesktopCommand =
    'npm run smoke:packaged-extension-desktop -- --resources dist/mac-x64-verified/Kun.app/Contents/Resources'
  const prWorkflowSource = readFileSync(join(root, '.github', 'workflows', 'pr-checks.yml'), 'utf8')
  // The update handoff smoke is now part of packaging acceptance even while
  // the rest of the broad native/Extension smoke matrix remains local-only.
  const buildOnlyCi = !prWorkflowSource
    .replaceAll(updateHandoffCommand, '')
    .includes('npm run smoke:')

  if (buildOnlyCi) {
    for (const [label, workflow, jobs] of [
      ['stable release', release, ['build-macos', 'build-windows', 'build-linux', 'build-linux-arm64']],
      ['daily prerelease', daily, ['build-macos', 'build-windows', 'build-linux', 'build-linux-arm64']]
    ]) {
      assert.equal(workflow.jobs.validate, undefined, `${label} must not define a validation job`)
      assert.equal(workflow.jobs['verify-macos-x64'], undefined, `${label} must not define a macOS verification job`)
      for (const jobId of jobs) {
        const needs = Array.isArray(workflow.jobs[jobId]?.needs)
          ? workflow.jobs[jobId].needs
          : [workflow.jobs[jobId]?.needs]
        assert.deepEqual(needs, ['prepare'], `${label} ${jobId} must depend only on prepare`)
      }
      const publishNeeds = Array.isArray(workflow.jobs.publish?.needs)
        ? workflow.jobs.publish.needs
        : [workflow.jobs.publish?.needs]
      assert.ok(publishNeeds.includes('prepare'), `${label} publish must depend on prepare`)
      for (const jobId of jobs) {
        assert.ok(publishNeeds.includes(jobId), `${label} publish must depend on ${jobId}`)
      }
    }
    for (const [label, workflow, commands] of [
      ['PR', pr, ['npm run dist:linux', 'npm run dist:mac', 'npm run dist:win']],
      ['stable release', release, ['npm run dist:mac:signed', 'npm run dist:win', 'npm run dist:linux']],
      ['daily prerelease', daily, ['npm run dist:mac', 'npm run dist:win', 'npm run dist:linux']]
    ]) {
      const serialized = JSON.stringify(workflow)
      assert.ok(serialized.includes(updateHandoffCommand), `${label} must run ${updateHandoffCommand}`)
      const source = serialized.replaceAll(updateHandoffCommand, '')
      for (const command of commands) assert.ok(source.includes(command), `${label} must run ${command}`)
      for (const forbidden of ['npm run typecheck', 'npm run lint', 'npm run audit:production', 'npm run check:extensions', 'npm run test', 'npm run smoke:', 'npm run evidence:', 'npm run verify:packaged-']) {
        assert.doesNotMatch(source, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${label} must not run ${forbidden}`)
      }
    }
    const prFailureNeeds = pr.jobs['request-changes-on-failure']?.needs ?? []
    assert.deepEqual(prFailureNeeds.sort(), [
      'package',
      'package-linux-arm64',
      'package-macos',
      'package-windows'
    ])
  } else {
  assertPublishDependencies(release, 'stable release')
  assertPublishDependencies(daily, 'daily prerelease')

  // check:extensions includes the complete static Extension release gate. Run
  // it once in the Linux validation job before native packaging fans out,
  // rather than rebuilding and rerunning the platform-neutral suite on every
  // macOS, Windows, and Linux runner.
  for (const [label, workflow, validationJob, packageJobs] of [
    ['stable release', release, 'validate', ['build-macos', 'build-windows', 'build-linux']],
    ['daily prerelease', daily, 'validate', ['build-macos', 'build-windows', 'build-linux']],
    ['PR', pr, 'test', ['package', 'package-macos', 'package-windows']]
  ]) {
    assertOrderedCommands(workflow.jobs[validationJob], ['npm run check:extensions'])
    for (const jobId of packageJobs) {
      const needs = Array.isArray(workflow.jobs[jobId].needs)
        ? workflow.jobs[jobId].needs
        : [workflow.jobs[jobId].needs]
      assert.ok(needs.includes(validationJob), `${label} ${jobId} must depend on ${validationJob}`)
      assert.doesNotMatch(
        workflow.jobs[jobId].steps.map((step) => step.run ?? '').join('\n'),
        /npm run check:extension-release-gate/,
        `${label} ${jobId} must not duplicate the shared Extension release gate`
      )
    }
  }

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
    'unshare --user --map-root-user /bin/true',
    'xvfb-run -a npm run smoke:development-graph-workbench',
    'npm run smoke:packaged-extensions -- --resources dist/linux-unpacked/resources',
    desktopCommand,
    appImageDesktopCommand,
    nativeEvidenceCommand
  ])
  assertStepAfter(pr.jobs.package, 'Upload Linux package', nativeEvidenceCommand)
  assertOrderedCommands(pr.jobs['package-macos'], [
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
    'npm run dist:win',
    'npm run smoke:packaged-extensions -- --resources dist/win-unpacked/resources',
    desktopCommand,
    nativeEvidenceCommand
  ])
  assertStepAfter(pr.jobs['package-windows'], 'Upload Windows PR package', nativeEvidenceCommand)
  for (const [jobId, stepName] of [
    ['package', 'Smoke Graph workbench pointer interactions on native Linux'],
    ['package-macos', 'Smoke Graph workbench pointer interactions on native macOS'],
    ['package-windows', 'Smoke Graph workbench pointer interactions on native Windows'],
    ['package', 'Smoke packaged Extension desktop Chromium'],
    ['package-macos', 'Smoke packaged Extension desktop Chromium (host-native macOS)'],
    ['package-macos-x64-runtime', 'Smoke final macOS x64 desktop Chromium'],
    ['package-windows', 'Smoke packaged Extension desktop Chromium (host-native Windows)']
  ]) {
    const step = pr.jobs[jobId].steps.find((candidate) => candidate.name === stepName)
    assert.equal(step?.['timeout-minutes'], 10, `${stepName} must have a bounded timeout`)
  }
  assertOrderedCommands(daily.jobs['build-macos'], [
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
    'npm run dist:win',
    'npm run smoke:packaged-extensions -- --resources dist/win-unpacked/resources',
    desktopCommand,
    nativeEvidenceCommand
  ])
  assertStepAfter(daily.jobs['build-windows'], 'Upload Windows artifacts', nativeEvidenceCommand)
  assertOrderedCommands(daily.jobs['build-linux'], [
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

  }

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

  const desktopSource = readDesktopSmokeSource()
  assert.match(desktopSource, /Target\.getTargets/)
  assert.match(desktopSource, /Input\.dispatchMouseEvent/)
  assert.match(desktopSource, /data-contribution-id/)
  assert.match(desktopSource, /data-extension-trusted="true"/)
  assert.match(desktopSource, /kun:extensions-changed/)
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
  const afterPackSource = ['after-pack.cjs', 'after-pack-launchers.cjs']
    .map((name) => readFileSync(join(root, 'scripts', name), 'utf8'))
    .join('\n')
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
    'build-windows',
    'build-linux',
    'build-linux-arm64'
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
