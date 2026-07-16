import { describe, expect, it } from 'vitest'
import { planMoaContext, planMoaModalities } from './moa-context-planner.js'

describe('MoA context planning', () => {
  it('preserves the latest user message and bounds injected reference context', () => {
    const plan = planMoaContext({
      latestUserMessage: 'Keep this request intact',
      referenceOutputs: ['a'.repeat(20_000), 'b'.repeat(20_000)],
      maxContextTokens: 4_000,
      reservedOutputTokens: 1_000
    })

    expect(plan.latestUserMessage).toBe('Keep this request intact')
    expect(plan.estimatedInjectedTokens).toBeLessThanOrEqual(3_000)
    expect(plan.referenceOutputs[0].length).toBeGreaterThan(0)
  })

  it('plans native, derived-text, and skipped attachment handling per slot', () => {
    expect(planMoaModalities({
      attachmentKinds: ['image', 'video'],
      slots: [
        { slotId: 'native', input: ['text', 'image', 'video'], policy: 'native' },
        { slotId: 'derived', input: ['text'], policy: 'derived_text' },
        { slotId: 'skip', input: ['text'], policy: 'skip' }
      ]
    }).map((item) => item.action)).toEqual(['native', 'derived_text', 'skip'])
  })
})
