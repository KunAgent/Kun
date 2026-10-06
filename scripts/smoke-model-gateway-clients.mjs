import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { CLIENT_VERSIONS, officialVersion, scenarioArgs, configureExtraClients, fixtureTool,
  succeededOutput } from './lib/gateway-client-smoke-profiles.mjs'

// Official clients, real gateway handlers, deterministic in-process upstream.
// Never loads a user's profile, account credential, provider, or repository.
// Usage: node scripts/smoke-model-gateway-clients.mjs [--client codex|claude|all]
// Optional: --codex /absolute/binary --claude /absolute/binary --timeout 45000
// Local exploration only: --allow-version-mismatch true (always reported).
// No installation or real model calls are performed. Missing clients fail.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const marker = 'KUN_GATEWAY_OFFLINE_OK'
const fixtureToken = 'kun_local_offline_fixture_only'
export const EXPECTED_CLIENT_VERSIONS = CLIENT_VERSIONS

export function parseOptions(argv) {
  const options = { client: 'all', timeout: 45_000 }
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]?.replace(/^--/, '')
    const value = argv[index + 1]
    if (!['client', 'codex', 'claude', 'opencode', 'pi', 'scenario', 'resources', 'timeout', 'allow-version-mismatch'].includes(key) || !value) {
      throw new Error('Expected a client binary, --client, --scenario, --resources, --timeout or --allow-version-mismatch with a value')
    }
    if (key === 'allow-version-mismatch') assert(['true', 'false'].includes(value), 'Version mismatch override must be true or false')
    options[key] = key === 'timeout' ? Number(value) : key === 'allow-version-mismatch' ? value === 'true' : value
  }
  assert(['all', 'codex', 'claude', 'opencode', 'pi'].includes(options.client), 'Unknown client')
  assert(['all', 'text', 'tools', 'cancel'].includes(options.scenario ?? 'all'), 'Unknown scenario')
  assert(Number.isFinite(options.timeout) && options.timeout >= 1000, 'Invalid timeout')
  return options
}

export function isolatedClientEnv(home, endpoint, denyProxy) {
  return {
    PATH: process.platform === 'win32' ? process.env.PATH ?? '' : '/usr/bin:/bin',
    ...(process.platform === 'win32' && process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, 'config'),
    XDG_CACHE_HOME: join(home, 'cache'),
    XDG_DATA_HOME: join(home, 'data'),
    XDG_RUNTIME_DIR: join(home, 'runtime'),
    CODEX_HOME: join(home, 'codex'),
    CLAUDE_CONFIG_DIR: join(home, 'claude'),
    TMPDIR: join(home, 'tmp'),
    TEMP: join(home, 'tmp'),
    TMP: join(home, 'tmp'),
    LANG: 'C.UTF-8',
    TERM: 'dumb',
    CI: '1',
    NO_COLOR: '1',
    HTTP_PROXY: denyProxy,
    HTTPS_PROXY: denyProxy,
    ALL_PROXY: denyProxy,
    http_proxy: denyProxy,
    https_proxy: denyProxy,
    all_proxy: denyProxy,
    NO_PROXY: '127.0.0.1,localhost,::1',
    no_proxy: '127.0.0.1,localhost,::1',
    KUN_GATEWAY_SMOKE_TOKEN: fixtureToken,
    ANTHROPIC_BASE_URL: endpoint,
    ANTHROPIC_API_KEY: fixtureToken,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_AUTOUPDATER: '1',
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1',
    CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: '1',
    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1',
    CLAUDE_CODE_SKIP_PROMPT_HISTORY: '1',
    MAX_THINKING_TOKENS: '0',
    CLAUDE_CODE_EFFORT_LEVEL: 'unset'
  }
}

