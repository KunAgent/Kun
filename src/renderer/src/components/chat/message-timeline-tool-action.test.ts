import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import i18n from '../../i18n'
import { LiveTurnProgressRow } from './message-timeline-live-progress'
import type { ToolBlock } from '../../agent/types'
import {
  childActivityLiveAction,
  summarizeToolLiveAction
} from './message-timeline-tool-action'

const labels: Record<string, string> = {
  toolLiveActionRead: 'Reading',
  toolLiveActionSearch: 'Searching',
  toolLiveActionEdit: 'Editing',
  toolLiveActionRun: 'Running a command',
  toolLiveActionList: 'Listing',
  toolLiveActionDelegate: 'Delegating',
  toolLiveActionGeneric: 'Working',
  toolBuiltinRead: 'Read',
  toolBuiltinGrep: 'Search',
  toolBuiltinEdit: 'Edit',
  toolActionCommand: 'Ran command',
  toolBuiltinLs: 'List',
  toolActionTool: 'Called tool'
}

const t = (key: string): string => labels[key] ?? key

function toolBlock(overrides: Partial<ToolBlock>): ToolBlock {
  return { kind: 'tool', id: 'tool_1', summary: 'tool', status: 'running', ...overrides }
}

describe('live tool action labels', () => {
  it('renders Chinese action and elapsed time without raw details or hidden titles', async () => {
    await i18n.changeLanguage('zh')
    const html = renderToStaticMarkup(createElement(LiveTurnProgressRow, { thinking: false, durationMs: 2000,
      tool: toolBlock({ summary: 'grep: private-pattern', filePath: '/private/file', meta: { toolName: 'grep' } }) }))
    expect(html).toContain('正在搜索')
    expect(html).toContain('2.0s')
    expect(html).not.toContain('private-pattern')
    expect(html).not.toContain('/private/file')
    await i18n.changeLanguage('en')
  })
  it('uses ACP categories without using its freeform title', () => {
    expect(summarizeToolLiveAction(toolBlock({ meta: { acpKind: 'search', acpTitle: 'grep /private/file' } }), t)).toBe('Searching')
    expect(summarizeToolLiveAction(toolBlock({ summary: 'read: /private/file' }), t)).toBe('Working')
  })
  it('names only the action for search tools, never the pattern or path', () => {
    const grep = toolBlock({
      summary: 'grep: branch.*(empty|draft)|fork.*(empty|draft)',
      meta: { toolName: 'grep', pattern: 'branch.*(empty|draft)|fork.*(empty|draft)' },
      filePath: '/Users/zxy/codeproject/ds_project/DeepSeek-GUI/src/renderer/src/components'
    })
    expect(summarizeToolLiveAction(grep, t)).toBe('Searching')
    expect(summarizeToolLiveAction(grep, t)).not.toContain('/Users/zxy')
    expect(summarizeToolLiveAction(grep, t)).not.toContain('branch.*')
  })

  it('maps read, edit, list and command tools to their own action words', () => {
    expect(summarizeToolLiveAction(toolBlock({ meta: { toolName: 'read' }, filePath: '/tmp/a.ts' }), t))
      .toBe('Reading')
    expect(summarizeToolLiveAction(toolBlock({ meta: { toolName: 'edit' }, filePath: '/tmp/a.ts' }), t))
      .toBe('Editing')
    expect(summarizeToolLiveAction(toolBlock({ meta: { toolName: 'ls' }, filePath: '/tmp/src' }), t))
      .toBe('Listing')
    expect(summarizeToolLiveAction(toolBlock({
      meta: { toolName: 'bash', command: 'npm test -- --runInBand' },
      toolKind: 'command_execution'
    }), t)).toBe('Running a command')
  })

  it('keeps a command execution tool from leaking its shell command', () => {
    const block = toolBlock({
      summary: 'bash: npm run build --filter secrets',
      meta: { toolName: 'bash', command: 'npm run build --filter secrets' },
      toolKind: 'command_execution'
    })
    const label = summarizeToolLiveAction(block, t)
    expect(label).toBe('Running a command')
    expect(label).not.toContain('npm')
    expect(label).not.toContain('secrets')
  })

  it('falls back to a generic action for unknown tools instead of the raw summary', () => {
    const block = toolBlock({
      summary: 'mystery_tool: /tmp/secret/path --flag',
      meta: { toolName: 'mystery_tool' }
    })
    expect(summarizeToolLiveAction(block, t)).toBe('Working')
  })

  it('maps delegated subagent work to the delegate action', () => {
    expect(summarizeToolLiveAction(toolBlock({ meta: { toolName: 'delegate_task' } }), t))
      .toBe('Delegating')
  })

  it('projects child activity through the same short vocabulary', () => {
    expect(childActivityLiveAction({ toolName: 'grep' }, t)).toBe('Searching')
    expect(childActivityLiveAction({ phase: 'thinking' }, t)).toBeUndefined()
  })
})
