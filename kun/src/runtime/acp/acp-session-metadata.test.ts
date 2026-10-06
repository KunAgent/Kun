import { spawn } from 'node:child_process'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import type { TurnItem } from '../../contracts/items.js'
import { DelegatedSessionCoordinator, FileDelegatedSessionBindingStore } from '../delegated-session-binding.js'
import { AcpSessionManager } from './acp-session-manager.js'
import { AcpConnection } from './acp-connection.js'
import { startAcpProcess } from './acp-process.js'

const executable = fileURLToPath(new URL('./__fixtures__/fake-acp-agent.mjs', import.meta.url))
const item = (turnId: string): TurnItem => ({ id: `user-${turnId}`, threadId: 'thread', turnId, role: 'user',
  kind: 'user_message', status: 'completed', text: turnId, createdAt: '2026-10-06T00:00:00.000Z' })
const option = (currentValue: string) => ({ id: 'permission', name: 'Permission', category: 'mode', type: 'select',
  currentValue, options: [{ value: 'plan', name: 'Plan' }, { value: 'bypass', name: 'Bypass' }] })

it.each(['fresh', 'restored'] as const)('keeps %s first-turn mode/config updates authoritative before the next prompt', async (kind) => {
  const directory = await mkdtemp(join(tmpdir(), 'kun-acp-metadata-'))
  const connections: AcpConnection[] = []
  try {
    const journal = join(directory, 'journal.jsonl'), scenario = join(directory, 'scenario.json')
    await writeFile(scenario, JSON.stringify({ sessionId: 'native-session',
      initialize: { protocolVersion: 1, agentCapabilities: { loadSession: true }, authMethods: [] },
      newSession: { configOptions: [option('plan')], modes: { currentModeId: 'plan', availableModes: [{ id: 'plan' }, { id: 'bypass' }] } },
      loadSession: { configOptions: [option('plan')], modes: { currentModeId: 'plan', availableModes: [{ id: 'plan' }, { id: 'bypass' }] } },
      turns: [{ steps: [
        { update: { sessionUpdate: 'current_mode_update', currentModeId: 'bypass' } },
        { update: { sessionUpdate: 'config_option_update', configOptions: [option('bypass')] } }
      ], stopReason: 'end_turn' }, { steps: [], stopReason: 'end_turn' }] }))
    const connect = async () => {
      const process = await startAcpProcess({ command: globalThis.process.execPath, args: [executable],
        env: { FAKE_ACP_SCENARIO: scenario, FAKE_ACP_JOURNAL: journal },
        spawn: async (command, args, options) => spawn(command, [...args], { env: options.env as NodeJS.ProcessEnv, stdio: ['pipe', 'pipe', 'pipe'] }) })
      const conn = AcpConnection.start({ process, identity: 'credentials' }); connections.push(conn)
      await conn.initialize(); return conn
    }
    const manager = new AcpSessionManager({ coordinator: new DelegatedSessionCoordinator(new FileDelegatedSessionBindingStore(directory)) })
    const ctx = { threadId: 'thread', turnId: 'first', workspacePath: directory, harnessId: 'fixture', permissionModeId: 'plan', items: [] as TurnItem[] }
    let conn = await connect()
    if (kind === 'restored') {
      const seeded = await manager.ensureSession({ ...ctx, turnId: 'seed' }, conn)
      ctx.items.push(item('seed'))
      await manager.commit(seeded, { committedItems: ctx.items, lastCommittedTurnId: 'seed' })
      seeded.detach(); await conn.close(); conn = await connect()
    }
    const first = await manager.ensureSession(ctx, conn)
    await conn.rpc.request('session/prompt', { sessionId: first.sessionId, prompt: [{ type: 'text', text: 'first' }] })
    expect(first.modes?.currentModeId).toBe('bypass')
    expect(first.configOptions?.[0]).toMatchObject({ currentValue: 'bypass' })
    ctx.items.push(item('first'))
    await manager.commit(first, { committedItems: ctx.items, lastCommittedTurnId: 'first' }); first.detach()
    const second = await manager.ensureSession({ ...ctx, turnId: 'second' }, conn)
    expect(second.sessionId).toBe(first.sessionId)
    expect(second.configOptions?.[0]).toMatchObject({ currentValue: 'plan' })
    await conn.rpc.request('session/prompt', { sessionId: second.sessionId, prompt: [{ type: 'text', text: 'second' }] })
    const frames = (await readFile(journal, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line))
      .filter((entry) => entry.dir === 'in').map((entry) => entry.frame)
    const mutations = frames.filter((frame) => frame.method === 'session/set_config_option')
    expect(mutations).toHaveLength(1)
    expect(mutations[0].params).toMatchObject({ configId: 'permission', value: 'plan' })
    expect(frames.indexOf(mutations[0])).toBeLessThan(frames.map((frame) => frame.method).lastIndexOf('session/prompt'))
    expect(frames.filter((frame) => frame.method === 'session/load')).toHaveLength(kind === 'restored' ? 1 : 0)
    second.detach()
  } finally { for (const conn of connections) await conn.close(); await rm(directory, { recursive: true, force: true }) }
})
