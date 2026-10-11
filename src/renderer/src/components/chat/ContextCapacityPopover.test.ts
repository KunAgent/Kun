// @vitest-environment jsdom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import { buildContextCapacity } from '../../lib/context-capacity'
import { ContextCapacityPopover } from './ContextCapacityPopover'

const codex = buildContextCapacity({ threadId: 't', model: 'deepseek-flash', stepIndex: 0, contextWindowTokens: 950_000,
  softThresholdTokens: 900_000, hardThresholdTokens: 950_000, estimatedInputTokens: 107_624,
  breakdown: { tools: 0, system: 0, skills: 0, messages: 107_624, other: 0 }, toolCount: 4, activeSkillIds: [],
  contextManagement: 'sdk-managed', nativeHistory: 'known', occupancySource: 'agent' })

describe('context popover for an Agent-managed context', () => {
  beforeAll(async () => { await i18n.changeLanguage('zh') })
  it('shows the Agent\'s figure as one row, its compaction point and no Kun categories', () => {
    const html = renderToStaticMarkup(createElement(ContextCapacityPopover, { capacity: codex, agentName: 'Codex' }))
    expect(html).toContain('107.6k')
    expect(html).toContain('950')
    expect(html).toContain('data-context-agent-row')
    expect(html).toContain('已用（Codex 报告）')
    expect(html).toContain('Codex 最近一次请求')
    expect(html).toContain('约 95% 自动压缩')
    expect(html).toContain('数值由 Codex 报告')
    // Only the Agent's row and the free row: no Kun categories with zeros.
    for (const category of ['系统工具', '系统提示词', '技能']) expect(html).not.toContain(`text-ds-muted">${category}<`)
    expect(html.match(/grid-cols-\[13px_1fr_auto_46px\]/g)).toHaveLength(2)
    expect(html).toContain('107.6k</span> / 950.0k')
    expect(html).not.toContain('将自动压缩')
  })
  it('says the Agent compacts, not Kun, near the limit, and hides an unreported threshold', () => {
    const full = buildContextCapacity({ ...codexSnapshot(), estimatedInputTokens: 930_000, breakdown: { tools: 0, system: 0, skills: 0, messages: 930_000, other: 0 },
      softThresholdTokens: 950_000 })
    const html = renderToStaticMarkup(createElement(ContextCapacityPopover, { capacity: full, agentName: 'OpenCode' }))
    expect(html).toContain('接近上限')
    expect(html).not.toContain('data-context-threshold-label')
  })
})

function codexSnapshot() {
  return { threadId: 't', model: 'm', stepIndex: 0, contextWindowTokens: 950_000, softThresholdTokens: 900_000, hardThresholdTokens: 950_000,
    estimatedInputTokens: 1, breakdown: { tools: 0, system: 0, skills: 0, messages: 1, other: 0 }, toolCount: 0, activeSkillIds: [],
    contextManagement: 'sdk-managed' as const, nativeHistory: 'known' as const, occupancySource: 'agent' as const }
}
