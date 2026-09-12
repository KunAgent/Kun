import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import { fork, execFile } from 'node:child_process'
import { promisify } from 'node:util'
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { terminateProcessTree } = (await import('./smoke-packaged-extension-desktop-process.cjs')).default
const imported = (path) => import(pathToFileURL(join(repositoryRoot, 'kun/dist', path)).href)
const exec = promisify(execFile)
const timeoutMs = 360000
const callLimit = 20

async function selectedCredential() {
  const dataDir = join(homedir(), '.kun', 'data')
  const rawRegistry = await readFile(join(dataDir, 'model-connections.v1.json'))
  const registry = JSON.parse(rawRegistry.toString('utf8'))
  const provider = registry.profiles[registry.defaultProviderId]
  if (!provider || provider.kind !== 'http' || !provider.configured || !provider.credentialRef) throw new Error('selected_native_credential_unavailable')
  if (provider.endpointFormat && provider.endpointFormat !== 'chat_completions') throw new Error('selected_chat_completions_profile_required')
  const model = registry.defaultModel ?? provider.selectedModel
  if (!model || registry.credentialTransactions?.[provider.id]) throw new Error('selected_provider_not_ready')
  const { createAesEncryptor, createCompatibleEncryptor } = await imported('security/secret-encryptor.js')
  const { defaultSecretCommandRunner } = await imported('security/secret-store.js')
  const { ExtensionCredentialStore } = await imported('services/extension-credential-store.js')
  const { materializeLegacyProviderCredential } = await imported('services/legacy-provider-credential-migration.js')
  let fileKey, osKey
  try {
    const candidate = Buffer.from((await readFile(join(dataDir, 'secret.key'), 'utf8')).trim(), 'base64')
    if (candidate.length === 32) fileKey = candidate
  } catch { /* Optional existing keys or non-usage SSE frames. */ }
  if (process.platform === 'darwin') {
    const found = await defaultSecretCommandRunner('security', ['find-generic-password', '-s', 'kun-secret-key', '-a', 'kun', '-w'])
    if (found.code === 0) {
      const candidate = Buffer.from(found.stdout.trim(), 'base64')
      if (candidate.length === 32) osKey = candidate
    }
  }
  if (!osKey && !fileKey) throw new Error('existing_selected_credential_key_unavailable')
  const encryptor = osKey && fileKey ? createCompatibleEncryptor(createAesEncryptor(osKey), createAesEncryptor(fileKey)) : createAesEncryptor(osKey ?? fileKey)
  const credentials = new ExtensionCredentialStore({ dataDir, profileId: 'default', keyProvider: { encryptor, osKeychain: Boolean(osKey), reason: 'read-only existing key' } })
  const credential = await credentials.get(provider.credentialRef)
  if (!credential?.apiKey) throw new Error('selected_native_api_key_unreadable')
  const material = materializeLegacyProviderCredential(credential.apiKey)
  return { provider, model, apiKey: material.apiKey, credentialHeaders: material.headers, dataDir,
    originalRegistryHash: createHash('sha256').update(rawRegistry).digest('hex') }
}

