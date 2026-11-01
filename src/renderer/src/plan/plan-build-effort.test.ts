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

  it('hides the control when no model is chosen', () => {
    expect(planBuildEffortChoices(undefined, '', false)).toEqual([])
  })
})