export function clientArgs(client, workspace) {
  if (client === 'codex') return [
    'exec', '--skip-git-repo-check', '--ephemeral', '--ignore-rules',
    '--sandbox', 'read-only', '--json', '--color', 'never', '-C', workspace,
    '-c', 'analytics.enabled=false', '-c', 'feedback.enabled=false',
    '-c', 'web_search="disabled"', '-c', 'check_for_update_on_startup=false',
    `Return exactly ${marker}. Do not use tools.`
  ]
  return [
    '--bare', '--print', '--output-format', 'json', '--tools', '',
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--setting-sources', '', '--no-session-persistence', '--no-chrome',
    '--system-prompt', 'This is an offline protocol conformance test. Do not use tools.',
    '--model', 'local-model', `Return exactly ${marker}. Do not use tools.`
  ]
}

async function findBinary(client, options) {
  const explicit = options[client]
  const candidates = explicit ? [resolve(explicit)] : client === 'codex'
    ? ['/opt/codex/bin/codex', ...String(process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':').filter(Boolean).map((path) => join(path, process.platform === 'win32' ? 'codex.exe' : 'codex'))]
    : client === 'claude' ? [join(root, 'kun/node_modules/@anthropic-ai', `claude-agent-sdk-${process.platform}-${process.arch}`, process.platform === 'win32' ? 'claude.exe' : 'claude')]
    : String(process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':').filter(Boolean).map((path) => join(path, client))
  for (const candidate of candidates) {
    try { await access(candidate); return candidate } catch { /* Try the next installed executable. */ }
  }
  throw new Error(`${client} is not installed; provide --${client} /absolute/binary (this smoke never installs clients)`)
}

async function capture(binary, args, env, cwd, timeout, cancelWhen) {
  return new Promise((resolveCapture, reject) => {
    const child = spawn(binary, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      detached: process.platform !== 'win32' })
    const kill = (signal) => {
      try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal); else child.kill(signal) } catch { /* Fixture already exited. */ }
    }
    let stdout = '', stderr = '', timedOut = false, cancelled = false
    const append = (previous, chunk) => (previous + chunk.toString()).slice(-256_000)
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk) })
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk) })
    const timer = setTimeout(() => { timedOut = true; kill('SIGTERM') }, timeout)
    let killTimer
    const cancelTimer = cancelWhen ? setInterval(() => {
      if (!cancelled && cancelWhen()) { cancelled = true; kill('SIGINT') }
    }, 50) : undefined
    child.on('spawn', () => { killTimer = setTimeout(() => kill('SIGKILL'), timeout + 2_000) })
    child.once('error', (error) => { clearTimeout(timer); clearTimeout(killTimer); clearInterval(cancelTimer); reject(error) })
    child.once('close', (code, signal) => {
      clearTimeout(timer); clearTimeout(killTimer); clearInterval(cancelTimer)
      resolveCapture({ code, signal, timedOut, cancelled, stdout, stderr })
    })
  })
}

async function listen(server) {
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  return `http://127.0.0.1:${server.address().port}`
}

async function closeServer(server) {
  server.closeAllConnections?.()
  await new Promise((resolveClose) => server.close(resolveClose))
}

async function loadGateway(temp, resources) {
  // Bundle current TypeScript sources so this cannot accidentally test stale dist.
  const imports = [
    ['Router', 'server/router.ts'],
    ['startNodeHttpServer', 'server/node-http-server.ts'],
    ['gatewayChatCompletions, gatewayResponses, gatewayModels', 'server/routes/openai-model-gateway.ts'],
    ['gatewayMessages, gatewayCountTokens', 'server/routes/anthropic-messages-gateway.ts'],
    ['codexConfig, opencodeConfig, piModelsConfig', 'harness/gateway-config-templates.ts'],
    ['RoutePoolModelClient', 'adapters/model/route-pool-model-client.ts']
  ].map(([names, path]) => `export { ${names} } from ${JSON.stringify(resources
    ? join(resolve(resources), 'app.asar.unpacked/kun/dist', path.replace(/\.ts$/, '.js')) : join(root, 'kun/src', path))}`).join('\n')
  const output = join(temp, 'gateway-bundle.mjs')
  await build({ stdin: { contents: imports, resolveDir: root, loader: 'ts' }, bundle: true,
    platform: 'node', target: 'node22', format: 'esm', outfile: output, logLevel: 'silent' })
  return import(pathToFileURL(output).href)
}

