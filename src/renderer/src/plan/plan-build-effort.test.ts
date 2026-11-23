import { describe, expect, it } from 'vitest'
import { planBuildEffortChoices } from './plan-build-effort'

describe('plan build effort choices', () => {
  it('uses the levels an Agent reported for the model', () => {
    expect(planBuildEffortChoices(undefined, 'agent-model', true, { reasoningEfforts: ['high', 'low', 'medium'] }))
      .toEqual(['auto', 'low', 'medium', 'high'])
  })

  it('offers every level for an undescribed external model and none for a described one without levels', () => {
    expect(planBuildEffortChoices({ modelProfiles: {} }, 'unknown', true)).toEqual(['auto', 'off', 'low', 'medium', 'high', 'max'])
    const group = { modelProfiles: { fast: { reasoning: { supportedEfforts: [] } } } }
    expect(planBuildEffortChoices(group as never, 'fast', true)).toEqual([])
  })

  it('does not offer plan-build overrides for Antigravity Orchestrators or for an unprobed model', () => {
    const native = { nativeHarnessId: 'antigravity' }
    expect(planBuildEffortChoices(native, 'gemini-pro-orchestrator', true, { reasoningEfforts: ['high'] })).toEqual([])
    expect(planBuildEffortChoices({ kind: 'antigravity-cli' }, 'gemini-pro-orchestrator-argon', false)).toEqual([])
    expect(planBuildEffortChoices(native, 'unprobed', true)).toEqual([])
    expect(planBuildEffortChoices(native, 'gemini-4-hydrogen', true, { reasoningEfforts: ['low', 'high', 'xhigh'] }))
      .toEqual(['auto', 'low', 'high', 'xhigh'])
    expect(planBuildEffortChoices({ nativeHarnessId: 'custom' }, 'gemini-pro-orchestrator', true, { reasoningEfforts: ['high'] }))
      .toEqual(['auto', 'high'])
  })

  it('hides the control when no model is chosen', () => {
    expect(planBuildEffortChoices(undefined, '', false)).toEqual([])
  })
})
