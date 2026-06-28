import { describe, expect, it } from 'vitest'
import {
  designSystemPath,
  parseDesignSystem,
  serializeDesignSystem
} from './design-system-persistence'
import { createEmptyDesignSystem, type DesignSystem } from './design-system-types'

describe('design-system-persistence', () => {
  it('puts design-system.json at the doc dir (baseDir)', () => {
    expect(designSystemPath('.kun-design/doc_123')).toBe('.kun-design/doc_123/design-system.json')
  })

  it('round-trips a design system through serialize/parse', () => {
    const system: DesignSystem = {
      tokens: {
        'brand/primary': { name: 'brand/primary', kind: 'color', value: '#3b82d8' },
        'space/md': { name: 'space/md', kind: 'space', value: 16 }
      },
      components: {}
    }
    const parsed = parseDesignSystem(serializeDesignSystem(system))
    expect(parsed).toEqual(system)
  })

  it('returns null on garbage and an empty system on a bare object', () => {
    expect(parseDesignSystem('not json {')).toBeNull()
    expect(parseDesignSystem('{}')).toEqual(createEmptyDesignSystem())
  })
})
