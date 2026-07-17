import { describe, expect, it } from 'vitest'
import { DESIGN_CONTEXT_TABS } from './DesignContextPanel'

describe('DesignContextPanel', () => {
  it('integrates systems, skills, components, and assets under Design Context', () => {
    expect(DESIGN_CONTEXT_TABS.map((tab) => tab.label)).toEqual(['设计系统', 'Skills', '组件', '资产'])
  })
})
