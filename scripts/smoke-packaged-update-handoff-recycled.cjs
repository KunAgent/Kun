'use strict'

const { join } = require('node:path')
const {
  availablePort
} = require('./smoke-packaged-extension-desktop-process.cjs')
const {
  childState,
  launchPredecessorOwners,
  poll,
  preparePredecessorRuntime,
  processIsAlive,
  spawnTracked,
  startModelFixture,
  waitForJson,
  waitForProcessExit
} = require('./smoke-packaged-update-handoff-support.cjs')

async function runRecycledPidScenario(input, deps) {
  const root = await deps.createProfileRoot(`kun-packaged-handoff-${input.scenario}-`)
  const modelFixture = await startModelFixture()
  const tracked = []
  let primaryError
  let cleanupErrors = []
  try {
    const profile = await deps.initializeProfile(root, modelFixture.baseUrl, true)
    const predecessor = await preparePredecessorRuntime({
      resourcesDir: input.resourcesDir,
      oldResourcesDir: input.oldResourcesDir,
      temporaryRoot: root.temporaryRoot
    })
    const owners = await launchPredecessorOwners({
      runtimeExecutable: input.candidateRuntimeExecutable,
      kunRoot: predecessor.kunRoot,
      buildId: predecessor.buildId,
      environment: profile.environment,
      controlDir: profile.controlDir,
      dataDir: profile.dataDir,
      settingsPath: profile.settingsPath,
      workspaceRoot: profile.workspaceRoot,
      productionPort: profile.productionPort,
      developmentPort: profile.developmentPort,
      baseUrl: modelFixture.baseUrl,
      timeoutMs: input.timeoutMs,
      onSpawn: (process) => tracked.push(process)
    })
    await stopPredecessorRuntimes(owners, input.timeoutMs)

    const helper = spawnTracked(process.execPath, [
      join(__dirname, 'fixtures', 'update-handoff-owner.cjs'),
      // This is an unrelated process that deliberately reuses the old PID.
      // Do not advertise the Runtime's real --data-dir flag in its command;
      // legacy ownership inventory correctly treats that flag as an owner.
      '--fixture-data-dir', profile.dataDir,
      '--scenario', 'pid-port-reuse',
      '--build-id', predecessor.buildId
    ], { cwd: profile.workspaceRoot, env: profile.environment })
    tracked.push(helper)
    const staleOwner = await Promise.race([
      waitForJson(
        join(profile.dataDir, 'runtime.json'),
        (value) => value?.pid === helper.child.pid,
        input.timeoutMs,
        () => childState(helper.child, helper.output())
      ),
      deps.desktopExitGuard(helper.child)
    ])
    await registerManagerRuntimeSlot(owners.manager.discovery, staleOwner)

    const debuggingPort = await availablePort()
    const candidateDesktop = deps.launchCandidate(input.desktop, profile, {
      debuggingPort,
      timeoutMs: input.timeoutMs
    })
    tracked.push(candidateDesktop)
    const current = await deps.waitForCurrentOwners({
      profile,
      candidateBuildId: input.candidateBuildId,
      autoStart: true,
      oldOwners: owners,
      desktop: candidateDesktop,
      timeoutMs: input.timeoutMs
    })

    if (!processIsAlive(staleOwner.pid)) {
      throw new Error(`Candidate terminated recycled helper PID ${staleOwner.pid}`)
    }
    if (current.runtime?.instanceId === staleOwner.instanceId) {
      throw new Error('Candidate preserved the recycled helper discovery as the current Runtime')
    }
    const status = await managerJson(current.manager, '/v1/manager/status')
    const staleSlot = status.slots?.some((slot) =>
      (slot.registration ?? slot).instanceId === staleOwner.instanceId
    )
    if (staleSlot) throw new Error('Candidate left the recycled helper Manager slot registered')
    const output = candidateDesktop.output()
    if (output.includes('runtime_stop_failed') && output.includes(String(staleOwner.pid))) {
      throw new Error('Candidate logged a Runtime stop failure for the recycled helper PID')
    }
    await deps.assertChatRoundTrip(current.runtime, profile.workspaceRoot, input.timeoutMs)

    await deps.quitDesktopNormally(candidateDesktop, debuggingPort, input.timeoutMs)
    tracked.splice(tracked.indexOf(candidateDesktop), 1)
    await stopCurrentOwners(current, input.timeoutMs)
    if (!processIsAlive(staleOwner.pid)) {
      throw new Error(`Normal candidate shutdown terminated recycled helper PID ${staleOwner.pid}`)
    }
  } catch (error) {
    primaryError = error
  } finally {
    await modelFixture.close().catch(() => undefined)
    cleanupErrors = await deps.cleanupTracked(tracked)
    await deps.cleanupProfile(root).catch((error) => cleanupErrors.push(error.message ?? String(error)))
  }
  if (primaryError) {
    const detail = tracked.map((entry) => entry.output?.() ?? '').filter(Boolean).join('\n')
    throw new Error(`${primaryError.stack ?? primaryError}${detail ? `\nProcess output:\n${detail}` : ''}`)
  }
  if (cleanupErrors.length > 0) {
    throw new Error(`Recycled PID handoff cleanup failed: ${cleanupErrors.join('; ')}`)
  }
}

