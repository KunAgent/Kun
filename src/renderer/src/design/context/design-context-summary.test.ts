import { describe, expect, it, vi } from 'vitest'
import { buildBoundedDesignContextSummary } from './design-context-summary'

describe('bounded selected design context', () => {
  it('injects selected summaries and handles without loading full details', () => {
    const loadDetail = vi.fn(async () => ({ body: 'FULL_SKILL_BODY' }))
    const summary = buildBoundedDesignContextSummary({
      contributions: [{
        id: 'skill:a11y', kind: 'skill', title: 'Accessibility',
        summary: 'Check keyboard and contrast behavior.', version: '1', loadDetail
      }],
      selection: { version: 1, selected: [{ contributionId: 'skill:a11y', version: '1', enabled: true }] },
      maxTokens: 2_000
    })

    expect(summary).toContain('skill:a11y')
    expect(summary).toContain('design-context://skill:a11y')
    expect(summary).not.toContain('FULL_SKILL_BODY')
    expect(loadDetail).not.toHaveBeenCalled()
    expect(Math.ceil(summary.length / 4)).toBeLessThanOrEqual(2_000)
  })
})
