'use strict'

const { spawn } = require('node:child_process')
const { createHash, randomBytes } = require('node:crypto')
const { existsSync } = require('node:fs')
const {
  cp,
  mkdir,
  readFile,
  realpath,
  symlink,
  writeFile
} = require('node:fs/promises')
const { createServer } = require('node:http')
const { dirname, join, resolve } = require('node:path')

const PROCESS_OUTPUT_LIMIT = 128 * 1024
const MODEL_NAME = 'packaged-handoff-smoke-model'
const SAVED_THREAD_TITLE = 'saved before packaged update handoff'
const CHAT_MARKER = 'packaged-update-handoff-chat-ok'
const POSITIVE_SCENARIOS = Object.freeze([
  Object.freeze({ name: 'external-auto-on-active', path: 'external', autoStart: true, activeWork: true }),
  Object.freeze({ name: 'in-app-auto-on', path: 'in-app', autoStart: true, activeWork: false }),
  Object.freeze({ name: 'external-auto-off', path: 'external', autoStart: false, activeWork: false })
])
const NEGATIVE_SCENARIOS = Object.freeze([
  'pid-port-reuse',
  'non-kun-command',
  'changed-discovery-identity',
  'inspection-denied'
])

function predecessorBuildId(candidateBuildId) {
  return createHash('sha256')
    .update(`kun-packaged-update-predecessor\0${candidateBuildId}`, 'utf8')
    .digest('hex')
}

function runtimeBuildIdForFlavor(buildId, flavor) {
  if (flavor === 'production') return buildId
  return createHash('sha256').update(`kun-dv-runtime\0${buildId}`, 'utf8').digest('hex')
}

async function readPackagedBuild(resourcesDir) {
  const manifestPath = join(
    resourcesDir,
    'app.asar.unpacked',
    'kun',
    'dist',
    'runtime-build.json'
  )
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (!/^[a-f0-9]{64}$/u.test(manifest?.buildId ?? '')) {
    throw new Error(`Packaged Runtime manifest has no valid build ID: ${manifestPath}`)
  }
  return { manifest, manifestPath, buildId: manifest.buildId }
}

async function preparePredecessorRuntime({ resourcesDir, oldResourcesDir, temporaryRoot }) {
  if (oldResourcesDir) {
    const old = await readPackagedBuild(oldResourcesDir)
    return {
      buildId: old.buildId,
      kunRoot: join(oldResourcesDir, 'app.asar.unpacked', 'kun'),
      synthetic: false
    }
  }

  const candidate = await readPackagedBuild(resourcesDir)
  const sourceRoot = join(resourcesDir, 'app.asar.unpacked')
  const sourceKun = join(sourceRoot, 'kun')
  const targetParent = join(temporaryRoot, 'synthetic-predecessor')
  const targetKun = join(targetParent, 'kun')
  await mkdir(targetKun, { recursive: true })
  await Promise.all([
    cp(join(sourceKun, 'dist'), join(targetKun, 'dist'), { recursive: true }),
    cp(join(sourceKun, 'package.json'), join(targetKun, 'package.json'))
  ])
  await Promise.all([
    linkDirectory(join(sourceKun, 'node_modules'), join(targetKun, 'node_modules')),
    linkDirectory(join(sourceRoot, 'node_modules'), join(targetParent, 'node_modules'))
  ])
  const buildId = predecessorBuildId(candidate.buildId)
  await writeFile(join(targetKun, 'dist', 'runtime-build.json'), `${JSON.stringify({
    ...candidate.manifest,
    buildId,
    artifactVersion: 'packaged-handoff-predecessor'
  }, null, 2)}\n`)
  return { buildId, kunRoot: targetKun, synthetic: true }
}

async function linkDirectory(source, target) {
  if (!existsSync(source)) return
  await symlink(source, target, process.platform === 'win32' ? 'junction' : 'dir')
}

function buildSmokeSettings({ dataDir, port, runtimeToken, workspaceRoot, baseUrl, autoStart }) {
  return {
    version: 1,
    workspaceRoot,
    agents: {
      kun: {
        dataDir,
        port,
        runtimeToken,
        autoStart,
        providerId: 'deepseek',
        model: MODEL_NAME,
        apiKey: 'packaged-handoff-smoke-key',
        baseUrl,
        endpointFormat: 'chat_completions'
      }
    }
  }
}