function fakeRuntime(calls, client, workspace, scenario, gateway) {
  const pool = { id: 'offline', modelId: 'local-model', name: 'Offline fixture', enabled: true,
    strategy: 'priority', failurePolicy: { failoverHttpStatusCodes: [429, 503], failoverOnNetworkError: true,
      failoverOnTimeout: true, failoverOnAuthError: false },
    healthPolicy: { failureThreshold: 3, cooldownMs: 1000, halfOpenMaxAttempts: 1 },
    targets: [{ id: 'offline-target', providerId: 'offline', modelId: 'offline', enabled: true, weight: 1 }] }
  const caps = () => ({ id: 'offline', inputModalities: ['text', 'image'], outputModalities: ['text'],
    messageParts: ['text'], supportsToolCalling: true, parallelTools: true, structuredOutput: true,
    reasoning: { supportedEfforts: ['off', 'auto', 'low', 'medium', 'high', 'max', 'xhigh'] },
    contextWindowTokens: 1048576, maxOutputTokens: 128000 })
  const runtime = {
    runtimeToken: 'offline_control_only', insecure: false,
    modelGateway: {
      enabled: () => true, exposeProviderModels: () => false,
      pools: () => [pool, { ...pool, id: 'small', modelId: 'local-small' }], configuredPools: () => [pool, { ...pool, id: 'small', modelId: 'local-small' }],
      credentials: { verify: (value) => value === fixtureToken },
      modelCapabilities: caps
    },
    modelConnections: { snapshot: async () => ({ providers: ['offline', 'offline-next'].map((id) => ({ id, kind: 'http',
      authType: 'api-key', configured: true, credentialStatus: 'ready', models: ['offline'] })), failover: [] }) },
    modelClient: {
      provider: 'offline', model: 'offline',
      async *stream(request) {
        const call = { model: request.model, providerId: request.providerId,
          threadId: request.threadId, turnId: request.turnId, toolCount: request.tools.length,
          historyKinds: request.history.map((item) => item.kind), aborted: false,
          toolResults: request.history.filter((item) => item.kind === 'tool_result').map((item) => ({
            name: item.toolName, isError: item.isError,
            fixtureRead: JSON.stringify(item.output).includes('Offline fixture read successfully'),
            ...(!JSON.stringify(item.output).includes('Offline fixture read successfully')
              ? { fixtureError: JSON.stringify(item.output).slice(0, 1000) } : {}) })) }
        calls.push(call)
        if (scenario === 'cancel') {
          await new Promise((accept) => {
            const abort = () => { call.aborted = true; accept() }
            request.abortSignal.addEventListener('abort', abort, { once: true })
            if (request.abortSignal.aborted) abort()
          })
          return
        }
        if (scenario === 'tools' && request.tools.length && !request.history.some((item) => item.kind === 'tool_result')) {
          const tool = fixtureTool(request, workspace)
          call.fixtureTool = tool.name
          yield { kind: 'tool_call_complete', callId: 'offline-read-fixture', toolName: tool.name, arguments: tool.args }
          yield { kind: 'completed', stopReason: 'tool_calls' }
          return
        }
        yield { kind: 'assistant_text_delta', text: marker }
        yield { kind: 'usage', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15,
          cachedTokens: 0, cacheHitTokens: 0, cacheMissTokens: 10, cacheHitRate: 0, turns: 1 } }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
  }
  const routed = new gateway.RoutePoolModelClient(runtime.modelClient,
    [pool, { ...pool, id: 'small', modelId: 'local-small' }], caps)
  runtime.modelClient = routed
  runtime.modelGateway.pools = () => routed.routePools()
  runtime.modelGateway.configuredPools = () => routed.configuredPools()
  runtime.replaceFixtureTarget = () => routed.replacePools([
    { ...pool, targets: [{ ...pool.targets[0], providerId: 'offline-next' }] },
    { ...pool, id: 'small', modelId: 'local-small', targets: [{ ...pool.targets[0], providerId: 'offline-next' }] }
  ])
  return runtime
}

export function clientVersionEvidence(client, version, allowMismatch = false) {
  const expectedVersion = EXPECTED_CLIENT_VERSIONS[client]
  const versionMatched = officialVersion(client, version) === expectedVersion
  return { expectedVersion, versionMatched, allowedVersionMismatch: allowMismatch && !versionMatched }
}

function sourceEvidence() {
  try {
    const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return { sourceRevision, sourceDirty: dirty.length > 0 }
  } catch { return { sourceRevision: null, sourceDirty: null } }
}

export function toolShape(tool, depth = 0) {
  return { type: tool.type ?? 'function', name: tool.name, keys: Object.keys(tool).sort(),
    strict: tool.strict, defer_loading: tool.defer_loading, async: tool.async, allowed_callers: tool.allowed_callers,
    ...(tool.format ? { format: { type: tool.format.type, syntax: tool.format.syntax } } : {}),
    ...(depth < 2 && Array.isArray(tool.tools) ? { tools: tool.tools.map((member) => toolShape(member, depth + 1)) } : {}) }
}

function requestSummary(body) {
  return { keys: Object.keys(body).sort(), model: body.model, stream: body.stream,
    parallel_tool_calls: body.parallel_tool_calls, store: body.store,
    include: body.include, reasoning: body.reasoning,
    toolTypes: [...new Set((body.tools ?? []).map((tool) => tool.type ?? 'function'))],
    toolStructure: (body.tools ?? []).map((tool) => toolShape(tool)),
    inputTypes: [...new Set((Array.isArray(body.input) ? body.input : []).map((item) => item.type ?? item.role))] }
}

async function runClient(client, options, temp, gateway, denyProxy, blocked, scenario, role = 'main') {
  const binary = await findBinary(client, options)
  const home = join(temp, `${client}-${scenario}-${role}`)
  const workspace = join(home, 'workspace')
  for (const path of ['config', 'cache', 'data', 'codex', 'claude', 'tmp', 'runtime', 'workspace']) {
    await mkdir(join(home, path), { recursive: true, mode: 0o700 })
  }
  const calls = [], requests = []
  const runtime = fakeRuntime(calls, client, workspace, scenario, gateway)
  const router = new gateway.Router()
  for (const [method, path, handler] of [
    ['GET', '/v1/models', gateway.gatewayModels],
    ['POST', '/v1/chat/completions', gateway.gatewayChatCompletions],
    ['POST', '/v1/responses', gateway.gatewayResponses],
    ['POST', '/v1/messages', gateway.gatewayMessages],
    ['POST', '/v1/messages/count_tokens', gateway.gatewayCountTokens]
  ]) {
    router.add(method, path, async (request) => {
      const body = method === 'POST' ? await request.clone().json() : {}
      const record = { method, path, request: requestSummary(body) }
      requests.push(record)
      const response = await handler(runtime, request)
      record.status = response.status
      if (response.status >= 400) record.error = response instanceof Response ? await response.clone().text() : response.body
      return response
    })
  }
  const server = await gateway.startNodeHttpServer({ router, host: '127.0.0.1', port: 0 })
  const endpoint = `http://127.0.0.1:${server.port}`
  const env = isolatedClientEnv(home, endpoint, denyProxy)
  await configureExtraClients(client, home, endpoint, env, gateway)
  await writeFile(join(workspace, 'fixture.txt'), 'Offline fixture read successfully.\n', { mode: 0o600 })
  const config = gateway.codexConfig(`${endpoint}/v1`, 'local-model', 'KUN_GATEWAY_SMOKE_TOKEN')
  await writeFile(join(home, 'codex', 'config.toml'), config, { mode: 0o600 })
  const beforeBlocked = blocked.length
  try {
    const version = await capture(binary, ['--version'], env, workspace, Math.min(options.timeout, 30_000))
    const versionText = version.stdout.trim() || version.stderr.trim()
    const versionEvidence = clientVersionEvidence(client, versionText, options['allow-version-mismatch'] === true)
    if (version.code !== 0 || version.timedOut || (!versionEvidence.versionMatched && !versionEvidence.allowedVersionMismatch)) {
      return { client, scenario, role, version: versionText, ...versionEvidence, passed: false,
        error: `Expected official ${client} ${versionEvidence.expectedVersion}; refusing an unpinned compatibility result`,
        exitCode: version.code, timedOut: version.timedOut, versionOutput: version, requests, upstreamCalls: calls, blockedExternalAttempts: blocked.slice(beforeBlocked) }
    }
    const result = await capture(binary, scenarioArgs(client, workspace, scenario, role), env, workspace, options.timeout,
      scenario === 'cancel' ? () => calls.length > 0 : undefined)
    if (scenario === 'cancel') {
      const deadline = Date.now() + 2000
      while (calls.some((call) => !call.aborted) && Date.now() < deadline) await new Promise((accept) => setTimeout(accept, 20))
    }
    let routeChange
    if (scenario === 'text' && succeededOutput(client, result.stdout)) {
      runtime.replaceFixtureTarget()
      const repeated = await capture(binary, scenarioArgs(client, workspace, scenario, role), env, workspace, options.timeout)
      routeChange = { sameConfiguration: true, previous: 'offline', next: 'offline-next',
        passed: repeated.code === 0 && succeededOutput(client, repeated.stdout) &&
          calls.some((call) => call.providerId === 'offline') && calls.some((call) => call.providerId === 'offline-next') }
    }
    const success = scenario === 'cancel' ? result.cancelled && calls.some((call) => call.aborted)
      : succeededOutput(client, result.stdout) && (scenario !== 'tools' || calls.some((call) =>
        call.toolResults.some((item) => !item.isError && item.fixtureRead))) && (scenario !== 'text' || routeChange?.passed)
    return {
      client, scenario, role, version: versionText, ...versionEvidence,
      passed: (scenario === 'cancel' || result.code === 0) && !result.timedOut && success && calls.length > 0,
      exitCode: result.code, timedOut: result.timedOut, requests, upstreamCalls: calls,
      ...(routeChange ? { routeChange } : {}),
      blockedExternalAttempts: blocked.slice(beforeBlocked),
      ...(!success || result.code !== 0 ? { stdout: result.stdout.slice(-8000), stderr: result.stderr.slice(-8000) } : {})
    }
  } finally {
    await server.close()
  }
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv)
  const temp = await mkdtemp(join(tmpdir(), 'kun-gateway-official-clients-'))
  const blocked = []
  const proxy = createServer((request, response) => {
    blocked.push({ method: request.method, target: request.url })
    response.writeHead(502).end('Offline gateway test: external traffic disabled')
  })
  proxy.on('connect', (request, socket) => {
    socket.on('error', () => undefined)
    blocked.push({ method: 'CONNECT', target: request.url })
    socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
  })
  try {
    const denyProxy = await listen(proxy)
    const gateway = await loadGateway(temp, options.resources)
    const results = []
    for (const client of options.client === 'all' ? Object.keys(CLIENT_VERSIONS) : [options.client]) {
      for (const scenario of (options.scenario ?? 'all') === 'all' ? ['text', 'tools', 'cancel'] : [options.scenario]) {
        results.push(await runClient(client, options, temp, gateway, denyProxy, blocked, scenario))
      }
      if (client === 'claude' && (options.scenario ?? 'all') === 'all') {
        results.push(await runClient(client, options, temp, gateway, denyProxy, blocked, 'text', 'small'))
      }
    }
    console.log(JSON.stringify({ ...sourceEvidence(), expectedClientVersions: EXPECTED_CLIENT_VERSIONS, passed: results.every((item) => item.passed), results }, null, 2))
    return results.every((item) => item.passed) ? 0 : 1
  } finally {
    await closeServer(proxy)
    await rm(temp, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code }).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
