import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import type { TurnItem } from '../../contracts/items.js'
import { BUILTIN_HARNESSES } from '../../harness/builtin-harnesses.js'
import { createAcpCredentialEnv } from './acp-credential-env.js'
import { KunToolsMcpProvider } from './kun-tools-mcp.js'
import { HarnessTokenService } from '../../harness/harness-token-service.js'
import { checkHarnessAdmission } from '../../harness/harness-admission.js'
import { makeHarness, tempDirs, type Harness } from '../../../tests/helpers/acp-runtime-test-support.js'

describe('AcpRuntime.runTurn', () => {
  test('runs a full turn: prompt, streamed text, completion, committed binding', async () => {
    const h = await makeHarness('basic-chat.json')
    const outcome = await h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal
    )
    expect(outcome).toBe('completed')
    expect(h.finished).toHaveLength(1)
    expect(h.finished[0]).toMatchObject({ status: 'completed' })
    // Streamed chunks reached the durable delta path in order.
    expect(h.deltas.map((d) => d.delta).join('')).toBe('Hello world')

    const delegated = h.recorded.filter((e) => e.kind === 'delegated_runtime')
    expect(delegated).toHaveLength(1)
    expect(delegated[0]).toMatchObject({
      providerKind: 'acp',
      harnessId: 'fake-acp',
      phase: 'rebased',
      reason: 'new'
    })

    // session/prompt carried the user text.
    const prompts = h.requests('session/prompt')
    expect(prompts).toHaveLength(1)
    const promptBlocks = prompts[0].params?.prompt as Array<{ text?: string }>
    expect(promptBlocks.some((b) => b.text?.includes('hello agent'))).toBe(true)

    // Binding committed for native resume next turn.
    const binding = await h.coordinator.store.load('thread_1')
    expect(binding?.nativeSessionId).toBe('sess-basic')
  })

  test('rejects a non-ACP harness route', async () => {
    const h = await makeHarness('basic-chat.json', {
      thread: { harnessId: 'not-acp' },
      turn: { harnessId: 'not-acp' }
    })
    const outcome = await h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal
    )
    expect(outcome).toBe('failed')
    expect(h.finished[0]?.code).toBe('route_unsupported')
  })

  test('agent permission request resolves through the approval pipeline', async () => {
    const h = await makeHarness('permission.json', {
      // auto + danger-full-access → shared pipeline auto-allows.
      turn: { approvalPolicy: 'auto', sandboxMode: 'danger-full-access' }
    })
    const outcome = await h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal
    )
    expect(outcome).toBe('completed')
    // allow preferentially maps to the once-only option (§8.4).
    const settled = h
      .journal()
      .find(
        (entry) =>
          entry.dir === 'event' &&
          entry.frame?.kind === 'clientRequestSettled' &&
          entry.frame?.method === 'session/request_permission'
      )
    expect(settled?.frame?.response).toMatchObject({
      result: { outcome: { outcome: 'selected', optionId: 'allow-once' } }
    })
    // The completed tool call reached the timeline.
    expect(
      h.applied.some((item) => item.kind === 'tool_call' && 'callId' in item)
    ).toBe(true)
  })

  test('permission denial picks a reject option', async () => {
    const h = await makeHarness('permission.json', {
      turn: { approvalPolicy: 'never' }
    })
    const outcome = await h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal
    )
    expect(outcome).toBe('completed')
    const settled = h
      .journal()
      .find(
        (entry) =>
          entry.dir === 'event' &&
          entry.frame?.kind === 'clientRequestSettled' &&
          entry.frame?.method === 'session/request_permission'
      )
    expect(settled?.frame?.response).toMatchObject({
      result: { outcome: { outcome: 'selected', optionId: 'reject-once' } }
    })
  })

  test('abort sends session/cancel and ends the turn aborted', async () => {
    const controller = new AbortController()
    const h = await makeHarness('cancel.json', {
      // Abort once the first delta lands — the fixture then sleeps 30s unless
      // session/cancel settles the prompt early.
      onDelta: () => controller.abort(),
      items: [
        {
          id: 'item_turn_1_user',
          threadId: 'thread_1',
          turnId: 'turn_1',
          role: 'user',
          kind: 'user_message',
          status: 'completed',
          createdAt: '2026-01-01T00:00:00.000Z',
          text: 'work slow please'
        } as TurnItem
      ]
    })
    const outcome = await h.runtime.runTurn('thread_1', 'turn_1', controller.signal)
    expect(outcome).toBe('aborted')
    expect(h.finished[0]?.status).toBe('aborted')
    const cancels = h
      .journal()
      .filter(
        (entry) =>
          entry.dir === 'in' && entry.frame?.method === 'session/cancel'
      )
    expect(cancels).toHaveLength(1)
  })

  test('mid-turn process death fails the turn with a sanitized crash error', async () => {
    const h = await makeHarness('crash.json')
    const outcome = await h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal
    )
    expect(outcome).toBe('failed')
    expect(h.finished[0]?.code).toBe('harness_crashed')
    // stderr tail is redacted before it can reach a user-facing error.
    expect(h.finished[0]?.error ?? '').not.toContain('sk-testsecret')
  })

  test('a launch failure reports back through onLaunchFailure (P4-03)', async () => {
    const failures: Array<{ harnessId: string; detail: string }> = []
    const h = await makeHarness('basic-chat.json', {
      deps: {
        onLaunchFailure: (harnessId, detail) => {
          failures.push({ harnessId, detail })
        },
        spawn: async () => {
          throw new Error('ENOENT: binary vanished')
        }
      }
    })
    const outcome = await h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal
    )
    expect(outcome).toBe('failed')
    expect(failures).toHaveLength(1)
    expect(failures[0]?.harnessId).toBe('fake-acp')
    expect(failures[0]?.detail).toContain('ENOENT')
  })

  test('a second turn appends only its user text to the same live native session', async () => {
    const h = await makeHarness('resume.json')
    expect(
      await h.runtime.runTurn('thread_1', 'turn_1', new AbortController().signal)
    ).toBe('completed')

    // Second turn uses the live session, without replay/loading.
    // The new user item lands only after turn_1's commit so the stored
    // history digest stays a strict prefix of turn_2's prior items.
    h.thread.turns.push({ id: 'turn_2', harnessId: 'fake-acp' })
    h.items.push({
      id: 'item_turn_2_user',
      threadId: 'thread_1',
      turnId: 'turn_2',
      role: 'user',
      kind: 'user_message',
      status: 'completed',
      createdAt: '2026-01-01T00:01:00.000Z',
      text: 'second'
    } as TurnItem)
    const outcome = await h.runtime.runTurn(
      'thread_1',
      'turn_2',
      new AbortController().signal
    )
    expect(outcome).toBe('completed')
    expect(h.requests('session/load')).toHaveLength(0)
    expect(h.requests('session/new')).toHaveLength(1)
    const prompts = h.requests('session/prompt')
    expect(prompts[1].params?.sessionId).toBe(prompts[0].params?.sessionId)
    expect(prompts[1].params?.prompt).toEqual([{ type: 'text', text: 'second' }])
    // Replayed history during load never reached the timeline.
    expect(h.deltas.map((d) => d.delta).join('')).not.toContain('replayed turn')
    expect(h.deltas.map((d) => d.delta).join('')).toContain('second reply')
    const delegated = h.recorded.filter((e) => e.kind === 'delegated_runtime')
    expect(delegated.at(-1)).toMatchObject({ phase: 'resumed' })
  })

  test('sends an http kun-tools descriptor and revokes the grant at turn end', async () => {
    const tokens = new HarnessTokenService({ secret: Buffer.alloc(32, 9) })
    const provider = new KunToolsMcpProvider({
      tokens,
      endpoint: () => 'http://127.0.0.1:18899',
      command: () => ({ command: '/abs/kun', args: [] })
    })
    let verifiedMidTurn: unknown = 'unset'
    let h: Harness
    h = await makeHarness('basic-chat.json', {
      deps: { kunToolsMcp: provider },
      onDelta: () => {
        // The session/new frame is journaled before prompt streaming starts.
        const servers = h.requests('session/new')[0]?.params?.mcpServers as
          | Array<{ headers?: Array<{ name: string; value: string }> }>
          | undefined
        const bearer = servers?.[0]?.headers
          ?.find((header) => header.name === 'Authorization')
          ?.value.slice('Bearer '.length)
        verifiedMidTurn = bearer
          ? tokens.verifyScope(bearer, 'kun-tools')?.threadId
          : 'missing'
      }
    })
    const outcome = await h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal
    )
    expect(outcome).toBe('completed')
    const servers = h.requests('session/new')[0]?.params?.mcpServers as Array<{
      type: string
      url: string
      headers: Array<{ name: string; value: string }>
    }>
    expect(servers).toHaveLength(1)
    expect(servers[0]).toMatchObject({
      type: 'http',
      url: 'http://127.0.0.1:18899/mcp/kun'
    })
    const token = servers[0].headers
      .find((header) => header.name === 'Authorization')!
      .value.slice('Bearer '.length)
    expect(token.startsWith('kgw_')).toBe(true)
    // Live while the turn streamed, revoked once the turn finished.
    expect(verifiedMidTurn).toBe('thread_1')
    expect(tokens.verify(token)).toBeNull()
  })

  test('falls back to a stdio kun-tools descriptor without http support', async () => {
    const tokens = new HarnessTokenService({ secret: Buffer.alloc(32, 9) })
    const provider = new KunToolsMcpProvider({
      tokens,
      endpoint: () => 'http://127.0.0.1:18899',
      command: () => ({ command: '/abs/kun', args: ['/abs/serve-entry.js'] })
    })
    const h = await makeHarness('no-config.json', {
      deps: { kunToolsMcp: provider }
    })
    const outcome = await h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal
    )
    expect(outcome).toBe('completed')
    const servers = h.requests('session/new')[0]?.params?.mcpServers as Array<{
      type?: string
      command: string
      args: string[]
      env: Array<{ name: string; value: string }>
    }>
    expect(servers).toHaveLength(1)
    const server = servers[0]
    // Stdio descriptors omit `type`; command/args imply the stdio transport.
    expect(server.type).toBeUndefined()
    expect(server.command).toBe('/abs/kun')
    expect(server.args).toEqual([
      '/abs/serve-entry.js',
      'mcp-bridge',
      '--token-env',
      'KUN_TOOLS_TOKEN'
    ])
    const token = server.env.find((e) => e.name === 'KUN_TOOLS_TOKEN')!.value
    expect(token.startsWith('kgw_')).toBe(true)
    expect(tokens.verify(token)).toBeNull()
  })

  test('sends no descriptor when the agent rejects both MCP transports', async () => {
    const provider = new KunToolsMcpProvider({
      tokens: new HarnessTokenService({ secret: Buffer.alloc(32, 9) }),
      endpoint: () => 'http://127.0.0.1:18899',
      command: () => ({ command: '/abs/kun', args: [] })
    })
    const h = await makeHarness('mcp-declined.json', {
      deps: { kunToolsMcp: provider }
    })
    const outcome = await h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal
    )
    expect(outcome).toBe('completed')
    const servers =
      h.requests('session/new')[0]?.params?.mcpServers ?? []
    expect(servers).toHaveLength(0)
    // Honest caps on the delegated_runtime event: no descriptor, so kunTools
    // unsupported; the agent declared elicitation, so userInput supported.
    const delegated = h.recorded.find((e) => e.kind === 'delegated_runtime')
    const caps = (delegated as { capabilitiesV2?: { statuses: Record<string, { supported: boolean }> } })
      ?.capabilitiesV2?.statuses
    expect(caps?.kunTools?.supported).toBe(false)
    expect(caps?.userInput?.supported).toBe(true)
  })

  test('reports kunTools delivered and userInput absent on a plain agent', async () => {
    const provider = new KunToolsMcpProvider({
      tokens: new HarnessTokenService({ secret: Buffer.alloc(32, 9) }),
      endpoint: () => 'http://127.0.0.1:18899',
      command: () => ({ command: '/abs/kun', args: [] })
    })
    const h = await makeHarness('basic-chat.json', {
      deps: { kunToolsMcp: provider }
    })
    const outcome = await h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal
    )
    expect(outcome).toBe('completed')
    const delegated = h.recorded.find((e) => e.kind === 'delegated_runtime')
    const caps = (delegated as { capabilitiesV2?: { statuses: Record<string, { supported: boolean }> } })
      ?.capabilitiesV2?.statuses
    // basic-chat advertises http MCP → descriptor delivered → supported.
    expect(caps?.kunTools?.supported).toBe(true)
    // The fixture never declares elicitation → userInput stays unsupported.
    expect(caps?.userInput?.supported).toBe(false)
  })

  test('capabilitiesV2 only claims kunTools when descriptors can be served', async () => {
    const tokens = new HarnessTokenService({ secret: Buffer.alloc(32, 9) })
    const serving = new KunToolsMcpProvider({
      tokens,
      endpoint: () => 'http://127.0.0.1:18899',
      command: () => ({ command: '/abs/kun', args: [] })
    })
    const notServing = new KunToolsMcpProvider({
      tokens,
      endpoint: () => undefined,
      command: () => ({ command: '/abs/kun', args: [] })
    })
    const served = await makeHarness('basic-chat.json', {
      deps: { kunToolsMcp: serving }
    })
    expect(served.runtime.capabilitiesV2()?.statuses.kunTools.supported).toBe(true)
    const unserved = await makeHarness('basic-chat.json', {
      deps: { kunToolsMcp: notServing }
    })
    expect(unserved.runtime.capabilitiesV2()?.statuses.kunTools.supported).toBe(false)
    const bare = await makeHarness('basic-chat.json')
    expect(bare.runtime.capabilitiesV2()?.statuses.kunTools.supported).toBe(false)
  })

  test('graph-worker admission rejects an ACP harness that cannot serve MCP', async () => {
    // P3-09: a runtime with no kun-tools provider cannot deliver a
    // descriptor, so graph admission must refuse it with a readable reason.
    const h = await makeHarness('basic-chat.json')
    const verdict = checkHarnessAdmission({
      usage: 'graph-worker',
      harness: h.definition,
      effective: h.runtime.capabilitiesV2()!,
      status: {
        harnessId: h.definition.id,
        installed: 'yes',
        login: 'signed-in',
        checkedAt: new Date().toISOString()
      },
      workspace: { isolated: true },
      unattended: true,
      allowUnattendedFullAccess: true
    })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.code).toBe('capability_missing')
      expect(verdict.missing).toContain('kunTools')
      expect(verdict.message).toContain('serve-hosted runtime')
    }
  })

  test('kun-gateway spawn env strips provider secrets and carries the grant', async () => {
    // P3-10: a gateway-mode child sees the kgw_ grant and the harness's
    // gateway env vars, but never the host's provider credentials.
    process.env.OPENAI_API_KEY = 'sk-test-host-secret'
    process.env.OPENCODE_CONFIG = '/tmp/user-opencode-config.json'
    try {
      const tokens = new HarnessTokenService({ secret: Buffer.alloc(32, 9) })
      const configDir = mkdtempSync(join(tmpdir(), 'acp-gw-'))
      tempDirs.push(configDir)
      let spawnedEnv: Record<string, string | undefined> = {}
      const h = await makeHarness('gateway-model.json', {
        turn: {
          credentialMode: 'kun-gateway',
          model: 'kun/deepseek/deepseek-chat'
        },
        definition: {
          id: 'opencode',
          gateway: BUILTIN_HARNESSES.find((d) => d.id === 'opencode')!.gateway
        },
        deps: {
          credentialEnv: createAcpCredentialEnv({
            tokens,
            endpoint: () => 'http://127.0.0.1:18899',
            configDir: () => configDir
          }),
          spawn: async (command, args, options) => {
            spawnedEnv = options.env as Record<string, string | undefined>
            return spawn(command, [...args], {
              env: options.env as NodeJS.ProcessEnv,
              stdio: options.stdio as ['pipe', 'pipe', 'pipe']
            })
          }
        }
      })
      const outcome = await h.runtime.runTurn(
        'thread_1',
        'turn_1',
        new AbortController().signal
      )
      expect(outcome).toBe('completed')
      expect(h.requests('session/set_config_option')[0]?.params?.value).toBe('kun/deepseek/deepseek-chat')
      expect(spawnedEnv.KUN_GATEWAY_BASE_URL).toBe('http://127.0.0.1:18899/v1')
      expect(spawnedEnv.KUN_GATEWAY_TOKEN?.startsWith('kgw_')).toBe(true)
      expect(spawnedEnv.OPENCODE_CONFIG).toContain(configDir)
      // Host provider secrets and the user's own OPENCODE_CONFIG never leak.
      expect(spawnedEnv.OPENAI_API_KEY).toBeUndefined()
      expect(spawnedEnv.OPENCODE_CONFIG).not.toBe('/tmp/user-opencode-config.json')
      const grant = tokens.verifyScope(spawnedEnv.KUN_GATEWAY_TOKEN, 'gateway')
      expect(grant?.routes).toEqual([
        { providerId: 'deepseek', model: 'deepseek-chat', role: 'main' }
      ])
    } finally {
      delete process.env.OPENAI_API_KEY
      delete process.env.OPENCODE_CONFIG
    }
  })

  test('kun-gateway without a credential resolver fails fast', async () => {
    const h = await makeHarness('basic-chat.json', {
      turn: { credentialMode: 'kun-gateway', model: 'kun/deepseek/deepseek-chat' }
    })
    await expect(
      h.runtime.runTurn('thread_1', 'turn_1', new AbortController().signal)
    ).rejects.toThrow('serve-hosted')
  })
})

// authMethods describes login choices; an existing login can already serve turns.
test('Devin delegates with advertised authentication and narrows the restored mode', async () => {
  const definition = BUILTIN_HARNESSES.find((entry) => entry.id === 'devin')!
  const h = await makeHarness('auth-advertised.json', {
    definition: { id: definition.id, permissionModes: definition.permissionModes },
    turn: { harnessId: 'devin' }, thread: { harnessId: 'devin' }
  })
  const outcome = await h.runtime.runTurn('thread_1', 'turn_1', new AbortController().signal)
  expect(outcome, JSON.stringify(h.finished)).toBe('completed')
  expect(h.requests('authenticate')).toEqual([])
  expect(h.requests('session/set_mode')[0]?.params?.modeId).toBe('normal')
  expect(h.requests('session/prompt')).toHaveLength(1)
  expect(h.deltas.map((entry) => entry.delta).join('')).toBe('Authenticated reply')
})