async function isolatedChild(root) {
  const configuration = await new Promise((resolve) => process.once('message', resolve))
  const { startServiceManager } = await imported('manager/service-manager.js')
  const { startKunServe } = await imported('server/runtime-factory.js')
  const { DEFAULT_KUN_CAPABILITIES_CONFIG } = await imported('contracts/capabilities.js')
  const capabilities = structuredClone(DEFAULT_KUN_CAPABILITIES_CONFIG)
  for (const value of Object.values(capabilities)) if (value && typeof value === 'object' && 'enabled' in value) value.enabled = false
  capabilities.subagents.profiles = {}
  const repo = join(root, 'synthetic-repository')
  await mkdir(repo, { recursive: true })
  await exec('git', ['init', '-b', 'develop', repo])
  await exec('git', ['-C', repo, 'config', 'user.name', 'Rooms Native Smoke'])
  await exec('git', ['-C', repo, 'config', 'user.email', 'rooms-smoke@example.invalid'])
  await writeFile(join(repo, 'baseline.txt'), 'synthetic baseline\n')
  await exec('git', ['-C', repo, 'add', '.'])
  await exec('git', ['-C', repo, 'commit', '-m', 'test: synthetic baseline'])
  const token = randomUUID()
  let manager, runtime, keepalive
  let phase = 'startup', trackedRoomId
  const stageStart = Date.now()
  const report = { providerId: configuration.providerId, model: configuration.model, scenario: 'automatic agreement compression and original request continuation', clarification: 'not_started', continuation: 'not_started' }
  const api = async (path, body) => {
    const response = await fetch(`http://${runtime.host}:${runtime.port}${path}`, { method: body ? 'POST' : 'GET',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) })
    if (!response.ok) throw new Error('runtime_http_' + response.status)
    return response.json()
  }
  const checkpoint = async () => {
    if (!runtime?.runtime.rooms || !trackedRoomId) return
    const rows = await runtime.runtime.rooms.deps.store.list('request', { roomId: trackedRoomId, summaryOnly: true, limit: 20 })
    process.send?.({ kind: 'checkpoint', snapshot: { phase, elapsedMs: Date.now() - stageStart,
      requests: rows.map((row) => ({ id: row.id, status: row.value.status, contextState: row.value.contextState })) } })
  }
  const wait = async (inspect) => {
    const until = Date.now() + timeoutMs - 15000
    while (Date.now() < until) { await checkpoint(); const value = await inspect(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 500)) }
    throw new Error('scenario_timeout')
  }
  try {
    manager = await startServiceManager({ controlDir: join(root, 'control'), dataDir: join(root, 'data'), settingsPath: join(root, 'settings.json'),
      managerToken: randomUUID(), instanceId: 'native-room-smoke-' + randomUUID(), startedAt: new Date().toISOString() })
    runtime = await startKunServe({ host: '127.0.0.1', port: 0, dataDir: join(root, 'data'), runtimeToken: token,
      apiKey: 'isolated-smoke-placeholder', activeProviderId: configuration.providerId, baseUrl: configuration.baseUrl,
      model: configuration.model, endpointFormat: configuration.endpointFormat, approvalPolicy: 'auto', sandboxMode: 'workspace-write', approvalReviewer: 'user',
      tokenEconomyMode: false, insecure: false, runtimeFlavor: 'development', discoveryDir: join(root, 'discovery'),
      capabilities, sharedMcpConfigPath: join(root, 'empty-mcp.json'), serviceManager: { discovery: manager.discovery } })
    const { heartbeatRuntimeWithManager } = await imported('manager/manager-client.js')
    let heartbeatPending = false
    keepalive = setInterval(async () => {
      if (heartbeatPending) return
      heartbeatPending = true
      try { const accepted = await heartbeatRuntimeWithManager({ manager: { discovery: manager.discovery }, flavor: 'development', instanceId: runtime.instanceId }); report.heartbeats ??= []; report.heartbeats.push({ accepted, elapsedMs: Date.now() - stageStart }) }
      catch { report.heartbeatError = true }
      finally { heartbeatPending = false }
    }, 5000)
    keepalive.unref()
    const rooms = runtime.runtime.rooms
    await wait(() => rooms.deps.assertOwnership().then(() => true, () => false))
    await rooms.close()
    const { putRoomDocument } = await imported('rooms/room-service.js')
    const { roomBundleRules } = await imported('rooms/room-rule-compression.js')
    const { room } = await api('/v1/rooms', { clientRequestId: 'native-hardening-room', name: 'Native room hardening', collaborationMode: 'directed' })
    trackedRoomId = room.id
    const originalRule = 'Keep compatibility with /src/public-api.ts. Numeric limit is 12. NEVER upload credentials. Only local synthetic fixtures are excepted. '.repeat(120)
    const seed = await api(`/v1/rooms/${room.id}/messages`, { clientRequestId: 'rule-source', executionIntent: 'discussion', body: originalRule })
    const seedRow = await rooms.deps.store.get('request', seed.requestId)
    await putRoomDocument(rooms.deps.store, 'request', seedRow.id, room.id, { ...seedRow.value, status: 'completed' }, seedRow)
    await api(`/v1/rooms/${room.id}/rules`, { clientRequestId: 'pin-rule', messageId: seed.message.id })
    rooms.start()
    phase = 'compress-and-clarify'
    const sent = await api(`/v1/rooms/${room.id}/messages`, { clientRequestId: 'clarification', executionIntent: 'discussion',
      body: 'Discussion only. First inspect the exact original numeric limit using read_room_rules (list the bundle, then read its rule). Then ask me to choose A or B before answering. Submit submit_room_plan with kind clarify. Do not create tasks or modify any files.' })
    const first = await wait(async () => {
      const current = await api(`/v1/rooms/${room.id}/requests/${sent.requestId}`)
      if (['needs_input', 'completed', 'failed', 'recovery_required'].includes(current.request.status)) return current
    })
    report.clarification = first.request.status
    report.compressed = first.context?.agreements?.compressed === true
    if (first.request.status !== 'needs_input' || !report.compressed) throw new Error('clarification_or_compression_not_completed')
    const bundleId = first.context.agreements.bundleId
    const originals = await roomBundleRules(rooms.deps.store, room.id, bundleId)
    report.originalRulePreserved = originals.length === 1 && originals[0].body === originalRule
    const job = await rooms.deps.store.get('rule_compression', first.request.compressionId)
    report.compressionBatches = job.value.outputs.length
    const items = (await rooms.deps.sessions.loadItemPage(first.request.threadId, { maxItems: 200, maxBytes: 1024 * 1024 })).items
    report.originalRuleToolObserved = items.some((item) => item.kind === 'tool_result' && item.toolName === 'read_room_rules' && !item.isError && item.output?.rule?.body.includes('12'))
    if (!report.originalRuleToolObserved) throw new Error('original_rule_tool_not_exercised')
    phase = 'continue-original-request'
    await api(`/v1/rooms/${room.id}/requests/${sent.requestId}/continue`, { clientRequestId: 'choose-a', expectedRevision: first.request.revision,
      message: { body: 'Choose A. Now give a brief answer confirming the numeric limit and the prohibition. This is still discussion only; submit kind answer.', executionIntent: 'discussion' } })
    const continued = await wait(async () => {
      const current = await api(`/v1/rooms/${room.id}/requests/${sent.requestId}`)
      if (['completed', 'failed', 'needs_input', 'recovery_required'].includes(current.request.status)) return current
    })
    report.continuation = continued.request.status
    report.sameRequest = continued.request.id === sent.requestId && continued.request.continuation === 1
    report.reusedFrozenBundle = continued.context?.agreements?.bundleId === bundleId
    report.compressionCacheReused = (await rooms.deps.store.get('rule_compression', first.request.compressionId)).revision === job.revision
    report.createdTasks = (await rooms.deps.store.list('task', { roomId: room.id })).length
    if (report.continuation !== 'completed' || !report.sameRequest || !report.reusedFrozenBundle || !report.compressionCacheReused || report.createdTasks !== 0) throw new Error('continuation_acceptance_failed')
    phase = 'completed'; await checkpoint()
    const usage = await api('/v1/usage').catch(() => null)
    report.usage = usage ? { recorded: true } : null
    report.sourceUntouched = (await readFile(join(repo, 'baseline.txt'), 'utf8')) === 'synthetic baseline\n'
    report.sourceClean = (await exec('git', ['-C', repo, 'status', '--porcelain'])).stdout.trim() === ''
  } catch (error) {
    report.error = /^[a-z0-9_]+$/.test(error.message) ? error.message : 'isolated_smoke_failed'
    report.failureDetail = String(error.message).replace(/(?:sk-[A-Za-z0-9_-]+|Bearer\s+[^\s]+)/g, '[REDACTED]')
  }
  finally {
    await checkpoint().catch(() => {})
    report.elapsedMs = Date.now() - stageStart
    report.sourceUntouched = (await readFile(join(repo, 'baseline.txt'), 'utf8').catch(() => '')) === 'synthetic baseline\n'
    report.sourceClean = (await exec('git', ['-C', repo, 'status', '--porcelain']).catch(() => ({ stdout: 'unknown' }))).stdout.trim() === ''
    await runtime?.close().catch(() => {})
    clearInterval(keepalive)
    await manager?.close().catch(() => {})
    process.send?.({ kind: 'result', report })
  }
}

