import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUILTIN_HARNESSES } from './builtin-harnesses.js'
import { HarnessDetector } from './harness-detector.js'
import { AcpModelProbe } from './acp-model-probe.js'
import { probeAcpHandshake } from './acp-handshake-probe.js'
import { checkHarnessAdmission, resolvePermissionMode } from './harness-admission.js'
import { AcpConnection } from '../runtime/acp/acp-connection.js'
import { startAcpProcess, type AcpSpawnFn } from '../runtime/acp/acp-process.js'
import { AcpSessionManager } from '../runtime/acp/acp-session-manager.js'
import { applyDevinSessionPermission } from '../runtime/acp/devin-session-permissions.js'
import { AcpError } from '../runtime/acp/acp-schema.js'
import { mapAcpFailure } from '../runtime/acp/acp-runtime-support.js'
import { DelegatedSessionCoordinator, FileDelegatedSessionBindingStore } from '../runtime/delegated-session-binding.js'
import type { TurnItem } from '../contracts/items.js'

const definition = BUILTIN_HARNESSES.find((entry) => entry.id === 'devin')!
const fixture = fileURLToPath(new URL('../runtime/acp/__fixtures__/fake-acp-agent.mjs', import.meta.url))
const scenarioPath = fileURLToPath(new URL('../runtime/acp/__fixtures__/scenarios/auth-advertised.json', import.meta.url))
const tempDirs: string[] = []
const connections: AcpConnection[] = []
const spawnFixture: AcpSpawnFn = async (_command, _args, options) => spawn(process.execPath, [fixture], {
  env: options.env as NodeJS.ProcessEnv,
  cwd: options.cwd,
  stdio: ['pipe', 'pipe', 'pipe']
})

