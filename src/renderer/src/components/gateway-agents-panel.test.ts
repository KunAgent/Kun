import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create, type ReactTestInstance } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentWiringResult, AgentWiringStatus } from '@shared/agent-wiring'
import i18n from '../i18n'
import { GatewayAgentRow } from './gateway-agent-row'
import { GatewayAgentsPanel } from './gateway-agents-panel'

const base: AgentWiringStatus = { id: 'claude-code', name: 'Claude Code', protocol: 'anthropic', homepage: 'https://x',
  installed: true, configFiles: ['/Users/me/.claude/settings.json'], connected: false, drifted: false,
  efforts: ['low', 'medium', 'high', 'xhigh', 'max'], restartRequired: true, keepsModelList: false, pickInAgent: false }
const models = [{ id: 'coding', displayName: 'Daily coding', contextWindow: 200_000, reasoningLevels: ['low', 'high', 'max'], images: true },
  { id: 'alpha/a1' }]
const text = (node: ReactTestInstance): string => node.children.map((child) => typeof child === 'string' ? child : text(child)).join('')

beforeEach(async () => { await i18n.changeLanguage('en') })

describe('agent rows', () => {
  it('shows status, a shortened config path, model facts and only efforts the model supports', () => {
    const html = renderToStaticMarkup(createElement(GatewayAgentRow, { t: i18n.getFixedT('en', 'settings'), agent: base, models,
      busy: false, disabled: false, onConnect: vi.fn(), onDisconnect: vi.fn() }))
    expect(html).toContain('Not connected')
    expect(html).toContain('~/.claude/settings.json')
    expect(html).toContain('Daily coding · coding')
    expect(html).toContain('200K window')
    expect(html).toContain('value="xhigh"')
    expect(html).not.toContain('value="medium"')
    expect(html).toContain('Fast model for background tasks')
  })
  it('shows the agent\'s own condition for reading Kun settings', () => {
    const html = renderToStaticMarkup(createElement(GatewayAgentRow, { t: i18n.getFixedT('en', 'settings'),
      agent: { ...base, id: 'gemini-cli', name: 'Gemini CLI', notice: 'trusted-folders' }, models, busy: false, disabled: false, onConnect: vi.fn(), onDisconnect: vi.fn() }))
    expect(html).toContain('Gemini CLI reads Kun&#x27;s settings only in folders you have trusted in it.')
  })
  it('flags drift and offers reconnect plus disconnect', () => {
    const html = renderToStaticMarkup(createElement(GatewayAgentRow, { t: i18n.getFixedT('en', 'settings'),
      agent: { ...base, connected: true, drifted: true, model: 'coding' }, models, busy: false, disabled: false, onConnect: vi.fn(), onDisconnect: vi.fn() }))
    expect(html).toContain('Changed outside Kun')
    expect(html).toContain('Reconnect')
    expect(html).toContain('Disconnect')
  })
})

describe('agents panel', () => {
  it('previews the config diff, connects only after confirmation and reports the restart hint', async () => {
    const overview = { origin: 'http://127.0.0.1:18899', gatewayEnabled: true, models, profiles: { Focus: { 'claude-code': { model: 'coding' } } },
      agents: [base, { ...base, id: 'crush', name: 'Crush', installed: false }] }
    const preview = { agentId: 'claude-code', restartRequired: true, files: [{ file: '/Users/me/.claude/settings.json', created: false,
      diff: '@@ -1,3 +1,4 @@\n {\n+  "model": "coding",\n   "theme": "dark"\n }' }] }
    const agentWiring = vi.fn(async (action: { action: string }): Promise<AgentWiringResult> => action.action === 'connect'
      ? { ok: true, notice: 'restart', ...overview, agents: [{ ...base, connected: true, model: 'coding' }, overview.agents[1]!] }
      : action.action === 'preview' ? { ok: true, preview, ...overview } : { ok: true, ...overview })
    ;(globalThis as { window?: unknown }).window = { kunGui: { agentWiring, openExternal: vi.fn() } }
    let renderer!: ReturnType<typeof create>
    await act(async () => { renderer = create(createElement(GatewayAgentsPanel, { active: true })) })
    expect(agentWiring).toHaveBeenCalledWith({ action: 'list' })
    expect(text(renderer.root)).toContain('1 more not found on this computer')
    expect(text(renderer.root)).toContain('Focus')
    const connect = renderer.root.findAll((node) => node.type === 'button' && text(node) === 'Connect')[0]!
    await act(async () => { connect.props.onClick() })
    expect(agentWiring).toHaveBeenCalledWith({ action: 'preview', agentId: 'claude-code', model: 'coding' })
    expect(agentWiring).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'connect' }))
    expect(text(renderer.root)).toContain('Changes Kun will make for Claude Code')
    expect(text(renderer.root)).toContain('~/.claude/settings.json')
    expect(text(renderer.root)).toContain('+  "model": "coding",')
    const apply = renderer.root.findAll((node) => node.type === 'button' && text(node) === 'Apply changes')[0]!
    await act(async () => { apply.props.onClick() })
    expect(agentWiring).toHaveBeenCalledWith({ action: 'connect', agentId: 'claude-code', model: 'coding' })
    expect(text(renderer.root)).not.toContain('Changes Kun will make for Claude Code')
    expect(text(renderer.root)).toContain('Claude Code now uses Kun. Start a new session to pick up the change.')
    expect(text(renderer.root)).toContain('1 connected')
  })
  it('cancels a preview without writing anything', async () => {
    const overview = { origin: 'http://127.0.0.1:18899', gatewayEnabled: true, models, profiles: {}, agents: [base] }
    const agentWiring = vi.fn(async (action: { action: string }): Promise<AgentWiringResult> => action.action === 'preview'
      ? { ok: true, preview: { agentId: 'claude-code', restartRequired: true, files: [] }, ...overview } : { ok: true, ...overview })
    ;(globalThis as { window?: unknown }).window = { kunGui: { agentWiring, openExternal: vi.fn() } }
    let renderer!: ReturnType<typeof create>
    await act(async () => { renderer = create(createElement(GatewayAgentsPanel, { active: true })) })
    await act(async () => { renderer.root.findAll((node) => node.type === 'button' && text(node) === 'Connect')[0]!.props.onClick() })
    expect(text(renderer.root)).toContain("Nothing in this agent's config needs to change.")
    await act(async () => { renderer.root.findAll((node) => node.type === 'button' && text(node) === 'Cancel')[0]!.props.onClick() })
    expect(text(renderer.root)).not.toContain('Changes Kun will make')
    expect(agentWiring).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'connect' }))
  })
  it('explains why connecting is unavailable when the gateway is off', async () => {
    const agentWiring = vi.fn(async (): Promise<AgentWiringResult> => ({ ok: true, origin: 'http://x', gatewayEnabled: false, models: [], profiles: {}, agents: [base] }))
    ;(globalThis as { window?: unknown }).window = { kunGui: { agentWiring, openExternal: vi.fn() } }
    let renderer!: ReturnType<typeof create>
    await act(async () => { renderer = create(createElement(GatewayAgentsPanel, { active: true })) })
    expect(text(renderer.root)).toContain('Turn on the local API above before connecting agents.')
    const connect = renderer.root.findAll((node) => node.type === 'button' && text(node) === 'Connect')[0]!
    expect(connect.props.disabled).toBe(true)
  })
})
