import { expect, it, vi } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SkillRuntime } from '../../skills/skill-runtime.js'
import { SkillsCapabilityConfig, McpCapabilityConfig } from '../../contracts/capabilities.js'
import type { RuntimeToolDiagnostics } from '../../server/routes/server-runtime.js'
import { agentWorkspace } from '../../agents/agent-direct-runner.js'
import { agentHistoryFixture } from './memory/history.test-support.js'
import { RemoteAgentCatalog } from './catalog.js'
import { AgentAppearanceParams } from './appearance-contracts.js'
const scope = { accountId: 'owner', deviceId: 'phone', authorizationId: 'grant' }
async function skill(root: string, id: string) {
  const folder = join(root, id); await mkdir(folder, { recursive: true })
  await writeFile(join(folder, 'skill.json'), JSON.stringify({ id, name: id, description: 'PRIVATE_DESCRIPTION', triggers: { commands: ['/' + id] } }))
  await writeFile(join(folder, 'SKILL.md'), 'PRIVATE_SKILL_BODY')
}
it('uses the real workspace skill runtime/global/project filters and Agent ceiling, returning only eligible labels and opaque refs', async () => {
  const f = await agentHistoryFixture()
  try {
    const global = join(f.root, 'global-skills'), workspace = agentWorkspace(f.root, f.agent.id)
    for (const id of ['visible', 'agent-denied', 'globally-disabled']) await skill(global, id)
    await skill(join(workspace, '.agents', 'skills'), 'local-visible')
    const runtime = await SkillRuntime.create(SkillsCapabilityConfig.parse({ enabled: true, globalRoots: [global], disabledIds: ['globally-disabled'], projectConfigEnabled: true }))
    f.runtime.skills = (path) => runtime.diagnosticsForWorkspace(path!)
    await f.rooms.agents.update(f.agent.id, { clientRequestId: 'limit', expectedRevision: 0, capabilityOverrides: { blockedSkills: ['agent-denied'] } })
    const catalog = new RemoteAgentCatalog(f.runtime), p = AgentAppearanceParams['agent.skills.list'].parse({ agentId: f.agent.id, limit: 1 })
    const first = await catalog.list('agent.skills.list', p, scope)
    expect(first).toMatchObject({ appliesTo: 'next_api_turn', editable: false, hasMore: true, complete: false })
    const next = await catalog.list('agent.skills.list', { ...p, cursor: first.nextCursor }, scope)
    expect([...first.items, ...next.items].map((entry) => entry.name).sort()).toEqual(['local-visible', 'visible'])
    for (const entry of [...first.items, ...next.items]) { expect(entry.ref).toMatch(/^[a-f0-9]{64}$/); expect(entry.status).toBe('available') }
    for (const hidden of ['PRIVATE_DESCRIPTION', 'PRIVATE_SKILL_BODY', 'entryPath', 'globalRoots', f.root]) expect(JSON.stringify([first, next])).not.toContain(hidden)
    await expect(catalog.list('agent.skills.list', { ...p, cursor: first.nextCursor }, { ...scope, deviceId: 'other' })).rejects.toThrow('INVALID_CURSOR')
    await f.rooms.agents.update(f.agent.id, { clientRequestId: 'off', expectedRevision: 1, capabilityOverrides: { skillsEnabled: false } })
    expect(await catalog.list('agent.skills.list', p, scope)).toMatchObject({ enabled: false, items: [] })
  } finally { await f.close() }
})
it('lists only authorized visible/trusted MCP connections under the current Agent/API policy and strips credentials/URLs/errors', async () => {
  const f = await agentHistoryFixture()
  try {
    const ids = ['allowed', 'unauthorized', 'agent-denied', 'other-workspace', 'untrusted']
    const config = McpCapabilityConfig.parse({ enabled: true, servers: Object.fromEntries(ids.map((id) => [id, {
      enabled: true, transport: 'streamable-http', url: 'https://PRIVATE_HOST.invalid/mcp', trustScope: 'user', headers: { Authorization: 'PRIVATE_TOKEN' },
      env: { SECRET: 'PRIVATE_ENV' }, oauth: { enabled: true }, ...(id === 'other-workspace' ? { workspaceRoots: ['/PRIVATE_WORKSPACE'] } : {}),
      ...(id === 'untrusted' ? { trustScope: 'workspace', trustedWorkspaceRoots: ['/PRIVATE_TRUST'] } : {})
    }])) })
    f.runtime.mcpConfig = () => config
    f.runtime.mcpOAuth = async () => ids.map((serverId) => ({ serverId, status: serverId === 'unauthorized' ? 'empty' : 'authorized', url: 'https://PRIVATE_OAUTH.invalid', lastError: 'PRIVATE_ERROR' })) as any
    f.runtime.toolDiagnostics = async () => ({ providers: [{ id: 'mcp:facade', kind: 'mcp', enabled: true, available: true }],
      mcpServers: ids.map((id) => ({ id, enabled: true, available: true, status: 'connected', serverInfo: { name: 'Public ' + id }, toolNames: ['tool_' + id], lastError: 'PRIVATE_ERROR' })) }) as RuntimeToolDiagnostics
    await f.rooms.agents.update(f.agent.id, { clientRequestId: 'deny', expectedRevision: 0, capabilityOverrides: { blockedMcpServers: ['agent-denied'] } })
    const result = await new RemoteAgentCatalog(f.runtime).list('agent.connections.list', { agentId: f.agent.id, limit: 20 }, scope)
    expect(result).toMatchObject({ editable: false, appliesTo: 'next_api_turn', items: [{ name: 'Public allowed', status: 'connected', available: true }] })
    for (const hidden of ['PRIVATE_HOST', 'PRIVATE_TOKEN', 'PRIVATE_ENV', 'PRIVATE_OAUTH', 'PRIVATE_ERROR', 'PRIVATE_WORKSPACE', 'PRIVATE_TRUST', 'headers', 'toolNames']) expect(JSON.stringify(result)).not.toContain(hidden)
  } finally { await f.close() }
})
it('bounds hung native reads by deadline and retains their real work slots until settlement', async () => {
  const f = await agentHistoryFixture()
  try {
    f.runtime.skills = () => new Promise(() => {})
    vi.useFakeTimers()
    const catalog = new RemoteAgentCatalog(f.runtime), p = { agentId: f.agent.id, limit: 20 }
    const first = expect(catalog.list('agent.skills.list', p, scope)).rejects.toThrow('AGENT_CATALOG_UNAVAILABLE')
    await vi.advanceTimersByTimeAsync(5000); await first
    const second = expect(catalog.list('agent.skills.list', p, scope)).rejects.toThrow('AGENT_CATALOG_UNAVAILABLE')
    await vi.advanceTimersByTimeAsync(5000); await second
    await expect(catalog.list('agent.skills.list', p, scope)).rejects.toThrow('AGENT_CATALOG_BUSY')
  } finally { vi.useRealTimers(); await f.close() }
})
