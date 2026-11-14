import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { locateNpm } from './kun-npm-smoke-process.mjs'
import { preparePublishPlan } from './kun-npm-publish-plan.mjs'
import { publicPackage } from './kun-npm-registry.mjs'

function npmPublish(args) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [locateNpm(process.execPath), ...args], { stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => code === 0 ? done() : reject(Error('npm publication failed: ' + (code ?? signal))))
  })
}

export async function executePublication(context, { confirm, authMode = 'oidc', environment = process.env,
  execute = npmPublish } = {}) {
  assert.equal(context.policy.enabled, true, 'Publication is disabled in the checked-in policy')
  const plan = await preparePublishPlan(context)
  assert.equal(plan.publishable, true, plan.blockers.join('; '))
  assert.equal(confirm, plan.planId, 'Explicit confirmation must match this exact immutable publication plan')
  assert(['oidc', 'interactive-bootstrap'].includes(authMode), 'Unsupported publication authentication mode')
  if (authMode === 'oidc') {
    assert.equal(context.policy.trustedPublisherConfigured, true, 'Configure existing packages for trusted publishing first')
    assert.equal(environment.GITHUB_ACTIONS, 'true', 'OIDC publication requires the configured GitHub workflow')
    assert.equal(environment.GITHUB_REPOSITORY, context.policy.repository)
    assert.equal(environment.GITHUB_REF, context.policy.releaseRef)
    assert.equal(environment.GITHUB_WORKFLOW_REF,
      context.policy.repository + '/.github/workflows/' + context.policy.workflow + '@' + context.policy.releaseRef)
    assert(!environment.NODE_AUTH_TOKEN && !environment.NPM_TOKEN, 'OIDC job must not use a token fallback')
  } else assert.notEqual(environment.GITHUB_ACTIONS, 'true', 'Bootstrap must use a maintainer interactive session, not a CI token fallback')
  const report = { schemaVersion: 1, kind: 'kun-npm-publication-receipt', planId: plan.planId,
    registryReady: false, published: false, distTagsChanged: false, state: 'running', operations: [], attempts: [] }
  const metadata = context.metadata ?? publicPackage
  try {
    for (const operation of plan.operations) {
      if (operation.action === 'publish-prerelease') {
        report.attempts.push({ name: operation.name, version: operation.version })
        // An npm/network failure can happen after the registry has stored bytes.
        // Preserve uncertainty instead of claiming that a failed request wrote nothing.
        report.published = report.published || null
        report.distTagsChanged = report.distTagsChanged || null
        await execute([...operation.arguments, ...(authMode === 'oidc' ? ['--provenance'] : [])])
        report.published = true
        report.distTagsChanged = true // A successful publish changes the explicit prerelease tag.
      }
      const remote = await metadata(operation.name)
      assert.equal(remote.versions[operation.version]?.dist?.integrity, operation.integrity, 'Registry bytes do not match the original candidate')
      assert.equal(remote.distTags.latest ?? null, operation.observedStableTag, 'Stable tag changed; stop without automatic repair')
      assert.equal(remote.distTags[plan.tag], operation.version)
      report.operations.push({ name: operation.name, version: operation.version,
        action: operation.action, integrity: operation.integrity, stableTagUnchanged: true })
    }
    report.state = 'prerelease-present-awaiting-registry-matrix'
    report.success = true
  } catch (error) {
    report.success = false
    report.state = report.published ? 'partial-publication' : 'publication-outcome-unknown'
    report.error = error.message
  }
  return report
}
