import { describe, expect, it } from 'vitest'
import type { HarnessDefinition } from '../../contracts/harness.js'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { allowsEffort, checkedProfiles, modelProfile, probedModelInfo, routeProfiles } from './model-profiles.js'

describe('mobile Code model profiles', () => {
  it('keeps wire levels in host order and drops a default outside them', () => {
    expect(modelProfile(['max', 'minimal', 'low', 'auto'], 'max')).toEqual({ efforts: ['auto', 'low', 'max'], defaultEffort: 'max' })
    expect(modelProfile(['low', 'high'], 'xhigh')).toEqual({ efforts: ['low', 'high'] })
    expect(modelProfile(['xhigh'])).toBeUndefined()
    expect(modelProfile(undefined)).toBeUndefined()
    expect(routeProfiles(['a', 'b'], () => undefined)).toEqual({})
  })

  it('withholds a description the protocol self-check refuses', () => {
    const route = { label: 'Kun', models: ['a'], profiles: { b: { efforts: ['high' as const] } } }
    expect(checkedProfiles(route)).toEqual({ label: 'Kun', models: ['a'] })
    const valid = { label: 'Kun', models: ['a'], profiles: { a: { efforts: ['high' as const] } } }
    expect(checkedProfiles(valid)).toBe(valid)
  })

  it('treats inherited object keys as unlisted models', () => {
    const route = { profiles: { a: { efforts: ['high' as const] } } }
    expect(allowsEffort(route, 'a', 'high')).toBe(true)
    expect(allowsEffort(route, 'a', undefined)).toBe(true)
    expect(allowsEffort(route, 'constructor', 'high')).toBe(false)
    expect(allowsEffort({}, 'a', 'high')).toBe(false)
  })

  it('merges persisted reasoning levels when a live ACP session cache only knows the active model', () => {
    const def = { id: 'antigravity', transport: 'acp' } as HarnessDefinition
    const runtime = {
      harnesses: {
        acpModels: {
          peekInfo: () => [{ id: 'gemini-4-neon', isDefault: true, reasoningEfforts: ['low', 'high'] }, { id: 'gemini-4-carbon' }]
        },
        liveProbedModels: () => ['gemini-4-neon', 'gemini-4-carbon'],
        modelCatalogs: {
          get: () => ({
            fetchedAt: '2026-01-01T00:00:00Z',
            catalog: {
              models: ['gemini-4-neon', 'gemini-4-carbon'],
              modelInfo: [
                { id: 'gemini-4-neon', reasoningEfforts: ['low', 'high'] },
                { id: 'gemini-4-carbon', reasoningEfforts: ['low', 'medium', 'high'], defaultReasoningEffort: 'high' }
              ]
            }
          })
        }
      }
    } as unknown as ServerRuntime
    expect(probedModelInfo(runtime, def)).toEqual([
      { id: 'gemini-4-neon', isDefault: true, reasoningEfforts: ['low', 'high'] },
      { id: 'gemini-4-carbon', reasoningEfforts: ['low', 'medium', 'high'], defaultReasoningEffort: 'high' }
    ])
  })
})