async function main() {
  if (!process.argv.includes('--run')) { console.log('Explicit --run is required. This isolated smoke uses the selected native API profile with a 20-call limit.'); return }
  const selected = await selectedCredential()
  const root = await mkdtemp(join(tmpdir(), 'kun-rooms-native-review-'))
  const evidence = resolve(process.argv.includes('--evidence') ? process.argv[process.argv.indexOf('--evidence') + 1] : join(repositoryRoot, 'dist', 'rooms-native-hardening'))
  await mkdir(evidence, { recursive: true, mode: 0o700 })
  const reportPath = join(evidence, 'report.json')
  const safeText = (value) => String(value).split(selected.apiKey).join('[REDACTED]')
  const filterReasoning = (value) => Array.isArray(value) ? value.map(filterReasoning) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, (key === 'reasoning_content' || key === 'reasoning') && typeof child === 'string' && child.length > 0 ? '[REDACTED_REASONING]' : filterReasoning(child)])) : value
  const safeWire = (wire) => wire.split('\n').map((line) => { if (!line.startsWith('data: ') || line.trim() === 'data: [DONE]') return line; try { return 'data: ' + JSON.stringify(filterReasoning(JSON.parse(line.slice(6)))) } catch { return line } }).join('\n')
  const upstream = new URL(selected.provider.baseUrl)
  let calls = 0, server, child, deadline, report
  const requests = []
  try {
    server = createServer(async (request, response) => {
      if (++calls > callLimit) { response.writeHead(429); response.end('{"error":{"message":"isolated smoke request budget exhausted"}}'); return }
      const startedAt = Date.now()
      const log = { model: selected.model, providerId: selected.provider.id, request: calls, status: 'started' }
      requests.push(log)
      console.log(JSON.stringify({ phase: 'upstream-start', request: calls, providerId: selected.provider.id, model: selected.model }))
      try {
        const parts = []; for await (const part of request) parts.push(Buffer.from(part))
        const body = JSON.parse(Buffer.concat(parts).toString('utf8'))
        body.max_tokens = Math.min(body.max_tokens ?? 2048, 2048)
        await writeFile(join(evidence, 'request-' + log.request + '.json'), safeText(JSON.stringify(filterReasoning(body), null, 2)), { mode: 0o600 })
        const target = new URL(request.url, upstream.origin)
        const actual = await fetch(target, { method: 'POST', headers: { 'content-type': 'application/json',
          ...(selected.provider.headers ?? {}), ...(selected.credentialHeaders ?? {}), ...(selected.provider.customHeaders ?? {}), authorization: 'Bearer ' + selected.apiKey },
          body: JSON.stringify(body), signal: AbortSignal.timeout(45000) })
        log.status = actual.status
        response.writeHead(actual.status, { 'content-type': actual.headers.get('content-type') ?? 'application/json' })
        let pending = '', wire = ''
        const toolCalls = new Map(); log.finishReasons = []; log.sawDone = false
        for await (const chunk of actual.body) {
          response.write(Buffer.from(chunk))
          const text = Buffer.from(chunk).toString('utf8'); wire += text; pending += text
          const lines = pending.split('\n'); pending = lines.pop().slice(-256000)
          for (const line of lines) {
            if (line.trim() === 'data: [DONE]') { log.sawDone = true; continue }
            if (!line.startsWith('data: ')) continue
            try {
              const value = JSON.parse(line.slice(6))
              for (const choice of value.choices ?? []) {
                if (choice.finish_reason) log.finishReasons.push(choice.finish_reason)
                for (const call of choice.delta?.tool_calls ?? choice.message?.tool_calls ?? []) {
                  const previous = toolCalls.get(call.index ?? call.id) ?? { arguments: '' }
                  toolCalls.set(call.index ?? call.id, { name: call.function?.name ?? previous.name, id: call.id ?? previous.id, arguments: previous.arguments + (call.function?.arguments ?? '') })
                }
              }
              if (value.usage) log.usage = Object.fromEntries(['prompt_tokens', 'completion_tokens', 'total_tokens', 'prompt_cache_hit_tokens', 'prompt_cache_miss_tokens']
                .filter((key) => typeof value.usage[key] === 'number').map((key) => [key, value.usage[key]]))
            } catch { /* Optional existing keys or non-usage SSE frames. */ }
          }
        }
        log.streamEOF = true
        log.toolCalls = [...toolCalls.values()].map((call) => ({ name: call.name, id: call.id, argumentBytes: Buffer.byteLength(call.arguments), argumentKeys: (() => { try { return Object.keys(JSON.parse(call.arguments)) } catch { return null } })() }))
        await writeFile(join(evidence, 'response-' + log.request + '.sse'), safeText(safeWire(wire)), { mode: 0o600 })
        response.end()
      } catch { log.status = 'upstream_failed'; if (!response.headersSent) { response.writeHead(502); response.end('{"error":{"message":"bounded upstream request failed"}}') } else response.destroy() }
      finally { log.durationMs = Date.now() - startedAt; await writeFile(join(evidence, 'upstream.json'), safeText(JSON.stringify(requests, null, 2))); console.log(JSON.stringify({ phase: 'upstream-end', request: log.request, status: log.status, durationMs: log.durationMs, finishReasons: log.finishReasons, tools: log.toolCalls?.map((call) => call.name), sawDone: log.sawDone })) }
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    await mkdir(join(root, 'home'), { recursive: true })
    await writeFile(join(root, 'gitconfig'), '')
    await writeFile(join(root, 'empty-mcp.json'), '{"mcpServers":{}}')
    const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, COMSPEC: process.env.COMSPEC, PATHEXT: process.env.PATHEXT, TMP: root, TEMP: root, APPDATA: join(root, 'app-data'), LOCALAPPDATA: join(root, 'local-app-data'), TMPDIR: root, HOME: join(root, 'home'), USERPROFILE: join(root, 'home'),
      KUN_DISABLE_OS_CREDENTIAL_STORE: '1', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(root, 'gitconfig'), NODE_ENV: 'test' }
    child = fork(fileURLToPath(import.meta.url), ['--isolated', root], { env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
    child.stdout.on('data', () => {})
    child.stderr.on('data', () => {})
    deadline = setTimeout(() => { void terminateProcessTree(child, process.platform, { detached: process.platform !== 'win32', timeoutMs: 15000 }).catch(() => {}) }, timeoutMs)
    report = await new Promise((resolve) => {
      let lastPhase
      child.on('message', (message) => {
        if (message.kind === 'result') resolve(message.report)
        if (message.kind === 'checkpoint') {
          writeFile(join(evidence, 'checkpoint.json'), safeText(JSON.stringify(message.snapshot, null, 2)), { mode: 0o600 }).catch(() => {})
          const phase = message.snapshot.phase
          if (phase !== lastPhase) { lastPhase = phase; console.log(JSON.stringify({ phase, elapsedMs: message.snapshot.elapsedMs })) }
        }
      })
      child.on('exit', () => resolve({ error: 'isolated_process_ended' }))
      child.send({ providerId: selected.provider.id, model: selected.model, endpointFormat: selected.provider.endpointFormat,
        baseUrl: `http://127.0.0.1:${server.address().port}${upstream.pathname === '/' ? '' : upstream.pathname}` })
    })
    report.evidence = evidence
    report.upstreamRequests = requests
    report.maxUpstreamCalls = callLimit
    report.originalRegistryUnchanged = createHash('sha256').update(await readFile(join(selected.dataDir, 'model-connections.v1.json'))).digest('hex') === selected.originalRegistryHash
    report.ok = !report.error && report.continuation === 'completed' && report.compressed && report.originalRuleToolObserved && report.sameRequest && report.originalRegistryUnchanged && report.sourceClean && report.sourceUntouched
    report.totalUsage = Object.fromEntries(['prompt_tokens', 'completion_tokens', 'total_tokens', 'prompt_cache_hit_tokens', 'prompt_cache_miss_tokens'].map((key) => [key, requests.reduce((total, item) => total + (item.usage?.[key] ?? 0), 0)]))
    if (!report.ok) process.exitCode = 1
    await writeFile(reportPath, JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ ...report, reportPath }))
  } finally {
    clearTimeout(deadline)
    if (child?.pid) await terminateProcessTree(child, process.platform, { detached: process.platform !== 'win32', timeoutMs: 15000 }).catch(() => {})
    server?.closeAllConnections()
    await new Promise((resolve) => server ? server.close(resolve) : resolve())
    await rm(root, { recursive: true, force: true })
  }
}
if (process.argv.includes('--isolated')) {
  isolatedChild(resolve(process.argv.at(-1))).catch(() => { process.send?.({ kind: 'result', report: { error: 'isolated_startup_failed' } }); process.exitCode = 1 })
} else main().catch(() => { console.log(JSON.stringify({ prepared: false, error: 'selected_credential_or_smoke_prerequisite_unavailable' })); process.exitCode = 1 })
