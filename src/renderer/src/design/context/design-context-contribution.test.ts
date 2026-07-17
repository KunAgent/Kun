import { describe, expect, it } from 'vitest'
import { DesignContextContributionRegistry } from './design-context-contribution'

describe('DesignContextContributionRegistry', () => {
  it('lists contributions by kind in stable id order', () => {
    const registry = new DesignContextContributionRegistry()
    registry.register({ id: 'system:z', kind: 'design-system', title: 'Z', summary: '', version: '1', loadDetail: async () => ({}) })
    registry.register({ id: 'system:a', kind: 'design-system', title: 'A', summary: '', version: '1', loadDetail: async () => ({}) })
    expect(registry.list('design-system').map((item) => item.id)).toEqual(['system:a', 'system:z'])
  })

  it('rejects duplicate contribution ids', () => {
    const registry = new DesignContextContributionRegistry()
    const contribution = { id: 'skill:a11y', kind: 'skill' as const, title: 'A11y', summary: '', version: '1', loadDetail: async () => ({}) }
    registry.register(contribution)
    expect(() => registry.register(contribution)).toThrow(/duplicate design context contribution/i)
  })
})
