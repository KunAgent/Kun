import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { parse } = require('yaml')

test('publication requires explicit dispatch and the authenticated publisher alone gets OIDC', async () => {
  const text = await readFile('.github/workflows/kun-npm-publish.yml', 'utf8')
  const workflow = parse(text)
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch'])
  assert.equal(workflow.on.workflow_dispatch.inputs.execute_publish.default, false)
  assert.equal(workflow.permissions.contents, 'read')
  assert.equal(workflow.permissions.actions, 'read')
  assert(!workflow.permissions['id-token'])
  const prepare = workflow.jobs.prepare, publisher = workflow.jobs.publisher
  assert.equal(publisher.permissions['id-token'], 'write')
  for (const fragment of ['inputs.execute_publish', 'KUN_NPM_PUBLISH_ENABLED', 'needs.prepare.outputs.publishable',
    "github.repository == 'KunAgent/Kun'", "github.ref == 'refs/heads/master'"]) assert(publisher.if.includes(fragment))
  const policy = JSON.parse(await readFile('kun/npm/publish.json', 'utf8'))
  assert.equal(publisher.environment, policy.environment)
  assert.equal(policy.workflow, 'kun-npm-publish.yml')
  assert.equal(policy.releaseRef, 'refs/heads/master')
  assert.equal(typeof policy.enabled, 'boolean')
  assert(/^[a-f0-9]{64}$/.test(policy.acceptedCandidate.gateAReceiptSha256))
  const prepareRuns = prepare.steps.map(step => step.run ?? '').join('\n')
  assert(!prepareRuns.includes('--execute'))
  assert(!/npm\s+(?:publish|stage|dist-tag)|pack:kun:npm|npm run build/.test(prepareRuns))
  assert(!/secrets\.(?:NPM_TOKEN|NODE_AUTH_TOKEN)/.test(text))
  assert(!text.includes('dist-tag add') && !text.includes('dist-tag rm'))
  assert.equal(workflow.concurrency['cancel-in-progress'], false)
  assert(prepare.steps.some(step => step.with?.['retention-days'] === 90))
})

test('publisher checkout includes all minimal modules and never installs or rebuilds candidate code', async () => {
  const workflow = parse(await readFile('.github/workflows/kun-npm-publish.yml', 'utf8'))
  const publisher = workflow.jobs.publisher
  const checkout = publisher.steps.find(step => step.uses?.startsWith('actions/checkout'))
  assert.equal(checkout.with['sparse-checkout-cone-mode'], false)
  const files = checkout.with['sparse-checkout'].trim().split('\n').map(name => name.replace(/^\//, ''))
  for (const path of ['scripts/prepare-kun-npm-publish.mjs', 'scripts/lib/kun-npm-release-artifacts.mjs',
    'scripts/lib/kun-npm-publish-plan.mjs', 'scripts/lib/kun-npm-publisher.mjs',
    'scripts/lib/kun-npm-registry.mjs', 'scripts/lib/kun-npm-smoke-process.mjs',
    'kun/npm/publish.json', 'kun/npm/release.json']) assert(files.includes(path), path)
  const runs = publisher.steps.map(step => step.run ?? '').join('\n')
  assert(!/npm (?:ci|install|pack|run build)/.test(runs))
  assert(runs.includes('--execute --auth-mode oidc'))
  assert(runs.includes('--confirm "$CONFIRMED_PLAN_ID"'))
})
