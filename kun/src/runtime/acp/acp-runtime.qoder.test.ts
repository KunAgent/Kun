import { spawn } from 'node:child_process'
import { expect, it, vi } from 'vitest'
import { kunToolPermissionModeSettings } from '../../contracts/policy.js'
import type { TurnItem } from '../../contracts/items.js'
import type { AcpSpawnFn } from './acp-process.js'
import { AcpConnectionPool } from './acp-connection-pool.js'
import { HarnessCatalog } from '../../harness/harness-catalog.js'
import { makeHarness, type Harness } from '../../../tests/helpers/acp-runtime-test-support.js'

// Reproduce Qoder's startup modes and broken setters through a real stdio process.
const agent = `
const fs = require('node:fs');
const rl = require('node:readline').createInterface({ input: process.stdin });
const send = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\\n');
const metadata = mode => mode === 'missing' ? {} : { configOptions: [{
  id: 'mode', name: 'Mode', category: 'mode', type: 'select', currentValue: mode,
  options: ['default','yolo'].map(value => ({ value, name: value }))
}] };
rl.on('line', line => {
  const r = JSON.parse(line);
  fs.appendFileSync(process.env.FAKE_ACP_JOURNAL, JSON.stringify({dir:'in',frame:r})+'\\n');
  if (r.id === undefined) return;
  if (['session/set_config_option','session/set_mode'].includes(r.method)) {
    send({id:r.id,error:{code:-32603,message:'Internal error',data:{details:'unknown permission_mode: yolo'}}});return;
  }
  let result = {};
  if (r.method === 'initialize') result = {protocolVersion:1,agentCapabilities:{loadSession:true}};
  if (r.method === 'session/new') result = {sessionId:'qoder-fixture',...metadata(process.env.TEST_MODE)};
  if (r.method === 'session/load') result = metadata(process.env.TEST_LOAD_MODE || process.env.TEST_MODE);
  if (r.method === 'session/prompt') {
    send({method:'session/update',params:{sessionId:r.params.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'ok'}}}});
    result = {stopReason:'end_turn'};
  }
  send({id:r.id,result});
});
`
const qoder = new HarnessCatalog({ custom: () => [] }).get('qoder')!
function nextTurn(h: Harness, id: string, full: boolean) {
  h.thread.turns.push({ id, harnessId: 'qoder', ...kunToolPermissionModeSettings(full ? 'full-access' : 'ask-for-approval') })
  h.items.push({ id: `user-${id}`, threadId: 'thread_1', turnId: id, role: 'user', kind: 'user_message',
    status: 'completed', text: 'continue', createdAt: '2026-01-01T00:01:00.000Z' } as TurnItem)
}
async function setup(pool: AcpConnectionPool, loadMode?: string, permissionMode?: string) {
  const spawnAgent = vi.fn<AcpSpawnFn>(async (_command, args, options) => {
    const mode = args.at(-1)
    return spawn(process.execPath, ['-e', agent], { stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...options.env, TEST_MODE: mode === 'bypass_permissions' ? 'yolo' : 'default', TEST_LOAD_MODE: loadMode } })
  })
  const h = await makeHarness('resume.json', {
    definition: { id: 'qoder', permissionModes: qoder.permissionModes, acpPermission: qoder.acpPermission },
    turn: { harnessId: 'qoder', ...kunToolPermissionModeSettings('full-access') },
    thread: { harnessId: 'qoder' }, deps: { connectionPool: pool, spawn: spawnAgent, harnessDefaults: () => ({ permissionMode }) }
  })
  return { h, spawnAgent }
}

it('uses resolved startup permissions, reuses same-mode processes and separates permission changes', async () => {
  const pool = new AcpConnectionPool({ idleReleaseMs: 60_000 })
  try {
    const { h, spawnAgent } = await setup(pool)
    const run = (id: string) => h.runtime.runTurn('thread_1', id, new AbortController().signal)
    expect(await run('turn_1')).toBe('completed')
    expect(spawnAgent.mock.calls[0][1].slice(-2)).toEqual(['--permission-mode', 'bypass_permissions'])
    nextTurn(h, 'turn_2', true)
    expect(await run('turn_2')).toBe('completed')
    expect(spawnAgent).toHaveBeenCalledTimes(1)
    nextTurn(h, 'turn_3', false)
    expect(await run('turn_3')).toBe('completed')
    expect(spawnAgent).toHaveBeenCalledTimes(2)
    expect(spawnAgent.mock.calls[1][1].slice(-2)).toEqual(['--permission-mode', 'default'])
    nextTurn(h, 'turn_4', true)
    expect(await run('turn_4')).toBe('completed')
    expect(spawnAgent).toHaveBeenCalledTimes(3)
    expect(h.requests('session/prompt')).toHaveLength(4)
    expect(h.requests('session/set_config_option')).toHaveLength(0)
  } finally { await pool.dispose() }
})

it.each(['yolo', 'default', 'missing'])('validates restored %s metadata before allowing a prompt', async loadMode => {
  const pool = new AcpConnectionPool({ idleReleaseMs: 60_000 })
  try {
    const { h, spawnAgent } = await setup(pool, loadMode, 'yolo')
    expect(await h.runtime.runTurn('thread_1', 'turn_1', new AbortController().signal)).toBe('completed')
    // Force the next turn onto a replacement process, retaining its committed session binding.
    await pool.retireIdlePrefix('', 'no-connection')
    nextTurn(h, 'turn_2', true)
    expect(await h.runtime.runTurn('thread_1', 'turn_2', new AbortController().signal)).toBe(loadMode === 'yolo' ? 'completed' : 'failed')
    expect(spawnAgent).toHaveBeenCalledTimes(2)
    expect(h.requests('session/load')).toHaveLength(1)
    expect(h.requests('session/prompt')).toHaveLength(loadMode === 'yolo' ? 2 : 1)
    expect(h.requests('session/new')).toHaveLength(1)
  } finally { await pool.dispose() }
})