afterEach(async () => {
  for (const conn of connections.splice(0)) await conn.close()
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function fixtureDefinition(scenarioOverride?: Record<string, unknown>) {
  const dir = await mkdtemp(join(tmpdir(), 'kun-devin-test-'))
  tempDirs.push(dir)
  const scenario = JSON.parse(await readFile(scenarioPath, 'utf8'))
  const path = join(dir, 'scenario.json')
  await writeFile(path, JSON.stringify({ ...scenario, ...scenarioOverride }))
  const journal = join(dir, 'journal.jsonl')
  return {
    dir,
    journal: async () => (await readFile(journal, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line)),
    definition: {
      ...definition,
      launch: { ...definition.launch!, env: { FAKE_ACP_SCENARIO: path, FAKE_ACP_JOURNAL: journal } }
    }
  }
}

describe('Devin ACP integration', () => {
  it('uses the official transport with no permission bypass or guessed models', () => {
    expect(definition.launch).toEqual({ command: 'devin', args: ['acp'], env: {} })
    expect(definition.credentialModes).toEqual(['native-login'])
    expect(definition.staticModels).toEqual([])
    expect(definition.setup?.login).toMatchObject({ command: 'devin', args: ['auth', 'login'] })
    expect(definition.capabilities.facts.sandbox).toBe('none')
    expect(resolvePermissionMode(definition, undefined, false, false)).toBe('normal')
  })

  it('reports missing and failed-handshake installations accurately', async () => {
    const resolve = vi.fn(async () => undefined as string | undefined)
    const probeReady = vi.fn(async () => ({ ready: 'no' as const, detail: 'unknown subcommand acp' }))
    const detector = new HarnessDetector({
      definitions: () => [definition], overrides: () => ({}), resolveExecutable: resolve,
      spawnCaptured: async () => ({ stdout: 'devin 3000.11.3', stderr: '', exitCode: 0, timedOut: false }),
      probeReady, probeLogin: async () => 'unknown', nowMs: Date.now, nowIso: () => new Date().toISOString()
    })
    expect(await detector.status('devin', { force: true })).toMatchObject({
      installed: 'no', reasonCode: 'not_installed'
    })
    expect(probeReady).not.toHaveBeenCalled()
    resolve.mockResolvedValue('/opt/agents/devin')
    expect(await detector.status('devin', { force: true })).toMatchObject({
      installed: 'yes', ready: 'no', reasonCode: 'handshake_failed'
    })
    expect(probeReady).toHaveBeenCalledWith(definition, '/opt/agents/devin', { signal: expect.any(AbortSignal) })
  })

  it('does not claim OS isolation and requires an isolated workspace for workers', () => {
    const input = {
      usage: 'manager-worker' as const, harness: definition, effective: definition.capabilities,
      status: { harnessId: 'devin', installed: 'yes' as const, login: 'unknown' as const, checkedAt: new Date().toISOString() },
      workspace: { isolated: false }, unattended: false, allowUnattendedFullAccess: false
    }
    expect(checkHarnessAdmission(input)).toMatchObject({ ok: false, code: 'sandbox_insufficient' })
    expect(checkHarnessAdmission({ ...input, workspace: { isolated: true } })).toMatchObject({ ok: true })
  })

  it('preserves advertised login choices and probes actual session models without authentication or prompts', async () => {
    const f = await fixtureDefinition()
    const handshake = await probeAcpHandshake(f.definition, 'devin', { spawn: spawnFixture })
    expect(handshake).toMatchObject({ ok: true, authMethods: [{ id: 'browser' }] })
    expect(handshake.authRequired).toBeUndefined()
    const probe = new AcpModelProbe({ spawn: spawnFixture })
    expect(await probe.probe(f.definition)).toEqual(['available-model'])
    const methods = (await f.journal()).filter((entry) => entry.dir === 'in').map((entry) => entry.frame.method)
    expect(methods).toContain('session/new')
    expect(methods).not.toContain('authenticate')
    expect(methods).not.toContain('session/prompt')
  })

  it('probes the legacy session model list without invented current/default entries', async () => {
    const f = await fixtureDefinition({ newSession: { models: {
      currentModelId: 'unlisted-default',
      availableModels: [{ modelId: 'legacy-model', name: 'Legacy model' }]
    } } })
    expect(await new AcpModelProbe({ spawn: spawnFixture }).probe(f.definition)).toEqual(['legacy-model'])
  })

  it('queries selected model options without sending prompts or changing the native default', async () => {
    const f = await fixtureDefinition({ newSession: { configOptions: [
      { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'native-default', options: [
        { value: 'native-default', name: 'Native Default' }, { value: 'selected-model', name: 'Selected Model' }
      ] },
      { id: 'effort', name: 'Effort', category: 'thought_level', type: 'select', currentValue: 'medium',
        options: [{ value: 'medium', name: 'Medium' }, { value: 'high', name: 'High' }] }
    ] } })
    const result = await new AcpModelProbe({ spawn: spawnFixture }).probeCatalog(f.definition, 'selected-model')
    expect(result.modelInfo).toMatchObject([{ id: 'native-default', isDefault: true },
      { id: 'selected-model', displayName: 'Selected Model', reasoningEfforts: ['medium', 'high'] }])
    const requests = (await f.journal()).filter((entry) => entry.dir === 'in').map((entry) => entry.frame)
    expect(requests).toContainEqual(expect.objectContaining({ method: 'session/set_config_option',
      params: expect.objectContaining({ value: 'selected-model' }) }))
    expect(requests.some((entry) => entry.method === 'session/prompt')).toBe(false)
  })

  it('uses the modern selector order without mixing legacy model aliases', async () => {
    const f = await fixtureDefinition({ newSession: {
      configOptions: [{ id: 'model', name: 'Model', category: 'model', type: 'select',
        currentValue: 'shared', options: [{ group: 'Models', name: 'Models', options: [
          { value: 'shared', name: 'Shared' }, { value: 'config-model', name: 'Config model' }
        ] }] }],
      models: { availableModels: [{ modelId: 'shared' }, { modelId: 'legacy-model' },
        { modelId: 42 }, null, {}, { modelId: ' ' }] }
    } })
    expect(await new AcpModelProbe({ spawn: spawnFixture }).probe(f.definition))
      .toEqual(['shared', 'config-model'])
  })

  it('reapplies the safe mode when resuming the same native session', async () => {
    const f = await fixtureDefinition()
    const proc = await startAcpProcess({ command: 'devin', args: ['acp'], env: f.definition.launch.env, spawn: spawnFixture })
    const conn = AcpConnection.start({ process: proc, identity: 'local-login' })
    connections.push(conn)
    await conn.initialize()
    const manager = new AcpSessionManager({ coordinator: new DelegatedSessionCoordinator(new FileDelegatedSessionBindingStore(f.dir)) })
    const ctx = { harnessId: 'devin', threadId: 'thread', turnId: 'first', workspacePath: f.dir, permissionModeId: 'normal', items: [] }
    const first = await manager.ensureSession(ctx, conn)
    const item = { id: 'user', role: 'user', kind: 'user_message', status: 'completed', threadId: 'thread', turnId: 'first', text: 'hello', createdAt: new Date().toISOString() } as TurnItem
    await manager.commit(first, { committedItems: [item], lastCommittedTurnId: 'first' })
    first.detach()
    const resumed = await manager.ensureSession({ ...ctx, turnId: 'second', items: [item] }, conn)
    expect(resumed.sessionId).toBe(first.sessionId)
    expect(resumed.replayedHistory).toBe(false)
    resumed.detach()
    const incoming = (await f.journal()).filter((entry) => entry.dir === 'in').map((entry) => entry.frame)
    expect(incoming.filter((frame) => frame.method === 'session/load')).toHaveLength(1)
    expect(incoming.filter((frame) => frame.method === 'session/set_mode').map((frame) => frame.params.modeId)).toEqual(['normal', 'normal'])
  })

  it('fails closed when Devin cannot establish the requested permission mode', async () => {
    const request = vi.fn()
    const conn = { rpc: { request } } as unknown as AcpConnection
    await expect(applyDevinSessionPermission(conn, {
      sessionId: 'session', modes: { currentModeId: 'bypass', availableModes: [{ id: 'bypass' }] }
    })).rejects.toMatchObject({ code: 'policy_denied' })
    expect(request).not.toHaveBeenCalled()
  })

  it('uses config options when advertised and honors only explicitly requested wider permissions', async () => {
    const request = vi.fn(async () => ({}))
    const conn = { rpc: { request } } as unknown as AcpConnection
    const session = { sessionId: 'session', configOptions: [{
      id: 'permissions', name: 'Permissions', category: 'mode', type: 'select' as const,
      currentValue: 'bypass', options: [{ value: 'normal', name: 'Normal' }, { value: 'bypass', name: 'Bypass' }]
    }] }
    await applyDevinSessionPermission(conn, session)
    expect(request).toHaveBeenLastCalledWith('session/set_config_option', { sessionId: 'session', configId: 'permissions', value: 'normal' })
    await applyDevinSessionPermission(conn, session, 'bypass')
    expect(request).toHaveBeenLastCalledWith('session/set_config_option', { sessionId: 'session', configId: 'permissions', value: 'bypass' })
  })

  it('surfaces a real authentication rejection while preserving other failure classes', async () => {
    const f = await fixtureDefinition({ newSession: { error: { code: -32000, message: 'Authentication required' } } })
    expect(await new AcpModelProbe({ spawn: spawnFixture }).probe(f.definition)).toEqual([])
    expect(mapAcpFailure(new AcpError('agent_error', 'Authentication required', { rpcCode: -32000 }), true)).toMatchObject({ code: 'harness_not_ready', message: expect.stringContaining('sign in') })
    expect(mapAcpFailure(new AcpError('agent_error', 'Authentication required', { rpcCode: -32000 }), true, 'devin'))
      .toMatchObject({ code: 'harness_not_ready', message: expect.stringContaining('devin auth login') })
    expect(mapAcpFailure(new AcpError('request_aborted', 'Cancelled'), true)).toMatchObject({ code: 'request_aborted' })
    expect(mapAcpFailure(new AcpError('agent_error', 'Server busy', { rpcCode: -32603 }), true)).toMatchObject({ code: 'agent_error', message: 'Server busy' })
  })
})
