import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { registryInstallArguments, verifyProjectResolution, verifyRegistryArtifacts } from './lib/kun-npm-registry-install.mjs'
import { checkRegistryMatrix } from './check-kun-npm-registry.mjs'
const require = createRequire(import.meta.url)
const { parse } = require('yaml')
const { minimatch } = require('minimatch')

const artifact = name => {
  const bytes = Buffer.from(name)
  return { name, version: '0.4.5-rc.1', sha256: createHash('sha256').update(bytes).digest('hex'),
    integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64') }
}
const main = artifact('@kunagent/agent'), windows = artifact('@kunagent/agent-win32-x64')
const candidate = { artifact: main, platformArtifacts: [windows], sourceCommit: 'a'.repeat(40), sourceDirty: false }
const accepted = { name: main.name, version: main.version, sha256: main.sha256,
  windowsPackage: windows.name, windowsSha256: windows.sha256, sourceCommit: candidate.sourceCommit, buildId: 'b'.repeat(64) }
const release = { name: main.name, version: main.version, targets: ['linux-x64'], testNodeVersions: ['26.4.0'] }
const tarballUrl = name => 'https://registry.npmjs.org/' + name + '/-/fixture-0.4.5-rc.1.tgz'
function registryResponse(url) {
  const expected = [windows, main].find(item => url === 'https://registry.npmjs.org/' + encodeURIComponent(item.name))
  if (expected) return { ok: true, json: async () => ({ name: expected.name, 'dist-tags': { next: expected.version },
    versions: { [expected.version]: { dist: { tarball: tarballUrl(expected.name), integrity: expected.integrity } } } }) }
  const item = [windows, main].find(value => url === tarballUrl(value.name))
  assert(item, url)
  return { ok: true, arrayBuffer: async () => Buffer.from(item.name) }
}

test('registry installer accepts only exact versions and uses isolated online npm caches', () => {
  const options = { expectedName: main.name, expectedVersion: main.version, prefix: '/fresh/prefix', cache: '/fresh/cache', global: true }
  const args = registryInstallArguments({ ...options, reference: main.name + '@' + main.version })
  assert(args.includes('--global') && args.includes('/fresh/cache') && !args.includes('--offline'))
  assert.equal(args.at(-1), main.name + '@' + main.version)
  for (const reference of [main.name + '@next', main.name + '@latest', './candidate.tgz'])
    assert.throws(() => registryInstallArguments({ ...options, reference }), /exact accepted version/)
  const lock = { packages: { ['node_modules/' + main.name]: { integrity: main.integrity, resolved: tarballUrl(main.name) } } }
  verifyProjectResolution(lock, main.name, main.integrity, tarballUrl(main.name))
  lock.packages['node_modules/' + main.name].resolved = 'file:./candidate.tgz'
  assert.throws(() => verifyProjectResolution(lock, main.name, main.integrity, tarballUrl(main.name)), /not a local file/)
})

test('public metadata and downloaded bytes must match both original candidate artifacts', async () => {
  const proof = await verifyRegistryArtifacts(candidate, async url => registryResponse(url))
  assert.deepEqual(proof.map(item => item.name), [windows.name, main.name])
  for (const change of ['tags', 'integrity', 'tarball', 'bytes']) {
    await assert.rejects(verifyRegistryArtifacts(candidate, async url => {
      const response = registryResponse(url)
      if (response.json) {
        const value = await response.json()
        if (change === 'tags') value['dist-tags'].latest = main.version
        if (change === 'integrity') value.versions[main.version].dist.integrity = 'sha512-wrong'
        if (change === 'tarball') value.versions[main.version].dist.tarball = 'https://example.com/untrusted.tgz'
        response.json = async () => value
      } else if (change === 'bytes') response.arrayBuffer = async () => Buffer.from('changed')
      return response
    }))
  }
})

test('an explicitly acknowledged initial latest is verified as a baseline, not reported as unchanged', async () => {
  const stableTags = { [main.name]: main.version, [windows.name]: windows.version }
  const fetchWithInitialLatest = async url => {
    const response = registryResponse(url)
    if (response.json) {
      const value = await response.json(); value['dist-tags'].latest = main.version
      response.json = async () => value
    }
    return response
  }
  await assert.rejects(verifyRegistryArtifacts(candidate, fetchWithInitialLatest), /Stable tag changed/)
  assert.equal((await verifyRegistryArtifacts(candidate, fetchWithInitialLatest, stableTags)).length, 2)
  const placeholderTags = { ...stableTags, [main.name]: '0.0.0-stage' }
  const fetchWithPlaceholder = async url => {
    const response = await fetchWithInitialLatest(url)
    if (response.json && url.endsWith(encodeURIComponent(main.name))) {
      const value = await response.json(); value['dist-tags'].latest = '0.0.0-stage'
      response.json = async () => value
    }
    return response
  }
  assert.equal((await verifyRegistryArtifacts(candidate, fetchWithPlaceholder, placeholderTags)).length, 2)
  await assert.rejects(verifyRegistryArtifacts(candidate, fetchWithPlaceholder, stableTags), /Stable tag changed/)
})

test('registry matrix refuses local-install receipts, missing combinations, changed builds and absent helper fetches', async () => {
  const proof = await verifyRegistryArtifacts(candidate, async url => registryResponse(url))
  // Deliberately incomplete smoke: these assertions exercise additional registry requirements independently.
  const base = { schemaVersion: 1, kind: 'kun-npm-registry-install-receipt', success: true, platform: 'linux', arch: 'x64',
    nodeVersion: '26.4.0', packageName: main.name, packageVersion: main.version, tarballSha256: main.sha256,
    sourceCommit: accepted.sourceCommit, sourceDirty: false, buildId: accepted.buildId,
    isolation: { sourceCheckoutRemoved: true, gitHistoryAvailable: false, exportedDriverVerified: true },
    registry: { reference: main.name + '@' + main.version, installSource: 'registry-exact-version', artifacts: proof },
    checks: ['project', 'global'].map(kind => ({ id: `REG-03.${kind}-registry-install`, status: 'pass', detail: {
      exitCode: 0, freshCache: true, resolvedFromRegistry: true, command: registryInstallArguments({
        reference: main.name + '@' + main.version, expectedName: main.name, expectedVersion: main.version, cache: '/fresh' }),
      downloads: proof.filter(item => item.name === main.name),
      httpFetches: ['npm http fetch GET 200 ' + tarballUrl(main.name) + ' 100ms (cache miss)'] } })) }
  const check = receipt => checkRegistryMatrix([receipt], release, candidate, accepted).errors
  assert(!check(base).some(error => /registry|installed build|Registry|npm did/.test(error)))
  assert(check({ ...base, kind: 'kun-npm-native-install-receipt' }).some(error => /Not an exact registry/.test(error)))
  assert(check({ ...base, buildId: 'changed' }).some(error => /Wrong installed build/.test(error)))
  assert(checkRegistryMatrix([base], release, candidate, accepted, { expectedDriverCommit: accepted.sourceCommit }).errors
    .some(error => /selected matrix test driver/.test(error)))
  assert(check({ ...base, platform: 'win32' }).some(error => /npm did not fetch.*win32/.test(error)))
  assert(checkRegistryMatrix([], release, candidate, accepted).errors.some(error => /Missing target/.test(error)))
})

test('registry workflow runs ten read-only native jobs with every exported driver and no source access', async () => {
  const workflow = parse(await readFile('.github/workflows/kun-npm-artifact.yml', 'utf8'))
  const job = workflow.jobs['registry-install']
  assert.equal(job.strategy.matrix.node.length * job.strategy.matrix.target.length, 10)
  assert.deepEqual(job.strategy.matrix.node, ['26.4.0', '26.12.0'])
  assert.deepEqual(workflow.permissions, { contents: 'read', actions: 'read' })
  const patterns = job.steps.find(step => step.uses?.startsWith('actions/checkout')).with['sparse-checkout'].trim().split('\n')
  const { DRIVER_FILES } = await import('./export-kun-npm-test-driver.mjs')
  for (const name of DRIVER_FILES) assert(patterns.some(pattern => minimatch('/' + name, pattern)), name)
  const runs = job.steps.map(step => step.run ?? '').join('\n')
  assert(runs.includes('rmSync("drivers-checkout"'))
  assert(!/npm (?:publish|dist-tag|ci|install|pack)|npm run build/.test(runs))
  assert.equal(job.env.KUN_NPM_REGISTRY_ACCEPTANCE, 'true')
  assert(job.if.includes("inputs.registry_receipts_run_id == ''"))
  const evidence = workflow.jobs['registry-evidence']
  const download = evidence.steps.find(step => step.with?.['artifact-ids'])
  assert(download && !download.with.pattern)
  assert(evidence.steps.some(step => step.uses === 'actions/github-script@v7'))
  for (const name of ['windows-payload', 'candidate', 'install', 'evidence', 'windows-terminal-probe', 'build-validation', 'desktop-data'])
    assert(workflow.jobs[name].if.includes('!inputs.registry_only'), name)
})
