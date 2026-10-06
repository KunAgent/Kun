import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WIRING_CLIENTS } from './lib/agent-wiring-smoke-clients.mjs'
import { CATALOG, FIXTURE_TOKEN, lastTrace, loadWiringModules, startWiringGateway, wiringRuntime } from './lib/agent-wiring-smoke-runtime.mjs'

// Agent wiring smoke: for every installed agent, Kun's wiring service edits
// the agent's own config in an isolated home, the agent's real CLI runs with
// no model or base-URL flags against an in-process gateway (fake upstream,
// external traffic denied by a proxy), and disconnecting must restore every
// seeded file byte for byte. Never touches the real home directory.
//
// Usage: node scripts/smoke-agent-wiring-clients.mjs [--client <id>|all] [--timeout 90000] [--json]
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function parseWiringOptions(argv) {
  const options = { client: 'all', timeout: 90_000, json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (key === '--json') { options.json = true; continue }
    const value = argv[index + 1]
    if (key === '--client' && value) { options.client = value; index += 1 }
    else if (key === '--timeout' && Number(value) >= 1_000) { options.timeout = Number(value); index += 1 }
    else throw new Error('Expected --client <id|all>, --timeout <ms> or --json')
  }
  if (options.client !== 'all' && !WIRING_CLIENTS[options.client]) throw new Error(`Unknown client ${options.client}`)
  return options
}

function findBinary(bin) {
  for (const dir of String(process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const candidate = join(dir, bin)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

function capture(binary, args, env, cwd, timeout) {
  return new Promise((resolveRun) => {
    const child = spawn(binary, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' })
    let stdout = '', stderr = '', timedOut = false
    const kill = (signal) => { try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, signal); else child.kill(signal) } catch { /* gone */ } }
    child.stdout.on('data', (chunk) => { stdout = (stdout + chunk).slice(-200_000) })
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-200_000) })
    const timer = setTimeout(() => { timedOut = true; kill('SIGTERM'); setTimeout(() => kill('SIGKILL'), 2_000).unref() }, timeout)
    child.once('error', (error) => { clearTimeout(timer); resolveRun({ code: -1, stdout, stderr: String(error), timedOut }) })
    child.once('close', (code) => { clearTimeout(timer); resolveRun({ code, stdout, stderr, timedOut }) })
  })
}

const sha = (text) => createHash('sha256').update(text).digest('hex')

async function denyProxy(blocked) {
  const proxy = createServer((request, response) => { blocked.push(`${request.method} ${request.url}`); response.writeHead(502).end('offline') })
  // Drop tunnels at once, like an offline network; some agents retry a 502 for minutes before starting.
  proxy.on('connect', (request, socket) => { blocked.push(`CONNECT ${request.url}`); socket.on('error', () => undefined); socket.destroy() })
  await new Promise((done) => proxy.listen(0, '127.0.0.1', done))
  return { url: `http://127.0.0.1:${proxy.address().port}`, close: () => new Promise((done) => { proxy.closeAllConnections?.(); proxy.close(done) }) }
}

function isolatedEnv(home, binary, proxy, extra) {
  return {
    PATH: [dirname(binary), dirname(process.execPath), '/usr/bin', '/bin'].join(delimiter),
    HOME: home, USERPROFILE: home, TMPDIR: join(home, 'tmp'), TEMP: join(home, 'tmp'), TMP: join(home, 'tmp'),
    XDG_CACHE_HOME: join(home, 'cache'), XDG_DATA_HOME: join(home, 'data'), XDG_STATE_HOME: join(home, 'state'),
    LANG: 'C.UTF-8', TERM: 'dumb', NO_COLOR: '1', CI: '1',
    HTTP_PROXY: proxy, HTTPS_PROXY: proxy, ALL_PROXY: proxy, http_proxy: proxy, https_proxy: proxy, all_proxy: proxy,
    NO_PROXY: '127.0.0.1,localhost,::1', no_proxy: '127.0.0.1,localhost,::1',
    ...extra
  }
}

