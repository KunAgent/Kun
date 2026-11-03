'use strict'
const assert = require('node:assert/strict')
const path = require('node:path')

function sameOwnedPath(actual, expected, platform = process.platform) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false
  const api = platform === 'win32' ? path.win32 : path.posix
  if (!api.isAbsolute(actual) || !api.isAbsolute(expected)) return false
  const normalize = value => platform === 'win32' ? api.resolve(value).toLowerCase() : api.resolve(value)
  return normalize(actual) === normalize(expected)
}
function sameAutomaticGui(expected, current) {
  return Boolean(current && current.pid === expected.pid && current.createdAt === expected.createdAt &&
    Number.isFinite(Date.parse(current.createdAt)) &&
    sameOwnedPath(current.executablePath, expected.executablePath, 'win32'))
}
function runtimeProbeEndpoint(discovery) {
  if (!discovery || typeof discovery.baseUrl !== 'string' || typeof discovery.runtimeToken !== 'string' || !discovery.runtimeToken) return null
  try {
    const url = new URL(discovery.baseUrl)
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
        url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) return null
    return url.origin
  } catch { return null }
}
async function probeAutomaticRuntime(discovery, expected, fetchApi = fetch) {
  const base = runtimeProbeEndpoint(discovery)
  if (!base || !Number.isSafeInteger(discovery.pid) || discovery.pid <= 0 || discovery.pid === expected.oldRuntimePid ||
      discovery.serviceVersion !== expected.version || typeof discovery.instanceId !== 'string' || !discovery.instanceId ||
      typeof discovery.buildId !== 'string' || !discovery.buildId ||
      !Number.isFinite(Date.parse(discovery.startedAt)) || Date.parse(discovery.startedAt) < Date.parse(expected.guiCreatedAt)) return null
  const options = { headers: { authorization: `Bearer ${discovery.runtimeToken}` }, signal: AbortSignal.timeout(3000), redirect: 'error' }
  try {
    const healthResponse = await fetchApi(`${base}/health`, options)
    if (!healthResponse.ok) return null
    const health = await healthResponse.json()
    if (health.status !== 'ok' || health.service !== 'kun' || health.mode !== 'serve') return null
    const identityResponse = await fetchApi(`${base}/v1/runtime/identity`, options)
    if (!identityResponse.ok) return null
    const identity = await identityResponse.json()
    if (identity.pid !== discovery.pid || identity.instanceId !== discovery.instanceId || identity.buildId !== discovery.buildId ||
        identity.startedAt !== discovery.startedAt || !sameOwnedPath(identity.dataDir, expected.dataDir, 'win32')) return null
    return { pid: identity.pid, instanceId: identity.instanceId, buildId: identity.buildId,
      startedAt: identity.startedAt, serviceVersion: discovery.serviceVersion, identityAuthenticated: true, healthy: true }
  } catch { return null }
}
// A window alone is not startup readiness. Read-only observations must finish
// before the caller can stop the naturally relaunched GUI for later inspection.
async function waitForAutomaticReady(operations) {
  return operations.poll(async () => {
    const current = await operations.readGui()
    assert.ok(sameAutomaticGui(operations.gui, current), 'The automatic GUI exited or its process identity changed before readiness')
    if (current.mainWindowHandle <= 0) return undefined
    const runtime = await operations.readRuntime()
    if (!runtime) return undefined
    let reconciliation
    if (operations.requireFinalized) {
      reconciliation = await operations.readReconciliation()
      if (reconciliation !== 'finalized') return undefined
    }
    // Protect against replacement or early exit while the HTTP/helper checks ran.
    const confirmed = await operations.readGui()
    assert.ok(sameAutomaticGui(operations.gui, confirmed), 'The automatic GUI changed during readiness observation')
    if (confirmed.mainWindowHandle <= 0) return undefined
    return { runtime, reconciliation, observedAt: new Date().toISOString(), beforeHarnessStop: true }
  }, operations.timeout, operations.requireFinalized
    ? 'automatic GUI runtime health and normal pending finalization'
    : 'automatic GUI authenticated runtime health')
}
module.exports = { sameOwnedPath, sameAutomaticGui, runtimeProbeEndpoint, probeAutomaticRuntime, waitForAutomaticReady }
