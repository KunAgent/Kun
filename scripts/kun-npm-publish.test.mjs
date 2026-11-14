import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { auditNamespace } from './lib/kun-npm-registry.mjs'
import { preparePublishPlan, isPrerelease } from './lib/kun-npm-publish-plan.mjs'
import { executePublication } from './lib/kun-npm-publisher.mjs'
import { parsePublishArguments } from './prepare-kun-npm-publish.mjs'
import { publishFixture } from './fixtures/kun-npm/publish-candidate.mjs'

async function fixture(operation, version) {
  const root = await mkdtemp(join(tmpdir(), 'kun-publication-test-'))
  try { await operation(await publishFixture(root, version)) }
  finally { await rm(root, { recursive: true, force: true }) }
}
const oidc = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'fixture/project', GITHUB_REF: 'refs/heads/master',
  GITHUB_WORKFLOW_REF: 'fixture/project/.github/workflows/kun-npm-publish.yml@refs/heads/master' }
function simulate(context, calls, failMain = false) {
  return async args => {
    assert.equal(args[0], 'publish')
    assert(args.includes('--tag=next') && args.includes('--ignore-scripts') && args.includes('--access=public'))
    assert(!args.some(arg => arg.includes('latest') || arg === 'dist-tag'))
    const name = args[1].endsWith('windows.tgz') ? context.release.windowsPackage : context.release.name
    calls.push(name)
    if (failMain && name === context.release.name) throw Error('simulated main request failure')
    const manifest = JSON.parse(await readFile(join(context.directory, 'manifest.json'), 'utf8'))
    const artifact = name === context.release.name ? manifest.artifact : manifest.platformArtifacts[0]
    const state = context.state.get(name)
    state.versions[artifact.version] = { dist: { integrity: artifact.integrity } }
    state.distTags.next = artifact.version
  }
}

test('a public org owner list and public 404 cannot authenticate the caller', async () => {
  const result = await auditNamespace({ name: '@kun/agent', windowsPackage: '@kun/agent-win32-x64' }, {
    read: async args => args[0] === 'whoami'
      ? { code: 1, errorCode: 'ENEEDAUTH', value: null } : { code: 0, value: { kun: 'owner' } },
    metadata: async name => ({ name, status: 'not-publicly-visible', httpStatus: 404, distTags: {}, versions: {} })
  })
  assert.equal(result.identity.authenticated, false)
  assert.equal(result.rightsVerified, false)
  assert.deepEqual(result.scope.publicOwnerNames, ['kun'])
  assert(result.packages.every(pkg => pkg.accountPublishAuthorityVerified === false))
})

test('authenticated scope owner authority and read-only package access are distinguished', async () => {
  const result = await auditNamespace({ name: '@fixture/agent', windowsPackage: '@fixture/agent-win32-x64' }, {
    read: async args => args[0] === 'whoami' ? { code: 0, value: 'fixture-owner' }
      : args[0] === 'org' ? { code: 0, value: { 'fixture-owner': 'owner' } }
        : { code: 0, value: { [args.at(-1)]: 'read-only' } },
    metadata: async name => ({ name, status: name.endsWith('x64') ? 'not-publicly-visible' : 'public',
      httpStatus: 200, maintainers: ['different-owner'], distTags: {}, versions: {} })
  })
  assert.equal(result.scope.creationAuthorityVerified, true)
  assert.equal(result.packages[0].accountPublishAuthorityVerified, false)
  assert.equal(result.packages[1].accountPublishAuthorityVerified, true)
  assert.equal(result.rightsVerified, false)
})

test('stable versions and invalid prerelease identifiers cannot enter the prerelease flow', async () => {
  for (const version of ['0.4.5', '1.2.3-01', '1.2.3-rc..1', '01.2.3-rc.1']) assert(!isPrerelease(version))
  assert(isPrerelease('0.4.6-rc.1'))
  await fixture(async context => {
    const plan = await preparePublishPlan(context)
    assert.equal(plan.publishable, false)
    assert(plan.blockers.some(message => message.includes('not a SemVer prerelease')))
  }, '0.4.5')
})

test('default preparation verifies bytes and ordered operations without executing publication', async () => {
  await fixture(async context => {
    context.policy.enabled = false
    const plan = await preparePublishPlan(context)
    assert.equal(plan.prepared, true)
    assert.equal(plan.publishable, false)
    assert.equal(plan.published, false)
    assert.equal(plan.distTagsChanged, false)
    assert.deepEqual(plan.operations.map(operation => operation.name), [context.release.windowsPackage, context.release.name])
    let writes = 0
    await assert.rejects(executePublication(context, { confirm: plan.planId, environment: oidc,
      execute: async () => { writes++ } }), /disabled/)
    assert.equal(writes, 0)
  })
})