async function seedHome(home, seed) {
  for (const dir of ['tmp', 'cache', 'data', 'state', 'workspace']) await mkdir(join(home, dir), { recursive: true, mode: 0o700 })
  for (const [path, content] of Object.entries(seed)) {
    await mkdir(dirname(join(home, path)), { recursive: true })
    await writeFile(join(home, path), content, { mode: 0o600 })
  }
  await writeFile(join(home, 'workspace', 'fixture.txt'), 'Offline fixture read successfully.\n')
}

function backups(dir) {
  const out = []
  const walk = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name)
      if (entry.isDirectory() && !['cache', 'data', 'state', 'tmp', 'workspace'].includes(entry.name)) walk(full)
      else if (entry.name.endsWith('.kun-backup')) out.push(full)
    }
  }
  walk(dir)
  return out
}

async function runScenario(ctx, scenario) {
  ctx.state.scenario = scenario
  const before = ctx.calls.length
  const requestsBefore = ctx.requests.length
  const result = await capture(ctx.binary, ctx.client.args(scenario, ctx.workspace), ctx.env, ctx.workspace, ctx.timeout)
  const calls = ctx.calls.slice(before).filter((call) => call.toolCount > 0 || call.historyKinds.length)
  const replied = ctx.client.succeeded(result.stdout)
  const checks = {
    replied,
    reachedGateway: calls.length > 0,
    ruleRouted: calls.length > 0 && calls.every((call) => call.providerId === 'offline-rule'),
    middlewareApplied: calls.length > 0 && calls.every((call) => call.systemHasMark),
    ...(ctx.client.effort ? { effortSent: calls.some((call) => call.effort) } : {}),
    ...(scenario === 'tools' ? { toolRoundTrip: calls.some((call) => call.fixtureRead) } : {}),
    ...(scenario === 'tools' && ctx.agentId === 'claude-code' ? { thinkingReplayed: calls.some((call) => call.replayedReasoning && call.restoredSignature) } : {})
  }
  const trace = lastTrace(ctx.gateway, ctx.runtime)
  checks.traceDecision = trace?.decision === 'rule' && trace?.agent === ctx.agentId
  const passed = Object.values(checks).every(Boolean)
  return { scenario, passed, checks, exitCode: result.code, timedOut: result.timedOut,
    efforts: [...new Set(calls.map((call) => call.effort).filter(Boolean))], tools: [...new Set(calls.map((call) => call.fixtureTool).filter(Boolean))],
    ...(passed ? {} : { stdout: result.stdout.slice(-3_000), stderr: result.stderr.slice(-3_000),
      gatewayErrors: ctx.requests.slice(requestsBefore).filter((request) => request.error).slice(0, 3),
      gatewayRequests: ctx.requests.slice(requestsBefore).slice(0, 4).map((request) => `${request.method} ${request.path} ${request.status ?? ''} ${request.error ?? ''}`) }) }
}

