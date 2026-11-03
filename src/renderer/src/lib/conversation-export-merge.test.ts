import { describe, expect, it } from 'vitest'
import type { ChatBlock } from '../agent/types'
import { buildConversationExportDocument } from './conversation-export'
import { buildMergedConversationMarkdown, demoteMarkdownHeadings } from './conversation-export-merge'

const labels = {
  exportedAt: 'Exported', user: 'You', assistant: 'Kun', attachments: 'Attachments',
  referencedFiles: 'Referenced', generatedFiles: 'Generated', sources: 'Sources', attachment: 'Attachment',
  toolCalls: 'Tool calls', reasoning: 'Reasoning'
}
const blocks: ChatBlock[] = [
  { kind: 'user', id: 'u1', turnId: 't1', text: 'Question' },
  { kind: 'reasoning', id: 'r1', turnId: 't1', text: 'Thinking hard' },
  { kind: 'tool', id: 'x1', turnId: 't1', summary: 'Ran npm test', status: 'success' },
  { kind: 'assistant', id: 'a1', turnId: 't1', text: 'Answer' }
]
const build = (include?: Parameters<typeof buildConversationExportDocument>[0]['include']) =>
  buildConversationExportDocument({
    title: 'T', blocks, locale: 'en', exportedAt: new Date(2026, 9, 8), labels, busy: false, include
  })

describe('conversation export include options', () => {
  it('omits tool calls and reasoning by default', () => {
    const { markdown } = build()
    expect(markdown).not.toContain('Ran npm test')
    expect(markdown).not.toContain('Thinking hard')
  })

  it('adds tool calls and quoted reasoning when enabled', () => {
    const { markdown } = build({ toolCalls: true, reasoning: true })
    expect(markdown).toContain('### Tool calls\n\n- Ran npm test')
    expect(markdown).toContain('### Reasoning\n\n> Thinking hard')
  })
})

describe('merged conversation markdown', () => {
  it('demotes headings but not fenced code', () => {
    expect(demoteMarkdownHeadings('## A\n```\n# keep\n```\n### B')).toBe('### A\n```\n# keep\n```\n#### B')
  })

  it('builds contents and nests each conversation under a numbered heading', () => {
    const one = build().markdown
    const merged = buildMergedConversationMarkdown({
      title: 'All', exportedAtLabel: 'Exported', exportedAt: 'today', contentsLabel: 'Contents',
      entries: [{ title: 'First', markdown: one }, { title: 'Second', markdown: one }]
    })
    expect(merged).toContain('## Contents\n\n1. First\n2. Second')
    expect(merged).toContain('## 2. Second')
    expect(merged).toContain('### You')
    expect(merged).not.toContain('\n# T\n')
  })
})
