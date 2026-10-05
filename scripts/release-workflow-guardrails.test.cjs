'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { isAbsolute, join } = require('node:path')
const test = require('node:test')
const { parse } = require('yaml')
const {
  installerHelperPaths,
  installerSmokePath
} = require('./check-windows-installer-syntax.cjs')

const workflowDirectory = join(__dirname, '..', '.github', 'workflows')

function readWorkflow(file) {
  return parse(readFileSync(join(workflowDirectory, file), 'utf8'))
}

function stepByName(job, name) {
  return job.steps.find((step) => step.name === name)
}

function normalizedExpression(value) {
  return value.replace(/\s+/gu, ' ').trim()
}

test('Windows PR and stable builds verify native mini window interaction', () => {
  for (const [file, jobName] of [['pr-checks.yml', 'package-windows'], ['release.yml', 'build-windows']]) {
    const job = readWorkflow(file).jobs[jobName]
    assert.equal(job['runs-on'], 'windows-latest')
    const smoke = stepByName(job, 'Smoke Windows mini window interaction and restoration')
    assert.equal(smoke.run, 'npm run smoke:mini-window')
    assert.equal(smoke['timeout-minutes'], 5)
    const evidence = stepByName(job, 'Upload Windows mini window evidence')
    assert.equal(evidence.if, 'always()')
    assert.equal(evidence.with.path, 'dist/mini-window-smoke')
  }
})

test('Windows release jobs outlive their installer smoke timeout', () => {
  for (const file of ['pr-checks.yml', 'release.yml', 'daily-dev-prerelease.yml']) {
    const workflow = readWorkflow(file)
    const jobName = file === 'pr-checks.yml' ? 'package-windows' : 'build-windows'
    const job = workflow.jobs[jobName]
    const smoke = stepByName(job, 'Smoke Windows installer')

    assert.equal(job['timeout-minutes'], 240, `${file} ${jobName}`)
    assert.equal(smoke['timeout-minutes'], 180, `${file} installer smoke`)
    assert.ok(job['timeout-minutes'] > smoke['timeout-minutes'], `${file} timeout headroom`)
  }
})

test('stable release reruns quality gates on the merge commit before preparation', () => {
  const workflow = readWorkflow('release.yml')
  const quality = workflow.jobs.quality
  const prepare = workflow.jobs.prepare

  assert.equal(quality.name, 'Release quality gates')
  assert.equal(quality['timeout-minutes'], 45)
  assert.equal(normalizedExpression(quality.if), normalizedExpression(prepare.if))
  assert.deepEqual(prepare.needs, ['quality'])

  const checkout = stepByName(quality, 'Check out merge commit')
  assert.equal(checkout.uses, 'actions/checkout@v4')
  assert.equal(checkout.with.ref, "${{ github.event_name == 'workflow_dispatch' && github.sha || github.event.pull_request.merge_commit_sha }}")
  assert.equal(checkout.with['fetch-depth'], 0)

  const commands = quality.steps.filter((step) => step.run).map((step) => step.run)
  assert.deepEqual(commands, [
    'npm ci',
    'npm run typecheck',
    'npm run lint',
    'npm test',
    'npm run audit:production'
  ])
})

test('manual candidate builds run quality and packaging without touching published state', () => {
  const workflow = readWorkflow('release.yml')
  assert.ok(Object.hasOwn(workflow.on, 'workflow_dispatch'))
  assert.equal(workflow.jobs.publish.if, "github.event_name != 'workflow_dispatch'")
  assert.equal(workflow.jobs['accept-and-publish'].if, "github.event_name != 'workflow_dispatch'")
  const source = "${{ github.event_name == 'workflow_dispatch' && github.sha || github.event.pull_request.merge_commit_sha }}"
  for (const name of ['quality', 'prepare', 'build-macos', 'build-windows', 'build-linux', 'build-linux-arm64']) {
    const checkout = workflow.jobs[name].steps.find(step => step.uses === 'actions/checkout@v4')
    assert.equal(checkout.with.ref, source)
  }
  assert.match(stepByName(workflow.jobs.prepare, 'Compute release version').run, /--candidate-only/)
  assert.deepEqual(workflow.jobs.prepare.needs, ['quality'])
})