async function runClient(agentId, options, gateway, temp, proxy) {
  const client = WIRING_CLIENTS[agentId]
  const binary = findBinary(client.bin)
  if (!binary) return { agentId, installed: false }
  const home = join(temp, agentId)
  await seedHome(home, client.seed)
  // Real path: macOS temp dirs are symlinks, and agents treat the unresolved path as outside the project.
  const workspace = realpathSync(join(home, 'workspace'))
  const env = isolatedEnv(home, binary, proxy.url, client.env(home))
  const calls = []
  const state = { scenario: 'text' }
  const runtime = wiringRuntime(gateway, { agentId, state, workspace, middlewareDir: join(home, 'middleware'), calls })
  const server = await startWiringGateway(gateway, runtime)
  const service = new gateway.AgentWiringService(gateway.createWiringContext({ home, env, platform: process.platform,
    stateFile: join(home, 'kun-state', 'agent-wiring.json'), which: (bin) => bin === client.bin ? binary : undefined }))
  const seeded = Object.fromEntries(Object.entries(client.seed).map(([path, content]) => [path, sha(content)]))
  const target = { origin: server.origin, key: `kun-${agentId}.${FIXTURE_TOKEN}`, model: 'local-model', models: CATALOG,
    ...(client.smallModel ? { smallModel: client.smallModel } : {}), ...(client.effort ? { effort: client.effort } : {}) }
  const versionRun = await capture(binary, ['--version'], env, workspace, 30_000)
  const report = { agentId, installed: true, binary, version: (versionRun.stdout || versionRun.stderr).trim().split('\n')[0], scenarios: [] }
  try {
    service.connect(agentId, target, 'gc_smoke')
    report.connected = service.status(agentId, server.origin)
    const ctx = { agentId, client, binary, env, workspace, timeout: options.timeout, calls, gateway, runtime, state, requests: server.requests }
    report.scenarios.push(await runScenario(ctx, 'text'))
    report.scenarios.push(await runScenario(ctx, 'tools'))
    service.disconnect(agentId, server.origin)
    const restored = await Promise.all(Object.entries(seeded).map(async ([path, hash]) => {
      const text = await readFile(join(home, path), 'utf8').catch(() => '')
      return { path, exact: sha(text) === hash, ...(sha(text) === hash ? {} : { after: text.slice(0, 2_000) }) }
    }))
    report.restoredExactly = restored.every((entry) => entry.exact)
    if (!report.restoredExactly) report.restoreDiff = restored.filter((entry) => !entry.exact)
    report.noBackupsLeft = backups(home).length === 0
    if (client.userEdit) {
      service.connect(agentId, target, 'gc_smoke')
      const file = join(home, client.userEdit.file)
      await writeFile(file, (await readFile(file, 'utf8')).replace(client.userEdit.from, client.userEdit.to))
      service.disconnect(agentId, server.origin)
      const after = await readFile(file, 'utf8')
      report.userEditKept = after.includes(client.userEdit.to) && !service.status(agentId, server.origin).connected &&
        !after.includes(FIXTURE_TOKEN) && !after.includes(server.origin)
    }
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error)
  } finally {
    await server.close()
  }
  report.passed = !report.error && report.scenarios.every((scenario) => scenario.passed) && report.restoredExactly === true &&
    report.noBackupsLeft === true && report.userEditKept !== false
  return report
}

function sourceEvidence() {
  try {
    return { sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      sourceDirty: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0 }
  } catch { return {} }
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseWiringOptions(argv)
  const temp = await mkdtemp(join(tmpdir(), 'kun-agent-wiring-smoke-'))
  const blocked = []
  const proxy = await denyProxy(blocked)
  try {
    const gateway = await loadWiringModules(root, temp)
    const results = []
    for (const agentId of options.client === 'all' ? Object.keys(WIRING_CLIENTS) : [options.client]) {
      results.push(await runClient(agentId, options, gateway, temp, proxy))
    }
    const installed = results.filter((result) => result.installed)
    const summary = { ...sourceEvidence(), passed: installed.length > 0 && installed.every((result) => result.passed),
      blockedExternalAttempts: [...new Set(blocked)].slice(0, 50), results }
    if (options.json) console.log(JSON.stringify(summary, null, 2))
    else {
      for (const result of results) {
        if (!result.installed) { console.log(`${result.agentId.padEnd(12)} not installed`); continue }
        const scenarios = result.scenarios.map((scenario) => `${scenario.scenario}:${scenario.passed ? 'ok' : `FAIL(${Object.entries(scenario.checks).filter(([, ok]) => !ok).map(([name]) => name).join(',')})`}`).join(' ')
        console.log(`${result.agentId.padEnd(12)} ${result.passed ? 'PASS' : 'FAIL'}  ${String(result.version).slice(0, 40).padEnd(40)} ${scenarios} restore:${result.restoredExactly ? 'exact' : 'NO'} userEdit:${result.userEditKept ?? 'n/a'}${result.error ? ` error:${result.error}` : ''}`)
      }
      console.log(`blocked external attempts: ${summary.blockedExternalAttempts.length}`)
    }
    return summary.passed ? 0 : 1
  } finally {
    await proxy.close()
    await rm(temp, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code }).catch((error) => { console.error(error); process.exitCode = 1 })
}
