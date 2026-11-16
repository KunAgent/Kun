import { describe, expect, it, vi } from 'vitest'
import { AcpError } from './acp-schema.js'
import type { AcpConnection } from './acp-connection.js'
import type { DelegatedSessionCoordinator } from '../delegated-session-binding.js'
import { AcpSessionManager, type AcpSessionHandle } from './acp-session-manager.js'
import { acpLegacyVariantModel, applyAcpLegacyModel, applyAcpSessionModel } from './acp-legacy-models.js'
import type { AcpConfigOption } from './acp-schema.js'

function connection(request = vi.fn(async () => ({}))) {
  return { conn: { rpc: { request } } as unknown as AcpConnection, request }
}
const session = () => ({
  sessionId: 'session', models: { currentModelId: 'one', availableModels: ['one', 'two'] }
})

describe('ACP legacy model selection', () => {
  it('keeps Agent default when no model was requested, without pretending to select one', async () => {
    const { conn, request } = connection()
    await applyAcpLegacyModel(conn, { sessionId: 'session' }, undefined)
    await applyAcpLegacyModel(conn, session(), 'one')
    expect(request).not.toHaveBeenCalled()
  })

  it('rejects a requested model if no legacy selector exists', async () => {
    const { conn, request } = connection()
    await expect(applyAcpLegacyModel(conn, { sessionId: 'session' }, 'two'))
      .rejects.toMatchObject({ code: 'agent_error', message: expect.stringContaining('Agent default') })
    expect(request).not.toHaveBeenCalled()
  })

  it('surfaces a missing set_model method and does not mark the requested model current', async () => {
    const { conn } = connection(vi.fn(async () => {
      throw new AcpError('agent_error', 'Method not found', { rpcCode: -32601 })
    }))
    const state = session()
    await expect(applyAcpLegacyModel(conn, state, 'two'))
      .rejects.toMatchObject({ code: 'agent_error', message: expect.stringContaining('does not support') })
    expect(state.models.currentModelId).toBe('one')
  })

  it('preserves cancellation and authentication errors from legacy selection', async () => {
    for (const error of [new AcpError('request_aborted', 'Cancelled'), new AcpError('agent_error', 'Login required', { rpcCode: -32000 })]) {
      const { conn } = connection(vi.fn(async () => { throw error }))
      await expect(applyAcpLegacyModel(conn, session(), 'two')).rejects.toBe(error)
    }
  })

  it('prefers modern model config options even when a legacy model list is present', async () => {
    const { conn, request } = connection()
    const manager = new AcpSessionManager({ coordinator: {} as DelegatedSessionCoordinator })
    const state = { ...session(), configOptions: [{ id: 'model', category: 'model', type: 'select',
      currentValue: 'one', options: [{ value: 'one', name: 'One' }, { value: 'two', name: 'Two' }] }] } as AcpSessionHandle
    await manager.applyConfigOptions(conn, state, {
      threadId: 'thread', turnId: 'turn', workspacePath: '/tmp', harnessId: 'custom-agent', model: 'two', items: []
    })
    expect(request).toHaveBeenCalledExactlyOnceWith('session/set_config_option', {
      sessionId: 'session', configId: 'model', value: 'two'
    })
  })

  it('maps a reasoning level onto the advertised legacy variant', async () => {
    const models = { currentModelId: 'gpt', availableModels: ['gpt', 'gpt/low', 'gpt/high', 'gpt/xhigh', 'other'] }
    expect(acpLegacyVariantModel({ models }, 'gpt', 'high')).toBe('gpt/high')
    expect(acpLegacyVariantModel({ models }, 'gpt', 'max')).toBe('gpt/xhigh')
    expect(acpLegacyVariantModel({ models }, 'gpt', 'auto')).toBe('gpt')
    expect(acpLegacyVariantModel({ models }, 'gpt', 'medium')).toBe('gpt')
    expect(acpLegacyVariantModel({ models }, 'other', 'high')).toBe('other')
    expect(acpLegacyVariantModel({ models, configOptions: [{ id: 'model', category: 'model', type: 'select',
      currentValue: 'gpt', options: [{ value: 'gpt', name: 'GPT' }] }] as AcpConfigOption[] }, 'gpt', 'high')).toBe('gpt')
    const { conn, request } = connection()
    const manager = new AcpSessionManager({ coordinator: {} as DelegatedSessionCoordinator })
    await manager.applyConfigOptions(conn, { sessionId: 'session', models: { ...models } } as AcpSessionHandle, {
      threadId: 'thread', turnId: 'turn', workspacePath: '/tmp', harnessId: 'opencode', model: 'gpt', reasoningEffort: 'high', items: []
    })
    expect(request).toHaveBeenCalledWith('session/set_model', { sessionId: 'session', modelId: 'gpt/high' })
  })

  it('rejects an Agent that echoes a different model than the one it accepted', async () => {
    const echoed = { id: 'model', category: 'model', type: 'select', currentValue: 'one',
      options: [{ value: 'one', name: 'One' }, { value: 'two', name: 'Two' }] } as AcpConfigOption
    const { conn } = connection(vi.fn(async () => ({ configOptions: [echoed] })))
    const state = { sessionId: 'session', configOptions: [{ ...echoed }] as AcpConfigOption[] }
    await expect(applyAcpSessionModel(conn, state, 'two'))
      .rejects.toMatchObject({ code: 'agent_error', message: expect.stringContaining("kept model 'one'") })
    // The route must not claim a model the session never adopted.
    expect(state.configOptions[0]!.currentValue).toBe('one')
  })

  it.each([
    { id: 'model', category: 'model', type: 'select', currentValue: 'one', options: [{ value: 'one', name: 'One' }] },
    { id: 'model', category: 'model', type: 'boolean', currentValue: false },
    { id: 'model', category: 'model', type: 'select', currentValue: 'one' }
  ])('rejects invalid modern model selections without falling back to the legacy list', async (option) => {
    const { conn, request } = connection()
    await expect(applyAcpSessionModel(conn, {
      ...session(), configOptions: [option as AcpConfigOption]
    }, 'two')).rejects.toMatchObject({ code: 'agent_error', message: expect.stringContaining('does not offer') })
    expect(request).not.toHaveBeenCalled()
  })

  it('normalizes legacy Antigravity model prefixes and effort suffixes while preserving exact model ids', async () => {
    const makeOptions = (): AcpConfigOption[] => [
      {
        id: 'model',
        category: 'model',
        type: 'select',
        currentValue: 'gemini-4-carbon',
        options: [
          { value: 'gemini-4-carbon', name: 'Gemini 4 Carbon' },
          { value: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen' },
          { value: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' },
          { value: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)' }
        ]
      },
      {
        id: 'thought_level',
        category: 'thought_level',
        type: 'select',
        currentValue: 'medium',
        options: [
          { value: 'low', name: 'Low' },
          { value: 'medium', name: 'Medium' },
          { value: 'high', name: 'High' },
          { value: 'xhigh', name: 'XHigh' }
        ]
      }
    ]
    const manager = new AcpSessionManager({ coordinator: {} as DelegatedSessionCoordinator })

    // `models/gemini-3.8-flash-high` strips `models/` and infers `high` effort.
    const flash = connection()
    await manager.applyConfigOptions(flash.conn, { sessionId: 's1', configOptions: makeOptions() } as AcpSessionHandle, {
      threadId: 'thread', turnId: 'turn', workspacePath: '/tmp', harnessId: 'custom-agent',
      model: 'models/gemini-3.8-flash-high', items: []
    })
    expect(flash.request.mock.calls).toEqual([
      ['session/set_config_option', { sessionId: 's1', configId: 'model', value: 'gemini-3.8-flash' }],
      ['session/set_config_option', { sessionId: 's1', configId: 'thought_level', value: 'high' }]
    ])

    // `gemini-4-hydrogen-xhigh` maps to `gemini-4-hydrogen` + `xhigh` thought_level; explicit reasoningEffort still wins.
    const xhigh = connection()
    await manager.applyConfigOptions(xhigh.conn, { sessionId: 's2', configOptions: makeOptions() } as AcpSessionHandle, {
      threadId: 'thread', turnId: 'turn', workspacePath: '/tmp', harnessId: 'custom-agent',
      model: 'gemini-4-hydrogen-xhigh', items: []
    })
    expect(xhigh.request.mock.calls).toEqual([
      ['session/set_config_option', { sessionId: 's2', configId: 'model', value: 'gemini-4-hydrogen' }],
      ['session/set_config_option', { sessionId: 's2', configId: 'thought_level', value: 'xhigh' }]
    ])

    // Exact offered model ids ending with `-medium` (`gpt-oss-120b-medium`) stay untouched.
    const exact = connection()
    await manager.applyConfigOptions(exact.conn, { sessionId: 's3', configOptions: makeOptions() } as AcpSessionHandle, {
      threadId: 'thread', turnId: 'turn', workspacePath: '/tmp', harnessId: 'custom-agent',
      model: 'gpt-oss-120b-medium', items: []
    })
    expect(exact.request).toHaveBeenCalledExactlyOnceWith('session/set_config_option', {
      sessionId: 's3', configId: 'model', value: 'gpt-oss-120b-medium'
    })
  })
})