async function writeSmokeSettings(paths, settings) {
  const text = `${JSON.stringify(settings, null, 2)}\n`
  await Promise.all(paths.map(async (path) => {
    await mkdir(path, { recursive: true })
    await writeFile(join(path, 'kun-settings.json'), text)
  }))
}

function spawnTracked(command, args, options = {}) {
  const child = spawn(command, args, {
    detached: process.platform !== 'win32',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  })
  let output = ''
  const append = (chunk) => {
    output = `${output}${String(chunk)}`.slice(-PROCESS_OUTPUT_LIMIT)
  }
  child.stdout?.on('data', append)
  child.stderr?.on('data', append)
  child.once('error', (error) => append(`\nlaunch error: ${String(error)}\n`))
  return { child, output: () => output }
}

async function launchPredecessorOwners(input) {
  // macOS exposes its temporary directory through both /var and /private/var.
  // ESM canonicalizes import.meta.url, while process.argv keeps the spelling
  // passed to spawn; the entrypoint's direct-execution guard therefore only
  // matches when the smoke passes the canonical path as well.
  const [managerEntry, serveEntry] = await Promise.all([
    realpath(join(input.kunRoot, 'dist', 'manager', 'manager-entry.js')),
    realpath(join(input.kunRoot, 'dist', 'cli', 'serve-entry.js'))
  ])
  const managerEnvironment = {
    ...input.environment,
    ELECTRON_RUN_AS_NODE: '1',
    KUN_MANAGER_CONTROL_DIR: input.controlDir,
    KUN_MANAGER_DATA_DIR: input.dataDir,
    KUN_MANAGER_SETTINGS_PATH: input.settingsPath,
    KUN_MANAGER_TOKEN: `manager-${randomBytes(16).toString('hex')}`,
    KUN_MANAGER_INSTANCE_ID: `manager-old-${randomBytes(8).toString('hex')}`,
    KUN_RUNTIME_BUILD_ID: input.buildId
  }
  const manager = spawnTracked(input.runtimeExecutable, [managerEntry], {
    cwd: input.workspaceRoot,
    env: managerEnvironment
  })
  input.onSpawn?.(manager)
  const managerDiscovery = await waitForJson(
    join(input.controlDir, 'manager.json'),
    (value) => value?.pid === manager.child.pid && value?.buildId === input.buildId,
    input.timeoutMs,
    () => childState(manager.child, manager.output())
  )

  const runtimes = []
  for (const flavor of ['production', 'development']) {
    const port = flavor === 'production' ? input.productionPort : input.developmentPort
    const token = `${flavor}-${randomBytes(16).toString('hex')}`
    const environment = {
      ...input.environment,
      ELECTRON_RUN_AS_NODE: '1',
      KUN_RUNTIME_LAUNCH_MODE: 'shared',
      KUN_RUNTIME_FLAVOR: flavor,
      KUN_MANAGER_CONTROL_DIR: input.controlDir,
      KUN_MANAGER_SETTINGS_PATH: input.settingsPath,
      KUN_DISABLE_OS_CREDENTIAL_STORE: '1'
    }
    const args = [
      serveEntry,
      'serve',
      '--host', '127.0.0.1',
      '--port', String(port),
      '--data-dir', input.dataDir,
      '--runtime-token', token,
      '--api-key', 'packaged-handoff-smoke-key',
      '--base-url', input.baseUrl,
      '--endpoint-format', 'chat_completions',
      '--model', MODEL_NAME,
      '--approval-policy', 'auto',
      '--sandbox-mode', 'workspace-write'
    ]
    const process = spawnTracked(input.runtimeExecutable, args, {
      cwd: input.workspaceRoot,
      env: environment
    })
    input.onSpawn?.(process)
    const discoveryPath = flavor === 'production'
      ? join(input.dataDir, 'runtime.json')
      : join(input.controlDir, 'runtime.development.json')
    const expectedBuildId = runtimeBuildIdForFlavor(input.buildId, flavor)
    const discovery = await waitForJson(
      discoveryPath,
      (value) => value?.pid === process.child.pid && value?.buildId === expectedBuildId,
      input.timeoutMs,
      () => childState(process.child, process.output())
    )
    runtimes.push({ flavor, discovery, discoveryPath, process })
  }
  return { manager: { discovery: managerDiscovery, process: manager }, runtimes }
}

