import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Explicit, paid-account smoke: uses installed native logins, three short turns per
// selected Agent, synthetic workspaces and an isolated Manager/Runtime profile.
if (!process.argv.includes('--run')) {
  console.log('Pass --run to send three short real turns per Agent using existing native accounts.')
  process.exit(0)
}
const repository = fileURLToPath(new URL('../', import.meta.url))
const imported = (path) => import(new URL('../kun/dist/' + path, import.meta.url).href)
const requested = process.argv.includes('--agents') ? process.argv[process.argv.indexOf('--agents') + 1].split(',')
  : ['devin', 'codex', 'opencode', 'deepseek-harness', 'claude-code']
const turnCount = process.argv.includes('--turns') ? Number(process.argv[process.argv.indexOf('--turns') + 1]) : 3
const selectedModel = process.env.KUN_SMOKE_MODEL || 'default'
const checkTools = process.argv.includes('--tools')
assert.ok(Number.isInteger(turnCount) && turnCount >= 1 && turnCount <= 10, '--turns must be between 1 and 10')
const managedBinary = (directory, command) => {
  const path = join(homedir(), '.kun', 'agents', directory, 'node_modules', '.bin', command + (process.platform === 'win32' ? '.cmd' : ''))
  return existsSync(path) ? path : command
}
const { discoverCodexExecutable } = await imported('harness/codex-executable.js')
const paths = {
  devin: process.env.KUN_SMOKE_DEVIN_BINARY || 'devin',
  codex: process.env.KUN_SMOKE_CODEX_BINARY || await discoverCodexExecutable() || 'codex',
  opencode: process.env.KUN_SMOKE_OPENCODE_BINARY || managedBinary('opencode', 'opencode'),
  opencode2: process.env.KUN_SMOKE_OPENCODE2_BINARY || managedBinary('opencode2', 'opencode2'),
  pi: process.env.KUN_SMOKE_PI_BINARY || managedBinary('pi', 'pi'),
  antigravity: process.env.KUN_SMOKE_ANTIGRAVITY_BINARY || 'agy',
  'deepseek-harness': process.env.KUN_SMOKE_DSH_BINARY || managedBinary('dsh', 'dsh'),
  'claude-code': process.env.KUN_SMOKE_CLAUDE_BINARY || 'claude'
}
for (const id of requested) assert.ok(id in paths, `Unsupported smoke target: ${id}`)
const root = await mkdtemp(join(tmpdir(), 'kun-native-agent-turns-'))
const evidence = resolve(repository, 'dist/native-agent-turns')
await mkdir(evidence, { recursive: true })
const { startServiceManager } = await imported('manager/service-manager.js')
const { startKunServe } = await imported('server/runtime-factory.js')
const { heartbeatRuntimeWithManager } = await imported('manager/manager-client.js')
const { DEFAULT_KUN_CAPABILITIES_CONFIG } = await imported('contracts/capabilities.js')
const { redactApprovalSensitiveText } = await imported('domain/approval.js')
const { shutdownOwnedProcesses } = await imported('process/owned-process.js')
const capabilities = structuredClone(DEFAULT_KUN_CAPABILITIES_CONFIG)
for (const value of Object.values(capabilities)) if (value && typeof value === 'object' && 'enabled' in value) value.enabled = false
capabilities.subagents.profiles = {}
const token = randomUUID()
const report = { startedAt: new Date().toISOString(), root, results: [] }
const reportName = 'report-' + requested.join('-') + '-' + Date.now() + '.json'
const proxyUrl = process.env.KUN_SMOKE_NATIVE_PROXY
const nativeAgentNetwork = proxyUrl ? { codex: { source: 'system', proxyUrl }, antigravity: { source: 'system', proxyUrl },
  'claude-code': { source: 'system', proxyUrl } } : undefined