test('PR quality catches production advisories before the stable release merge', () => {
  const workflow = readWorkflow('pr-checks.yml')
  const audit = stepByName(workflow.jobs.quality, 'Production dependency audit')

  assert.equal(audit.run, 'npm run audit:production')
})

test('native Windows recovery runs early and fails closed before packaging and PR acceptance', () => {
  const workflow = readWorkflow('pr-checks.yml')
  const recovery = workflow.jobs['windows-recovery']
  assert.equal(recovery['runs-on'], 'windows-latest')
  assert.equal(recovery.needs, undefined)
  assert.equal(recovery.if, undefined)
  assert.equal(recovery['continue-on-error'], undefined)
  assert.equal(recovery['timeout-minutes'], 20)
  assert.deepEqual(workflow.permissions, { contents: 'read' })
  assert.equal(recovery.permissions, undefined)
  for (const step of recovery.steps) assert.equal(step['continue-on-error'], undefined)
  for (const [name, file] of [
    ['Test Windows update rollback failpoints', 'transaction'],
    ['Test Windows installer recovery safety', 'recovery-safety']
  ]) {
    const step = stepByName(recovery, name)
    assert.equal(step.run, `npx vitest run src/main/windows-installer-migration.${file}.test.ts`)
    assert.equal(step.if, undefined)
  }
  assert.deepEqual(workflow.jobs['package-windows'].needs, ['quality', 'windows-recovery'])
  for (const name of ['pr-gate', 'report-pr-check-feedback']) {
    const job = workflow.jobs[name]
    assert.ok(job.needs.includes('windows-recovery'))
    assert.ok(job.steps.some(step => step.with?.script?.includes("needs['windows-recovery'].result")))
  }
  assert.equal(workflow.jobs['pr-gate'].if, 'always()')
  assert.match(workflow.jobs['pr-gate'].steps[0].with.script, /result !== 'success'/)
  assert.match(workflow.jobs['pr-gate'].steps[0].with.script, /core\.setFailed/)
})

test('stable Linux ARM64 packaging retains the proven PR timeout budget', () => {
  const workflow = readWorkflow('release.yml')

  assert.equal(workflow.jobs['build-linux-arm64']['timeout-minutes'], 180)
})

test('Windows installer syntax checks include the smoke script by absolute path', () => {
  assert.ok(installerHelperPaths.includes(installerSmokePath))
  assert.ok(installerHelperPaths.every(isAbsolute))
})

test('stable latest advances only after candidate integrity checks and public readback', () => {
  const release = readWorkflow('release.yml')
  assert.deepEqual(release.jobs['accept-and-publish'].needs, ['prepare', 'publish'])
  assert.equal(release.jobs['accept-and-publish'].uses, './.github/workflows/release-gui-acceptance.yml')
  assert.ok(release.jobs.publish.steps.every((step) => !step.run?.includes('promote')))
  const acceptance = readWorkflow('release-gui-acceptance.yml')
  assert.equal(acceptance.jobs.accept, undefined)
  assert.equal(acceptance.jobs.promote.needs, undefined)
  const steps = acceptance.jobs.promote.steps
  const verify = steps.findIndex((step) => step.run?.includes('verify-public-release.mjs candidate'))
  const promote = steps.findIndex((step) => step.run?.includes('publish-r2.mjs promote'))
  const readback = steps.findIndex((step) => step.run?.includes('verify-public-release.mjs latest'))
  const publish = steps.findIndex((step) => step.name === 'Publish GitHub Release')
  const metadata = steps.findIndex(step => step.run?.includes('--json assets,tagName,isDraft'))
  assert.ok(metadata >= 0 && verify > metadata && promote > verify && readback > promote && publish > readback)
  assert.ok(steps.every((step) => step['continue-on-error'] !== true))
})

