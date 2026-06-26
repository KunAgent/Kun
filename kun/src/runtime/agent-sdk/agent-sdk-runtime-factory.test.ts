import { describe, expect, test } from 'vitest'
import { createAgentSdkRuntime } from './agent-sdk-runtime-factory.js'

// handlesProvider only reads providerConfigs / agentSdkProviderIds / defaultIsAgentSdk,
// so the heavy service deps can be stubbed for this routing test.
function make(opts: { agentSdk: string[]; http: string[]; defaultIsAgentSdk: boolean }): {
  handlesProvider(id: string | undefined): boolean
} {
  const providerConfigs: Record<string, { baseUrl?: string; apiKey: string; kind?: 'http' | 'agent-sdk' }> = {}
  for (const id of opts.agentSdk) providerConfigs[id] = { kind: 'agent-sdk', apiKey: 'tok' }
  for (const id of opts.http) providerConfigs[id] = { baseUrl: 'https://x', apiKey: 'key' }
  return createAgentSdkRuntime({
    registry: {} as never,
    turns: {} as never,
    sessionStore: {} as never,
    threadStore: {} as never,
    events: {} as never,
    ids: { next: (p: string) => p },
    prefix: { systemPrompt: '' },
    providerConfigs: providerConfigs as never,
    agentSdkProviderIds: new Set(opts.agentSdk),
    defaultApprovalPolicy: 'auto',
    defaultIsAgentSdk: opts.defaultIsAgentSdk,
    defaultToken: 'tok'
  })
}

describe('createAgentSdkRuntime handlesProvider', () => {
  test('claims only explicit agent-sdk providers when default is not agent-sdk', () => {
    const r = make({ agentSdk: ['claude-subscription'], http: ['deepseek'], defaultIsAgentSdk: false })
    expect(r.handlesProvider('claude-subscription')).toBe(true)
    expect(r.handlesProvider('deepseek')).toBe(false)
    expect(r.handlesProvider(undefined)).toBe(false)
  })

  test('when the default provider is agent-sdk, also claims absent/default providerId', () => {
    const r = make({ agentSdk: ['claude-subscription'], http: ['deepseek'], defaultIsAgentSdk: true })
    expect(r.handlesProvider(undefined)).toBe(true) // default turn → SDK (the reported 401 case)
    expect(r.handlesProvider('claude-subscription')).toBe(true)
    expect(r.handlesProvider('deepseek')).toBe(false) // an explicit HTTP provider stays HTTP
  })
})