let manager, runtime, heartbeat
const checkpoint = () => writeFile(join(evidence, reportName), JSON.stringify(report, null, 2) + '\n')
try {
  manager = await startServiceManager({ controlDir: join(root, 'control'), dataDir: join(root, 'data'),
    settingsPath: join(root, 'settings.json'), managerToken: randomUUID(), instanceId: randomUUID(), startedAt: new Date().toISOString() })
  runtime = await startKunServe({ host: '127.0.0.1', port: 0, dataDir: join(root, 'data'), runtimeToken: token,
    apiKey: 'unused-native-smoke-key', baseUrl: 'http://127.0.0.1:1', model: 'default',
    approvalPolicy: 'auto', sandboxMode: 'danger-full-access', approvalReviewer: 'user',
    tokenEconomyMode: false, insecure: false, runtimeFlavor: 'development', discoveryDir: join(root, 'discovery'),
    capabilities, nativeAgentNetwork, sharedMcpConfigPath: join(root, 'empty-mcp.json'), serviceManager: { discovery: manager.discovery },
    harnesses: { binaryPaths: paths, enabledProfiles: requested.map((harnessId) => ({ harnessId, credentialMode: 'native-login' })),
      disabledIds: [], defaults: {}, custom: [] } })
  heartbeat = setInterval(() => void heartbeatRuntimeWithManager({ manager: { discovery: manager.discovery },
    flavor: 'development', instanceId: runtime.instanceId }).catch(() => undefined), 5000)
  const api = async (path, body) => {
    const response = await fetch(`http://${runtime.host}:${runtime.port}${path}`, { method: body ? 'POST' : 'GET',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(70_000) })
    const data = await response.json()
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(data)}`)
    return data
  }
  for (const id of requested) {
    const started = Date.now(), result = { id, status: 'checking', turns: [] }
    report.results.push(result); await checkpoint()
    try {
      const check = await api(`/v1/harnesses/${id}/test`, { level: 'handshake', credentialMode: 'native-login', model: selectedModel, timeoutMs: 60_000 })
      result.readiness = { ok: check.ok, authentication: check.readiness?.authentication,
        checks: check.readiness?.checks, detail: check.readiness?.detail, handshake: check.handshake?.detail }
      if (!check.ok) throw new Error('Native readiness failed')
      const workspace = join(root, 'workspace-' + id); await mkdir(workspace)
      const fileCode = 'KUN_FILE_' + randomUUID().slice(0, 8)
      if (checkTools) await writeFile(join(workspace, 'continuation-check.txt'), fileCode + '\n')
      const thread = await api('/v1/threads', { title: 'Native Agent smoke', titleAuto: false, workspace,
        model: selectedModel, harnessId: id, credentialMode: 'native-login', mode: 'agent',
        approvalPolicy: 'auto', sandboxMode: 'danger-full-access' })
      result.status = 'running'; result.threadId = thread.id; await checkpoint()
      const memoryCode = 'KUN_MEMORY_' + randomUUID().slice(0, 8)
      for (let round = 1; round <= turnCount; round++) {
        const expected = round === 2 ? memoryCode : round === 3 && checkTools ? fileCode : `KUN_NATIVE_OK_${round}`
        const prompt = round === 1
          ? `Remember this code for our conversation: ${memoryCode}. Reply with exactly ${expected}. Do not use tools or inspect files.`
          : round === 2 ? 'What code did I ask you to remember in my previous message? Reply with just that code. Do not use tools or inspect files.'
            : round === 3 && checkTools
              ? 'Read continuation-check.txt in the current working directory and reply with only its contents. Do not change files or access the network.'
              : `Reply with exactly ${expected}. Do not use tools or inspect files.`
        const startedTurn = await api(`/v1/threads/${thread.id}/turns`, { prompt,
          model: selectedModel, harnessId: id, credentialMode: 'native-login', mode: 'agent',
          clientSurface: 'api', disableUserInput: true, approvalPolicy: 'auto', sandboxMode: 'danger-full-access' })
        const deadline = Date.now() + 120_000
        let turn
        while (Date.now() < deadline) {
          turn = await runtime.runtime.turnService.getTurn(thread.id, startedTurn.turnId)
          if (turn && ['completed', 'failed', 'aborted'].includes(turn.status)) break
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
        if (!turn || !['completed', 'failed', 'aborted'].includes(turn.status)) {
          await runtime.runtime.turnService.interruptTurn({ threadId: thread.id, turnId: startedTurn.turnId })
          throw new Error('Native turn timed out')
        }
        const items = await runtime.runtime.sessionStore.loadItems(thread.id)
        const text = items.filter((item) => item.turnId === startedTurn.turnId && item.kind === 'assistant_text').map((item) => item.text).join('')
        result.status = turn.status; result.code = turn.terminalCode
        const events = await runtime.runtime.sessionStore.loadEventsSince(thread.id, 0)
        const diagnostics = events.filter((event) => event.turnId === startedTurn.turnId && event.kind === 'delegated_runtime')
          .map((event) => ({ phase: event.phase, reason: event.reason }))
        result.turns.push({ round, status: turn.status, outputMatches: text.includes(expected), outputLength: text.length,
          toolReadCheck: round === 3 && checkTools,
          diagnostics, handoffs: events.filter((event) => event.turnId === startedTurn.turnId && event.kind === 'handoff_injected').length })
        result.outputMatches = result.turns.every((entry) => entry.outputMatches)
        if (turn.error) result.error = redactApprovalSensitiveText(turn.error).slice(0, 700)
        result.ok = turn.status === 'completed' && result.outputMatches
        await checkpoint()
        console.log(JSON.stringify({ id, ...result.turns.at(-1) }))
        if (!result.ok) break
      }
    } catch (error) { result.ok = false; result.status = 'failed'; result.error = redactApprovalSensitiveText(String(error)).slice(0, 700) }
    result.durationMs = Date.now() - started; await checkpoint()
    console.log(JSON.stringify(result))
  }
} finally {
  await runtime?.close().catch(() => undefined)
  clearInterval(heartbeat)
  await manager?.close().catch(() => undefined)
  await shutdownOwnedProcesses({ graceMs: 1000, timeoutMs: 5000 }).catch(() => undefined)
  report.finishedAt = new Date().toISOString(); await checkpoint()
}
if (report.results.some((result) => !result.ok)) process.exitCode = 1