test('an existing candidate can be revalidated without rebuilding or moving its tag', () => {
  const workflow = readWorkflow('release-gui-acceptance.yml')
  assert.deepEqual(Object.keys(workflow.on.workflow_dispatch.inputs).sort(), ['commit', 'tag', 'version'])
  assert.equal(workflow.concurrency['cancel-in-progress'], false)
  const checkoutRef = "${{ github.event_name == 'workflow_dispatch' && github.sha || inputs.commit }}"
  for (const job of Object.values(workflow.jobs)) {
    assert.equal(job.steps[0].with.ref, checkoutRef)
    assert.equal(job.env.CANDIDATE_COMMIT, '${{ inputs.commit }}')
    assert.ok(job.steps.every(step => !/git (?:tag|push)|npm run dist/.test(step.run ?? '')))
  }
  const promotion = workflow.jobs.promote.steps
  const binding = promotion.findIndex(step => step.run === 'node scripts/release-candidate-source.cjs')
  const verify = promotion.findIndex(step => step.run === 'node scripts/verify-public-release.mjs candidate')
  assert.ok(binding >= 0 && binding < verify)
})

test('release verification retains artifact evidence without launching GUI upgrade tests', () => {
  const workflow = readWorkflow('release-gui-acceptance.yml')
  assert.deepEqual(Object.keys(workflow.jobs), ['promote'])
  const steps = workflow.jobs.promote.steps
  assert.ok(steps.every(step => !step.run?.includes('smoke-gui-upgrade.cjs')))
  const upload = steps.find(step => step.uses === 'actions/upload-artifact@v4')
  assert.equal(upload.if, 'always()')
  assert.equal(upload.with.path, 'public-release-evidence/**')
})

test('standalone TUI distribution is removed while cross-platform packaging remains required', () => {
  const workflow = readWorkflow('pr-checks.yml')
  assert.equal(workflow.jobs['gui-upgrade-windows'], undefined)
  assert.ok(workflow.jobs['pr-gate'].needs.includes('package-windows'))
  assert.ok(workflow.jobs['pr-gate'].needs.includes('package-macos'))
  for (const file of ['pr-checks.yml', 'release.yml', 'daily-dev-prerelease.yml']) {
    const current = readWorkflow(file)
    assert.equal(current.jobs['build-tui'], undefined)
    assert.equal(current.jobs['tui-release'], undefined)
    assert.equal(current.jobs['test-windows-self-update'], undefined)
    for (const job of Object.values(current.jobs)) {
      for (const step of job.steps ?? []) {
        assert.doesNotMatch(step.run ?? '', /package:tui|assemble:tui-release|smoke:standalone-tui|upload-tui|--require-tui/)
      }
    }
  }
  const promotion = readWorkflow('release-gui-acceptance.yml').jobs.promote.steps
    .find((step) => step.run?.includes('publish-r2.mjs promote'))
  assert.match(promotion.run, /--require-all-platforms/)
})


test('PR installers retain source provenance for optional manual upgrade verification', () => {
  const workflow = readWorkflow('pr-checks.yml')
  const packaging = workflow.jobs['package-windows'].steps
  const binding = packaging.findIndex(step => step.name === 'Bind PR installer to its tested source')
  const upload = packaging.findIndex(step => step.name === 'Upload Windows PR package')
  assert.ok(binding >= 0 && binding < upload)
  assert.ok(packaging[upload].with.path.includes('dist/pr-candidate-source.json'))
})

