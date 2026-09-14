import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startClientOwnedRuntime } from '../kun/dist/cli/client-owned-runtime.js'
import { resolveServiceManager } from '../kun/dist/manager/manager-client.js'
import { readManagerDiscovery } from '../kun/dist/manager/manager-discovery.js'
import { createOwnedServiceManagerSession } from '../kun/dist/manager/owned-service-manager-session.js'
import { shutdownOwnedProcesses } from '../kun/dist/process/owned-process.js'
import { KunTuiClient } from '../kun/dist/tui/client.js'

// Keep the historical command name, but exercise the application-owned
// contract: independent profiles may coexist; flavors cannot share one owner.
const root = await realpath(await mkdtemp(join(tmpdir(), 'kun-isolated-stacks-smoke-')))
const stacks = []
const sessions = []
const profile = (name) => ({
  dataDir: join(root, name, 'data'),
  controlDir: join(root, name, 'control'),
  settingsPath: join(root, name, 'settings.json')
})
const productionProfile = profile('production')
const developmentProfile = profile('development')

async function startStack(paths, flavor) {
  const session = createOwnedServiceManagerSession({ ownerKind: 'cli' })
  sessions.push(session)
  const manager = await session.ensure({ ...paths, flavor, timeoutMs: 20_000 })
  const stack = { paths, flavor, session, manager }
  stacks.push(stack)
  stack.runtime = await startClientOwnedRuntime({
    ...paths, manager, runtimeFlavor: flavor, ownerKind: 'tui', timeoutMs: 20_000
  })
  const discovery = stack.runtime.connection.discovery
  stack.client = new KunTuiClient({ baseUrl: discovery.baseUrl, runtimeToken: discovery.runtimeToken })
  return stack
}

async function stopStack(stack) {
  const runtime = stack.runtime?.connection.discovery
  if (stack.runtime) await stack.runtime.stop()
  if (runtime) assert.equal(processAlive(runtime.pid), false, 'Runtime PID survived owned stop')
  await stack.session.close({ deadline: Date.now() + 10_000 })
  assert.equal(processAlive(stack.manager.discovery.pid), false, 'Manager PID survived session close')
  assert.equal(await readManagerDiscovery(stack.paths.controlDir), null, 'Manager discovery survived close')
  if (runtime) await assertPortReleased(runtime.port)
  await assertPortReleased(Number(new URL(stack.manager.discovery.baseUrl).port))
}

try {
  const production = await startStack(productionProfile, 'production')
  const development = await startStack(developmentProfile, 'development')
  const originalDevelopment = {
    managerPid: development.manager.discovery.pid,
    managerInstanceId: development.manager.discovery.instanceId,
    runtimePid: development.runtime.connection.discovery.pid,
    runtimeInstanceId: development.runtime.instanceId
  }
  assert.notEqual(production.manager.discovery.pid, originalDevelopment.managerPid)
  assert.notEqual(production.runtime.connection.discovery.pid, originalDevelopment.runtimePid)

  const contender = createOwnedServiceManagerSession({ ownerKind: 'cli' })
  sessions.push(contender)
  await assert.rejects(() => contender.ensure({
    ...productionProfile,
    controlDir: join(root, 'conflicting-development-control'),
    flavor: 'development'
  }), /application|session|owned|owner|profile/iu)
  await contender.close()

  const thread = await production.client.createThread({
    title: 'application-lifetime-smoke', workspace: root, model: 'deepseek-v4-flash'
  })
  assert.equal((await development.client.listThreads()).some((item) => item.id === thread.id), false,
    'Isolated profile unexpectedly read another profile thread')

  const oldProduction = {
    managerPid: production.manager.discovery.pid,
    runtimePid: production.runtime.connection.discovery.pid
  }
  await stopStack(production)
  const developmentManager = await resolveServiceManager(developmentProfile.controlDir)
  assert.equal(developmentManager?.discovery.pid, originalDevelopment.managerPid)
  assert.equal(developmentManager?.discovery.instanceId, originalDevelopment.managerInstanceId)
  assert.equal(processAlive(originalDevelopment.runtimePid), true)
  await development.client.listThreads()

  const reopened = await startStack(productionProfile, 'production')
  assert.notEqual(reopened.manager.discovery.pid, oldProduction.managerPid)
  assert.notEqual(reopened.runtime.connection.discovery.pid, oldProduction.runtimePid)
  assert.equal((await reopened.client.listThreads()).some((item) => item.id === thread.id), true,
    'Reopening did not preserve the original profile history')
  await stopStack(reopened)
  await stopStack(development)
  process.stdout.write(`${JSON.stringify({
    isolatedProfiles: true,
    sameDataAcrossFlavorsRejected: true,
    stoppedRuntimeAndManager: oldProduction,
    otherProfileUnchanged: originalDevelopment,
    reopenedHistoryThreadId: thread.id,
    allOwnedServicePortsReleased: true
  }, null, 2)}\n`)
} catch (error) {
  for (const paths of [productionProfile, developmentProfile]) {
    for (const path of [join(paths.controlDir, 'manager.log'), join(paths.dataDir, 'logs', 'runtime.log')]) {
      const text = await readFile(path, 'utf8').catch(() => '')
      if (text) process.stderr.write(`\n[${path}]\n${text.slice(-8_000)}\n`)
    }
  }
  throw error
} finally {
  await Promise.allSettled(stacks.map((stack) => stack.runtime?.stop()))
  await Promise.allSettled(sessions.map((session) => session.close({ deadline: Date.now() + 10_000 })))
  await shutdownOwnedProcesses({ graceMs: 0, timeoutMs: 5_000 })
  await rm(root, { recursive: true, force: true })
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}

async function assertPortReleased(port) {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}
