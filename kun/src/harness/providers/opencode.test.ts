import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HarnessCatalog } from '../harness-catalog.js'
import { codeMakerDefinition } from './opencode.js'
import { providerModule } from './registry.js'
import { nativeCredentialFiles, nativeHasKey } from '../harness-readiness-profile.js'
import { nativeHarnessCredentialEnv } from '../harness-secret-env.js'
import { probeAcpHandshake } from '../acp-handshake-probe.js'
import { startHarnessProcess, type HarnessProcess } from '../../session/harness-process.js'
import { CONVERSATION_HARNESS_IDS } from '../../contracts/agent-executor.js'

vi.mock('../../session/harness-process.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../session/harness-process.js')>(), startHarnessProcess: vi.fn()
}))
const catalog = new HarnessCatalog({ custom: () => [] })
const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })

describe('CodeMaker fork of OpenCode', () => {
  it('derives everything but command, login exemption, history and installers from OpenCode', () => {
    const opencode = catalog.get('opencode')!
    const codemaker = catalog.get('codemaker')!
    expect(codemaker).toEqual(codeMakerDefinition(opencode))
    expect(codemaker).toMatchObject({ id: 'codemaker', displayName: 'CodeMaker', transport: 'acp',
      detect: { command: 'codemaker' }, launch: { command: 'codemaker', args: ['acp'] },
      permissionModes: opencode.permissionModes, nativeAgents: 'session-modes', gateway: opencode.gateway,
      acpClientWrites: false, setup: { login: { command: 'codemaker', args: ['auth', 'login'] } } })
    expect(providerModule('codemaker')?.credentials?.requireEvidence).toBe(true)
    expect(codemaker.historySource).toBeUndefined()
    expect(codemaker.setup?.install).toBeUndefined()
    expect(codemaker.capabilities.statuses.fsMediated.supported).toBe(false)
    expect(CONVERSATION_HARNESS_IDS).toContain('codemaker')
  })

  it('keeps file writes inside CodeMaker by not offering fs/write_text_file', async () => {
    const requests: Array<Record<string, unknown>> = []
    // Each probe closes its process, so every iteration gets fresh streams.
    vi.mocked(startHarnessProcess).mockImplementation(async () => {
      const stdin = new PassThrough(), stdout = new PassThrough()
      stdin.on('data', (data: Buffer) => {
        const request = JSON.parse(data.toString()); requests.push(request)
        stdout.write(JSON.stringify({ id: request.id, result: request.method === 'initialize'
          ? { protocolVersion: 1, agentInfo: { name: 'OpenCode', version: 'local' } } : { sessionId: 'fixture' } }) + '\n')
      })
      return { stdin, stdout, exit: new Promise(() => undefined), stop: async () => { stdout.end() },
        sanitizedStderrTail: () => '' } as unknown as HarnessProcess
    })
    for (const [id, writes] of [['codemaker', false], ['opencode', true]] as const) {
      requests.length = 0
      expect((await probeAcpHandshake(catalog.get(id)!, 'fixture', {})).ok).toBe(true)
      expect(requests[0]).toMatchObject({ method: 'initialize',
        params: { clientCapabilities: { fs: { readTextFile: true, writeTextFile: writes } } } })
    }
  })

  it('reads credentials from its own XDG directory or the CODEMAKER variables', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'codemaker-readiness-')); dirs.push(dir)
    const env = { HOME: dir, XDG_DATA_HOME: dir }
    const definition = { ...catalog.get('codemaker')!, launch: { command: 'codemaker', args: ['acp'], env } }
    const path = nativeCredentialFiles(definition)[0]!
    expect(path).toBe(join(dir, 'codemaker', 'auth.json'))
    expect(nativeHasKey(definition, env)).toBe(false)
    expect(nativeHasKey(definition, { ...env, CODEMAKER_API_KEY: 'fixture-key' })).toBe(true)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify({ 'netease-codemaker': { type: 'codemaker', token: 'fixture-token' } }))
    expect(nativeHasKey(definition, env)).toBe(true)
    expect(nativeHarnessCredentialEnv(definition, { CODEMAKER_AUTH_TOKEN: 't', CODEMAKER_AUTH_USER: 'u', OPENAI_API_KEY: 'x' }))
      .toEqual({ CODEMAKER_AUTH_TOKEN: 't', CODEMAKER_AUTH_USER: 'u' })
  })

  it('accepts a login that a build before the directory rename kept in OpenCode\'s data directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'codemaker-legacy-')); dirs.push(dir)
    const env = { HOME: dir, XDG_DATA_HOME: dir, XDG_CONFIG_HOME: dir }
    const definition = { ...catalog.get('codemaker')!, launch: { command: 'codemaker', args: ['acp'], env } }
    expect(nativeCredentialFiles(definition)).toEqual([join(dir, 'codemaker', 'auth.json'), join(dir, 'opencode', 'auth.json')])
    expect(providerModule('codemaker')?.credentials?.profileFiles?.(env, dir)).toEqual([
      join(dir, 'codemaker', 'opencode.json'), join(dir, 'codemaker', 'opencode.jsonc'),
      join(dir, 'opencode', 'opencode.json'), join(dir, 'opencode', 'opencode.jsonc')])
    expect(nativeHasKey(definition, env)).toBe(false)
    await mkdir(join(dir, 'opencode'), { recursive: true })
    await writeFile(join(dir, 'opencode', 'auth.json'), JSON.stringify({ codemaker: { type: 'oauth', access: 'a', refresh: 'r', expires: 1 } }))
    expect(nativeHasKey(definition, env)).toBe(true)
  })
})
