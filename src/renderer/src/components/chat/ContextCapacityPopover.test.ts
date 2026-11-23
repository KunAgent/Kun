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
  it('shows the categories an Agent split itself, credited to the Agent', () => {
    const cursor = buildContextCapacity({ ...codexSnapshot(), contextWindowTokens: 256_000, softThresholdTokens: 256_000,
      hardThresholdTokens: 256_000, estimatedInputTokens: 89_727, breakdownSource: 'agent',
      breakdown: { tools: 12_888, system: 2_859, skills: 0, messages: 73_980, other: 0 } })
    const html = renderToStaticMarkup(createElement(ContextCapacityPopover, { capacity: cursor, agentName: 'Cursor' }))
    expect(html).not.toContain('data-context-agent-row')
    expect(html).not.toContain('data-context-agent-segment')
    for (const category of ['系统工具', '系统提示词', '技能', '消息', '其他']) expect(html).toContain(`text-ds-muted">${category}<`)
    expect(html).toContain('12.9k')
    expect(html).toContain('74.0k')
    expect(html).toContain('Cursor 最近一次请求')
    expect(html).toContain('数值和分类均由 Cursor 报告')
    expect(html).not.toContain('Kun 无法细分')
    expect(html).not.toContain('按实际请求内容估算')
  })
  it('keeps a live total over Kun\'s estimated categories as one Agent row', () => {
    const claude = buildContextCapacity({ ...codexSnapshot(), estimatedInputTokens: 30_000, breakdownSource: 'estimate',
      breakdown: { tools: 9_000, system: 6_000, skills: 0, messages: 15_000, other: 0 } })
    const html = renderToStaticMarkup(createElement(ContextCapacityPopover, { capacity: claude, agentName: 'Claude Code' }))
    expect(html).toContain('data-context-agent-row')
    expect(html).toContain('已用（Claude Code 报告）')
    expect(html).not.toContain('text-ds-muted">系统工具<')
  })
  it('renders a single sent-tokens row instead of Kun category zero-rows while awaiting an Agent step', () => {
    const unknownWindow = buildContextCapacity({
      threadId: 't', model: 'custom-model', stepIndex: 0, contextWindowTokens: 1_000_000,
      contextWindowKnown: false, softThresholdTokens: 1_000_000, hardThresholdTokens: 1_000_000,
      estimatedInputTokens: 1_734, breakdown: { tools: 0, system: 1_700, skills: 0, messages: 34, other: 0 },
      toolCount: 0, activeSkillIds: [], contextManagement: 'sdk-managed', nativeHistory: 'none', occupancySource: 'estimate'
    })
    const pendingHtml = renderToStaticMarkup(createElement(ContextCapacityPopover, { capacity: unknownWindow, agentName: 'Antigravity' }))
    expect(pendingHtml).toContain('等待 Agent 上报上下文容量')
    expect(pendingHtml).toContain('data-context-agent-row')
    expect(pendingHtml).toContain('本轮已发送')
    for (const category of ['系统工具', '系统提示词', '技能', '消息', '其他']) {
      expect(pendingHtml).not.toContain(`text-ds-muted">${category}<`)
    }

    const knownWindow = buildContextCapacity({
      threadId: 't', model: 'gemini-4-carbon', stepIndex: 0, contextWindowTokens: 1_000_000,
      contextWindowKnown: true, softThresholdTokens: 1_000_000, hardThresholdTokens: 1_000_000,
      estimatedInputTokens: 1_734, breakdown: { tools: 0, system: 1_700, skills: 0, messages: 34, other: 0 },
      toolCount: 0, activeSkillIds: [], contextManagement: 'sdk-managed', nativeHistory: 'none', occupancySource: 'estimate'
    })
    const knownHtml = renderToStaticMarkup(createElement(ContextCapacityPopover, { capacity: knownWindow, agentName: 'Antigravity' }))
    expect(knownHtml).toContain('1.7k</span> / 1.0M')
    expect(knownHtml).toContain('data-context-agent-row')
    expect(knownHtml).toContain('本轮已发送')
    expect(knownHtml).not.toContain('data-context-threshold-label')
    for (const category of ['系统工具', '系统提示词', '技能', '消息', '其他']) {
      expect(knownHtml).not.toContain(`text-ds-muted">${category}<`)
    }
  })
})

function codexSnapshot() {
  return { threadId: 't', model: 'm', stepIndex: 0, contextWindowTokens: 950_000, softThresholdTokens: 900_000, hardThresholdTokens: 950_000,
    estimatedInputTokens: 1, breakdown: { tools: 0, system: 0, skills: 0, messages: 1, other: 0 }, toolCount: 0, activeSkillIds: [],
    contextManagement: 'sdk-managed' as const, nativeHistory: 'known' as const, occupancySource: 'agent' as const }
}