async function stopPredecessorRuntimes(owners, timeoutMs) {
  for (const owner of owners.runtimes) {
    const response = await fetch(`${owner.discovery.baseUrl}/v1/runtime/shutdown`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${owner.discovery.runtimeToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ instanceId: owner.discovery.instanceId }),
      signal: AbortSignal.timeout(10_000)
    })
    if (!response.ok) {
      throw new Error(`Predecessor ${owner.flavor} Runtime rejected smoke setup shutdown`)
    }
    if (!await waitForProcessExit(owner.discovery.pid, Math.min(timeoutMs, 20_000))) {
      throw new Error(`Predecessor ${owner.flavor} Runtime did not exit during smoke setup`)
    }
  }
  await poll(async () => {
    const status = await managerJson(owners.manager.discovery, '/v1/manager/status')
    return status.slots?.length === 0
  }, timeoutMs, 'predecessor Runtime slots to unregister before PID reuse setup')
}

async function registerManagerRuntimeSlot(manager, staleOwner) {
  const response = await fetch(`${manager.baseUrl}/v1/runtimes/production/register`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${manager.managerToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      flavor: 'production',
      instanceId: staleOwner.instanceId,
      pid: staleOwner.pid,
      startedAt: staleOwner.startedAt,
      host: staleOwner.host,
      port: staleOwner.port,
      baseUrl: staleOwner.baseUrl,
      runtimeToken: staleOwner.runtimeToken,
      ...(staleOwner.buildId ? { buildId: staleOwner.buildId } : {})
    }),
    signal: AbortSignal.timeout(10_000)
  })
  const body = await response.text()
  if (!response.ok) {
    throw new Error(`Manager rejected recycled PID slot setup (${response.status}): ${body}`)
  }
}

async function managerJson(discovery, path) {
  const response = await fetch(`${discovery.baseUrl}${path}`, {
    headers: { authorization: `Bearer ${discovery.managerToken}` },
    signal: AbortSignal.timeout(10_000)
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`GET ${path} failed (${response.status}): ${body}`)
  return body ? JSON.parse(body) : undefined
}

async function stopCurrentOwners(current, timeoutMs) {
  if (current.runtime) {
    await fetch(`${current.runtime.baseUrl}/v1/runtime/shutdown`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${current.runtime.runtimeToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ instanceId: current.runtime.instanceId }),
      signal: AbortSignal.timeout(10_000)
    }).catch(() => undefined)
    if (!await waitForProcessExit(current.runtime.pid, Math.min(timeoutMs, 20_000))) {
      throw new Error(`Current Runtime PID ${current.runtime.pid} did not stop through its authenticated API`)
    }
  }
  await fetch(`${current.manager.baseUrl}/v1/manager/shutdown`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${current.manager.managerToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ instanceId: current.manager.instanceId }),
    signal: AbortSignal.timeout(10_000)
  }).catch(() => undefined)
  if (!await waitForProcessExit(current.manager.pid, Math.min(timeoutMs, 20_000))) {
    throw new Error(`Current Manager PID ${current.manager.pid} did not stop through its authenticated API`)
  }
}

module.exports = {
  managerJson,
  runRecycledPidScenario,
  stopCurrentOwners
}
