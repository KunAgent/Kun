import { describe, expect, it } from 'vitest'
import { formatWriteRailBadge, resolveWriteRailItems } from './write-side-rail-items'

describe('resolveWriteRailItems', () => {
  it('orders primary tools before shared tools', () => {
    const items = resolveWriteRailItems({ reviewCount: 0, referenceCount: 0, assistantRunning: false })
    expect(items.map((item) => item.id)).toEqual([
      'assistant', 'outline', 'review', 'references', 'mcpSkills', 'usage'
    ])
    expect(items.filter((item) => item.group === 'secondary').map((item) => item.id))
      .toEqual(['mcpSkills', 'usage'])
    expect(items.some((item) => item.badge || item.running)).toBe(false)
  })

  it('badges pending review in accent and references in neutral', () => {
    const items = resolveWriteRailItems({ reviewCount: 2, referenceCount: 3, assistantRunning: true })
    const byId = Object.fromEntries(items.map((item) => [item.id, item]))
    expect(byId.review?.badge).toEqual({ count: 2, tone: 'accent' })
    expect(byId.references?.badge).toEqual({ count: 3, tone: 'neutral' })
    expect(byId.assistant?.running).toBe(true)
  })

  it('drops document-only tools while the assistant fills the center', () => {
    const items = resolveWriteRailItems({
      reviewCount: 4, referenceCount: 1, assistantRunning: false, documentTools: false
    })
    expect(items.map((item) => item.id)).toEqual(['assistant', 'mcpSkills', 'usage'])
  })

  it('adds 论文 with a count once the session has surfaced papers, even in the stage', () => {
    const items = resolveWriteRailItems({
      reviewCount: 0, referenceCount: 0, assistantRunning: false, paperCount: 12, documentTools: false
    })
    expect(items.map((item) => item.id)).toEqual(['assistant', 'papers', 'mcpSkills', 'usage'])
    expect(items.find((item) => item.id === 'papers')?.badge).toEqual({ count: 12, tone: 'neutral' })
    expect(resolveWriteRailItems({ reviewCount: 0, referenceCount: 0, assistantRunning: false })
      .some((item) => item.id === 'papers')).toBe(false)
  })

  it('caps badge text', () => {
    expect(formatWriteRailBadge(7)).toBe('7')
    expect(formatWriteRailBadge(120)).toBe('99+')
  })
})