test('stale or mismatched maintainer evidence blocks publication', async () => {
  await fixture(async context => {
    context.audit.checkedAt = '2020-01-01T00:00:00Z'
    context.audit.identity.username = 'another-user'
    const plan = await preparePublishPlan(context)
    assert(!plan.publishable)
    assert(plan.blockers.some(message => message.includes('stale')))
    assert(plan.blockers.some(message => message.includes('identity')))
  })
})

test('confirming a new namespace cannot relabel or publish an old accepted candidate', async () => {
  await fixture(async context => {
    context.release.name = '@new-scope/agent'
    context.release.windowsPackage = '@new-scope/agent-win32-x64'
    context.audit.packages = [context.release.name, context.release.windowsPackage]
      .map(name => ({ name, accountPublishAuthorityVerified: true }))
    const plan = await preparePublishPlan(context)
    assert.equal(plan.gateAVerified, true)
    assert.equal(plan.publishable, false)
    assert(plan.blockers.some(message => message.includes('confirmed namespace')))
    assert(plan.operations.every(operation => operation.action === 'requires-new-candidate' && operation.arguments.length === 0))
    let writes = 0
    await assert.rejects(executePublication(context, { confirm: plan.planId, environment: oidc,
      execute: async () => { writes++ } }))
    assert.equal(writes, 0)
  })
})

test('modified tarballs, replaced Gate A evidence and missing native slots fail preflight', async () => {
  await fixture(async context => {
    const path = join(context.directory, 'main.tgz')
    const original = await readFile(path)
    await writeFile(path, 'different bytes')
    await assert.rejects(preparePublishPlan(context), /bytes changed/)
    await writeFile(path, original)
    const proof = await readFile(context.gateA)
    await writeFile(context.gateA, '{}')
    await assert.rejects(preparePublishPlan(context), /Gate A approval receipt/)
    await writeFile(context.gateA, proof)
    await rm(join(context.receipts, 'win32-x64-26.12.0.json'))
    await assert.rejects(preparePublishPlan(context), /Every platform\/Node receipt/)
  })
})

test('existing different bytes or a mismatched prerelease tag fail before any write', async () => {
  await fixture(async context => {
    const name = context.release.windowsPackage, state = context.state.get(name), version = context.policy.acceptedCandidate.version
    state.versions[version] = { dist: { integrity: 'sha512-wrong' } }
    await assert.rejects(preparePublishPlan(context), /different bytes/)
    const manifest = JSON.parse(await readFile(join(context.directory, 'manifest.json')))
    state.versions[version].dist.integrity = manifest.platformArtifacts[0].integrity
    await assert.rejects(preparePublishPlan(context), /tag drift/)
  })
})

test('partial failure preserves the platform and retry skips identical original bytes', async () => {
  await fixture(async context => {
    const calls = [], plan = await preparePublishPlan(context)
    const partial = await executePublication(context, { confirm: plan.planId, environment: oidc,
      execute: simulate(context, calls, true) })
    assert.equal(partial.success, false)
    assert.equal(partial.state, 'partial-publication')
    assert.equal(partial.registryReady, false)
    assert.deepEqual(calls, [context.release.windowsPackage, context.release.name])
    calls.length = 0
    const retried = await executePublication(context, { confirm: plan.planId, environment: oidc,
      execute: simulate(context, calls) })
    assert.equal(retried.success, true)
    assert.deepEqual(calls, [context.release.name])
    for (const remote of context.state.values()) assert.equal(remote.distTags.latest, '0.4.0')
  })
})

test('an ambiguous first publish failure never claims no registry changes occurred', async () => {
  await fixture(async context => {
    const plan = await preparePublishPlan(context)
    const report = await executePublication(context, { confirm: plan.planId, environment: oidc,
      execute: async () => { throw Error('simulated response lost') } })
    assert.equal(report.published, null)
    assert.equal(report.distTagsChanged, null)
    assert.equal(report.state, 'publication-outcome-unknown')
  })
})

test('wrong plan confirmation, workflow identity and token fallback cannot execute writes', async () => {
  await fixture(async context => {
    const plan = await preparePublishPlan(context)
    let writes = 0
    for (const options of [{ confirm: 'wrong', environment: oidc },
      { confirm: plan.planId, environment: { ...oidc, GITHUB_REF: 'refs/heads/feature' } },
      { confirm: plan.planId, environment: { ...oidc, NODE_AUTH_TOKEN: 'dummy-fixture' } }]) {
      await assert.rejects(executePublication(context, { ...options, execute: async () => { writes++ } }))
    }
    assert.equal(writes, 0)
  })
})

test('CLI defaults to preparation and requires explicit confirmation for execution', () => {
  const args = ['--candidate', 'candidate', '--gate-a', 'gate.json', '--receipts', 'receipts', '--output', 'out.json']
  assert.equal(parsePublishArguments(args).execute, false)
  assert.throws(() => parsePublishArguments([...args, '--execute']))
  assert.throws(() => parsePublishArguments([...args, '--tag', 'latest']))
})