test('personal IM PRs retain automatic build, security contracts and native consent checks', () => {
  const workflow = readWorkflow('personal-agent-im-smoke.yml')
  assert.ok(workflow.on.pull_request)
  for (const path of ['src/main/personal-agent-im*', 'src/main/personal-agent-weixin*',
    'src/main/ipc/app-ipc-schemas.personal-im.test.ts',
    'src/renderer/src/components/rooms/RoomImConnectionCard*',
    'scripts/release-workflow-guardrails.test.cjs', '.github/workflows/personal-agent-im-smoke.yml']) {
    assert.ok(workflow.on.pull_request.paths.includes(path), path)
  }
  const job = workflow.jobs['native-card']
  assert.equal(job.if, undefined)
  assert.equal(job['continue-on-error'], undefined)
  assert.equal(job['runs-on'], 'macos-latest')
  for (const step of job.steps) assert.equal(step['continue-on-error'], undefined)
  const build = job.steps.find(step => step.run === 'npm run build')
  const security = stepByName(job, 'Verify IM encryption, authority and consent contracts')
  const ui = stepByName(job, 'Verify native proposals and explicit consent boundary')
  for (const step of [build, security, ui]) { assert.ok(step); assert.equal(step.if, undefined) }
  for (const file of ['personal-agent-im-secrets', 'personal-agent-im-store', 'personal-agent-im-service',
    'personal-agent-weixin-boundary', 'personal-agent-weixin-context']) {
    assert.ok(security.run.includes(`src/main/${file}.test.ts`), file)
  }
  assert.match(security.run, /app-ipc-schemas\.personal-im\.test\.ts/)
  assert.match(security.run, /RoomImConnectionCard\.test\.ts/)
  assert.match(ui.run, /--personal-im-only --evidence dist\/personal-agent-im-smoke$/)
  assert.ok(job.steps.some(step => step.run?.includes('scripts/release-workflow-guardrails.test.cjs')))
  const summary = stepByName(job, 'Record deferred interactive macOS verification')
  assert.equal(summary.if, "always() && !(github.event_name == 'workflow_dispatch' && inputs.real_os_storage)")
  assert.match(summary.run, /NOT RUN; deferred to local interactive validation/)
  assert.match(summary.run, /GITHUB_STEP_SUMMARY/)
  assert.ok(job.steps.some(step => step.uses === 'actions/upload-artifact@v4' && step.if === 'always()'))
})

test('real personal IM OS verification is explicit opt-in and retains failing assertions', () => {
  const workflow = readWorkflow('personal-agent-im-smoke.yml')
  const input = workflow.on.workflow_dispatch.inputs.real_os_storage
  assert.equal(input.type, 'boolean')
  assert.equal(input.default, false)
  const job = workflow.jobs['os-storage']
  assert.equal(job.if, "github.event_name == 'workflow_dispatch' && inputs.real_os_storage")
  assert.equal(job.needs, 'native-card')
  assert.equal(job['continue-on-error'], undefined)
  for (const step of job.steps) assert.equal(step['continue-on-error'], undefined)
  const probe = stepByName(job, 'Probe real OS safeStorage in a separate bounded launch')
  assert.equal(probe.if, undefined)
  assert.equal(probe.run, 'node scripts/smoke-development-direct-chat.cjs --personal-im-storage-only --evidence dist/personal-agent-im-storage')
  const commands = job.steps.map(step => step.run ?? '').join('\n')
  assert.doesNotMatch(commands, /security\s+(?:unlock-keychain|create-keychain|set-keychain|set-key-partition-list)/)
  assert.ok(job.steps.some(step => step.uses === 'actions/upload-artifact@v4' && step.if === 'always()'))
  const source = readFileSync(join(__dirname, 'smoke-personal-agent-im.cjs'), 'utf8')
  for (const proof of ['roundTrip', 'encrypted', 'syncCompatibleEnvelope',
    'legacyRoundTrip', 'legacyBytesUnchanged', 'syncReadable']) {
    assert.ok(source.includes(`assert(storage.${proof})`), proof)
  }
})
