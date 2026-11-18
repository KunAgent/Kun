import { spawn } from 'node:child_process'
import { expect, it, vi } from 'vitest'
import { kunToolPermissionModeSettings } from '../../contracts/policy.js'
import { HarnessCatalog } from '../../harness/harness-catalog.js'
import { HarnessTokenService } from '../../harness/harness-token-service.js'
import type { AcpSpawnFn } from './acp-process.js'
import { AcpConnectionPool } from './acp-connection-pool.js'
import { KunToolsMcpProvider } from './kun-tools-mcp.js'
import { makeHarness } from '../../../tests/helpers/acp-runtime-test-support.js'

// Reproduces `agy acp` 1.5.9 wire behavior: `mcpCapabilities` omitted on
// initialize, modern `configOptions` (model / thought_level / mode), live
// `usage_update` occupancy, and exact `PromptResponse.usage`.
const agyAcpScript = `
const fs = require('node:fs');
const rl = require('node:readline').createInterface({ input: process.stdin });
const send = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\\n');
let model = 'gemini-4-carbon';
let thought = 'medium';
let mode = 'default';
const configOptions = () => ([
  {
    id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: model,
    options: [
      { value: 'gemini-4-carbon', name: 'Gemini 4 Carbon' },
      { value: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' },
      { value: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
      { value: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)' }
    ]
  },
  {
    id: 'thought_level', name: 'Thinking Level', category: 'thought_level', type: 'select', currentValue: thought,
    options: ['low', 'medium', 'high'].map(value => ({ value, name: value }))
  },
  {
    id: 'mode', name: 'Mode', category: 'mode', type: 'select', currentValue: mode,
    options: ['default', 'accept-edits', 'auto', 'plan'].map(value => ({ value, name: value }))
  }
]);
rl.on('line', line => {
  const r = JSON.parse(line);
  fs.appendFileSync(process.env.FAKE_ACP_JOURNAL, JSON.stringify({ dir: 'in', frame: r }) + '\\n');
  if (r.id === undefined) return;
  if (r.method === 'initialize') {
    send({ id: r.id, result: {
      protocolVersion: 1,
      agentCapabilities: { loadSession: true, promptCapabilities: { image: true, embeddedContext: true } },
      agentInfo: { name: 'Antigravity ACP Server', version: '1.5.9' }
    } });
    return;
  }
  if (r.method === 'session/new') {
    send({ id: r.id, result: { sessionId: 'agy-session-1', configOptions: configOptions() } });
    return;
  }
  if (r.method === 'session/set_config_option') {
    if (r.params.configId === 'model') model = r.params.value;
    if (r.params.configId === 'thought_level') thought = r.params.value;
    if (r.params.configId === 'mode') mode = r.params.value;
    send({ id: r.id, result: { configOptions: configOptions() } });
    return;
  }
  if (r.method === 'session/prompt') {
    const sessionId = r.params.sessionId;
    send({ method: 'session/update', params: { sessionId, update: {
      sessionUpdate: 'tool_call', toolCallId: 'call_git', name: 'mcp_kun-tools_git_inspect', title: 'Check Git',
      kind: 'other', status: 'completed', rawInput: { sessionId: 'not-the-native-session', operation: 'status' }
    } } });
    send({ method: 'session/update', params: { sessionId, update: {
      sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Design canvas opened.' }
    } } });
    send({ method: 'session/update', params: { sessionId, update: {
      sessionUpdate: 'usage_update', used: 12798, size: 1048576
    } } });
    send({ id: r.id, result: {
      stopReason: 'end_turn',
      usage: { inputTokens: 12797, outputTokens: 1, cachedReadTokens: 0, cachedWriteTokens: 0, thoughtTokens: 0, totalTokens: 12798 }
    } });
  }
});
`

it('runs Antigravity over ACP with kun-tools MCP injection, model normalization, and exact telemetry', async () => {
  const pool = new AcpConnectionPool({ idleReleaseMs: 60_000 })
  let journalPath = ''
  const spawnAgent = vi.fn<AcpSpawnFn>(async (_command, _args, options) =>
    spawn(process.execPath, ['-e', agyAcpScript], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...options.env, FAKE_ACP_JOURNAL: journalPath }
    })
  )
  const kunToolsMcp = new KunToolsMcpProvider({
    tokens: new HarnessTokenService(),
    endpoint: () => 'http://127.0.0.1:18899',
    command: () => ({ command: process.execPath, args: ['kun-entry.js'] })
  })
  const antigravity = new HarnessCatalog({ custom: () => [] }).get('antigravity')!
  const h = await makeHarness('resume.json', {
    definition: antigravity,
    turn: {
      harnessId: 'antigravity',
      model: 'models/gemini-3.8-flash-high',
      ...kunToolPermissionModeSettings('full-access')
    },
    thread: { harnessId: 'antigravity' },
    deps: { connectionPool: pool, spawn: spawnAgent, kunToolsMcp }
  })
  journalPath = h.journalPath
  try {
    expect(await h.runtime.runTurn('thread_1', 'turn_1', new AbortController().signal)).toBe('completed')
    expect(spawnAgent).toHaveBeenCalledTimes(1)
    expect(spawnAgent.mock.calls[0]?.[0]).toBe('agy')
    expect(spawnAgent.mock.calls[0]?.[1]).toEqual(['acp'])

    const sessionNew = h.requests('session/new')[0]?.params as { mcpServers?: Array<{ name: string; args?: string[] }> }
    expect(sessionNew?.mcpServers).toEqual([
      expect.objectContaining({
        name: 'kun-tools',
        args: expect.arrayContaining(['mcp-bridge', '--token-env', 'KUN_TOOLS_TOKEN'])
      })
    ])

    expect(h.requests('session/set_config_option').map((entry) => entry.params)).toEqual([
      { sessionId: 'agy-session-1', configId: 'model', value: 'gemini-3.8-flash' },
      { sessionId: 'agy-session-1', configId: 'mode', value: 'auto' },
      { sessionId: 'agy-session-1', configId: 'thought_level', value: 'high' }
    ])

    expect(h.recorded).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'tool_call_finished', item: expect.objectContaining({
        callId: 'call_git', meta: expect.objectContaining({ acpOutputLocator: { harnessId: 'antigravity', sessionId: 'agy-session-1' } })
      }) }),
      expect.objectContaining({
        kind: 'delegated_runtime',
        harnessId: 'antigravity',
        providerKind: 'acp',
        capabilities: expect.objectContaining({ kunTools: true })
      }),
      expect.objectContaining({
        kind: 'context_snapshot',
        contextWindowTokens: 1_048_576,
        estimatedInputTokens: 12_798
      }),
      expect.objectContaining({
        kind: 'usage',
        harnessId: 'antigravity',
        source: 'harness-reported',
        usage: expect.objectContaining({ promptTokens: 12_797, completionTokens: 1, totalTokens: 12_798 })
      })
    ]))
  } finally {
    await pool.dispose()
  }
})