async function startModelFixture() {
  const pending = new Set()
  const state = { mode: 'complete', requests: 0 }
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ object: 'list', data: [{ id: MODEL_NAME }] }))
      return
    }
    state.requests += 1
    for await (const _chunk of request) { /* consume bounded local request */ }
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive'
    })
    response.write(`data: ${JSON.stringify({
      id: 'chatcmpl-smoke',
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { role: 'assistant', content: CHAT_MARKER }, finish_reason: null }]
    })}\n\n`)
    if (state.mode === 'hang') {
      pending.add(response)
      response.once('close', () => pending.delete(response))
      return
    }
    response.write(`data: ${JSON.stringify({
      id: 'chatcmpl-smoke',
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
    })}\n\n`)
    response.end('data: [DONE]\n\n')
  })
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Model fixture has no TCP port')
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    state,
    close: async () => {
      for (const response of pending) response.destroy()
      await new Promise((resolvePromise) => server.close(resolvePromise))
    }
  }
}

async function runtimeJson(discovery, path, init = {}) {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${discovery.runtimeToken}`)
  if (init.body !== undefined) headers.set('content-type', 'application/json')
  const response = await fetch(`${discovery.baseUrl}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(init.timeoutMs ?? 10_000)
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} failed (${response.status}): ${body}`)
  return body ? JSON.parse(body) : undefined
}

async function createSmokeThread(discovery, workspaceRoot, title = SAVED_THREAD_TITLE) {
  return runtimeJson(discovery, '/v1/threads', {
    method: 'POST',
    body: JSON.stringify({
      title,
      workspace: workspaceRoot,
      model: MODEL_NAME,
      mode: 'agent',
      approvalPolicy: 'auto',
      sandboxMode: 'workspace-write'
    })
  })
}

async function startSmokeTurn(discovery, threadId, prompt) {
  return runtimeJson(discovery, `/v1/threads/${encodeURIComponent(threadId)}/turns`, {
    method: 'POST',
    body: JSON.stringify({
      prompt,
      model: MODEL_NAME,
      approvalPolicy: 'auto',
      sandboxMode: 'workspace-write',
      disableUserInput: true
    })
  })
}

async function waitForTurn(discovery, threadId, turnId, predicate, timeoutMs) {
  return poll(async () => {
    const turn = await runtimeJson(
      discovery,
      `/v1/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}`
    )
    return predicate(turn) ? turn : undefined
  }, timeoutMs, `turn ${turnId}`)
}

async function waitForJson(path, predicate, timeoutMs, state = () => '') {
  return poll(async () => {
    try {
      const value = JSON.parse(await readFile(path, 'utf8'))
      return predicate(value) ? value : undefined
    } catch (error) {
      if (error?.code === 'ENOENT' || error instanceof SyntaxError) return undefined
      throw error
    }
  }, timeoutMs, `${path}; ${state()}`)
}

async function poll(operation, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const value = await operation()
      if (value !== undefined && value !== false) return value
    } catch (error) {
      lastError = error
    }
    await delay(100)
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ''}`)
}

function childState(child, output = '') {
  const state = child.exitCode === null && child.signalCode === null
    ? 'running'
    : child.signalCode ?? `exit-${child.exitCode}`
  return `${state}${output.trim() ? `\n${output.trim()}` : ''}`
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

async function waitForProcessExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!processIsAlive(pid)) return true
    await delay(100)
  }
  return !processIsAlive(pid)
}

function parseSmokeMarker(output, prefix) {
  const line = String(output).split(/\r?\n/u).find((candidate) => candidate.startsWith(prefix))
  if (!line) return undefined
  return JSON.parse(line.slice(prefix.length))
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

module.exports = {
  CHAT_MARKER,
  MODEL_NAME,
  NEGATIVE_SCENARIOS,
  POSITIVE_SCENARIOS,
  SAVED_THREAD_TITLE,
  buildSmokeSettings,
  childState,
  createSmokeThread,
  launchPredecessorOwners,
  parseSmokeMarker,
  poll,
  predecessorBuildId,
  preparePredecessorRuntime,
  processIsAlive,
  readPackagedBuild,
  runtimeBuildIdForFlavor,
  runtimeJson,
  spawnTracked,
  startModelFixture,
  startSmokeTurn,
  waitForJson,
  waitForProcessExit,
  waitForTurn,
  writeSmokeSettings
}
