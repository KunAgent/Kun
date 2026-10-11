import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { agentAdapter } from './adapters.js'
import { getJsoncValue } from './edit/jsonc.js'
import { createWiringContext } from './service.js'
import { KEY, ORIGIN, wiringHarness, wiringTarget, type WiringHarness } from './wiring-test-support.js'

let h: WiringHarness
beforeEach(() => { h = wiringHarness() })
afterEach(() => h.dispose())

describe('Claude Code adapter', () => {
  it('follows CLAUDE_CONFIG_DIR and names every Kun-owned slot', () => {
    const custom = wiringHarness({ CLAUDE_CONFIG_DIR: '/tmp/claude-profile' })
    const adapter = agentAdapter('claude-code')!
    const ctx = createWiringContext({ home: custom.home, env: { CLAUDE_CONFIG_DIR: '/tmp/claude-profile' }, which: () => undefined })
    expect(adapter.files(ctx).settings).toBe(join('/tmp/claude-profile', 'settings.json'))
    const paths = adapter.edits(ctx, wiringTarget('coding', { effort: 'max' })).map((edit) => JSON.stringify((edit.slot as { path: string[] }).path))
    expect(paths).toEqual(expect.arrayContaining(['["env","ANTHROPIC_BASE_URL"]', '["env","ANTHROPIC_AUTH_TOKEN"]', '["env","ANTHROPIC_API_KEY"]',
      '["apiKeyHelper"]', '["model"]', '["env","CLAUDE_CODE_EFFORT_LEVEL"]', '["effortLevel"]']))
    custom.dispose()
  })
  it('reports gateway, elsewhere and missing configs', () => {
    const adapter = agentAdapter('claude-code')!
    const ctx = createWiringContext({ home: h.home, env: {}, which: () => undefined })
    expect(adapter.inspect(ctx, () => '', ORIGIN)).toEqual({ pointsAtGateway: false })
    expect(adapter.inspect(ctx, () => '{"env":{"ANTHROPIC_BASE_URL":"https://api.anthropic.com"},"model":"opus"}', ORIGIN))
      .toEqual({ pointsAtGateway: false, model: 'opus' })
    expect(adapter.inspect(ctx, () => `{"env":{"ANTHROPIC_BASE_URL":"${ORIGIN}","ANTHROPIC_AUTH_TOKEN":"${KEY}"},"model":"coding"}`, ORIGIN))
      .toEqual({ pointsAtGateway: true, model: 'coding', key: KEY })
  })
  it('sends max through the environment variable that outranks /effort', () => {
    const file = h.write('.claude/settings.json', '{ "effortLevel": "low" }\n')
    h.service.connect('claude-code', wiringTarget('coding', { effort: 'max' }))
    expect(getJsoncValue(h.read(file), ['effortLevel'])).toBeUndefined()
    expect(getJsoncValue(h.read(file), ['env', 'CLAUDE_CODE_EFFORT_LEVEL'])).toBe('max')
    h.service.disconnect('claude-code', ORIGIN)
    expect(h.read(file)).toBe('{ "effortLevel": "low" }\n')
  })
})
