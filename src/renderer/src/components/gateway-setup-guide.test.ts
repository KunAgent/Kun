import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { buildGatewayConnectExample, gatewayConnectBaseUrl, gatewayConnectEnv } from './gateway-connect-examples'
import { GatewaySetupGuide } from './gateway-setup-guide'

const t = i18n.getFixedT('en', 'settings')
const guide = (overrides: Partial<Parameters<typeof GatewaySetupGuide>[0]> = {}): string => renderToStaticMarkup(createElement(GatewaySetupGuide, {
  t, address: 'http://127.0.0.1:18899/v1', enabled: false, keyReady: false, models: [], sharing: false, agents: 0, pending: false,
  onEnable: vi.fn(), onShareModels: vi.fn(), onCreateRoute: vi.fn(), onChooseAgent: vi.fn(), ...overrides
}))

beforeEach(async () => { await i18n.changeLanguage('en') })

describe('gateway connect examples', () => {
  it('gives OpenAI clients the /v1 prefix and Anthropic or Gemini clients the bare origin', () => {
    expect(gatewayConnectBaseUrl('http://127.0.0.1:18899/', 'chat')).toBe('http://127.0.0.1:18899/v1')
    expect(gatewayConnectBaseUrl('http://127.0.0.1:18899/v1', 'responses')).toBe('http://127.0.0.1:18899/v1')
    expect(gatewayConnectBaseUrl('http://127.0.0.1:18899/v1', 'anthropic')).toBe('http://127.0.0.1:18899')
    expect(gatewayConnectBaseUrl('http://127.0.0.1:18899', 'gemini')).toBe('http://127.0.0.1:18899')
    expect(gatewayConnectEnv('anthropic')).toEqual({ baseUrl: 'ANTHROPIC_BASE_URL', key: 'ANTHROPIC_AUTH_TOKEN' })
  })

  it('quotes the key placeholder and model ids so pasted snippets stay valid', () => {
    const origin = 'http://127.0.0.1:18899'
    const shell = buildGatewayConnectExample({ format: 'anthropic', kind: 'shell', origin, modelId: "it's/model", t })
    expect(shell).toContain("export ANTHROPIC_BASE_URL='http://127.0.0.1:18899'")
    expect(shell).toContain("export ANTHROPIC_AUTH_TOKEN='<LOCAL_GATEWAY_API_KEY>'")
    expect(shell).toContain(`export ANTHROPIC_MODEL='it'"'"'s/model'`)
    expect(buildGatewayConnectExample({ format: 'chat', kind: 'python', origin, modelId: 'my"model', t })).toContain('model="my\\"model"')
    expect(buildGatewayConnectExample({ format: 'gemini', kind: 'curl', origin, modelId: 'coding', t }))
      .toContain("'http://127.0.0.1:18899/v1beta/models/coding:generateContent'")
    expect(buildGatewayConnectExample({ format: 'responses', kind: 'curl', origin, modelId: 'coding', t })).toContain('/v1/responses')
    expect(buildGatewayConnectExample({ format: 'anthropic', kind: 'curl', origin, modelId: 'coding', t })).toContain('/v1/messages')
  })
})

describe('gateway setup guide', () => {
  it('walks a fresh gateway through turning on, models and agents', () => {
    const html = guide()
    expect(html).toContain('Turn on the local gateway')
    expect(html).toContain('Serves at http://127.0.0.1:18899/v1')
    expect(html).toContain('Share provider models')
    expect(html).toContain('New routed model')
    expect(html).toContain('Choose an agent')
  })

  it('marks finished steps, names the available models and disappears when all are done', () => {
    const html = guide({ enabled: true, keyReady: true, models: ['coding', 'fast', 'deepseek/chat', 'extra'], sharing: true })
    expect(html).toContain('data-gateway-step="1" data-done="true"')
    expect(html).toContain('Models available (4): coding, fast, deepseek/chat …')
    expect(html).not.toContain('Share provider models')
    expect(html).toContain('data-gateway-step="3" data-done="false"')
    expect(guide({ enabled: true, keyReady: true, models: ['coding'], agents: 1 })).toBe('')
  })
})
