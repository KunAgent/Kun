import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ToolPresentation } from '@shared/tool-presentation'
import type { ToolBlock } from '../../agent/types'
import { summarizeProcessWork } from './message-timeline-process-summary'
import { processBlockErrorTone } from './message-timeline-process-grouping'
import { ToolStateMeta } from './ToolStateMeta'

function block(id: string, presentation: Partial<ToolPresentation>): ToolBlock {
  return { kind: 'tool', id, summary: 'Tool', status: presentation.state === 'failed' || presentation.state === 'canceled' ? 'error' : 'success',
    meta: { toolPresentation: { version: 1, kind: 'read', state: 'completed', canCancel: false, ...presentation } } }
}
const translate = (key: string, values?: Record<string, unknown>): string =>
  values?.count === undefined ? key : `${key}:${values.count}`

describe('tool work summaries', () => {
  it('counts unique files across repeated reads and multi-location results', () => {
    const summary = summarizeProcessWork([
      block('one', { filePath: '/repo/a.ts' }),
      block('two', { filePath: '/repo/a.ts', locations: [{ path: '/repo/a.ts', line: 20 }, { path: '/repo/b.ts' }] }),
      block('three', { filePath: '/repo/b.ts' })
    ], translate)
    expect(summary).toBe('groupReadFiles:2')
  })

  it('counts edited files from every diff and distinguishes failures from user cancellation', () => {
    const summary = summarizeProcessWork([
      block('one', { kind: 'edit', diffs: [{ path: '/repo/a', oldText: 'a', newText: 'b' }, { path: '/repo/b', oldText: 'a', newText: 'b' }] }),
      block('two', { kind: 'edit', filePath: '/repo/a', state: 'failed' }),
      block('three', { kind: 'shell', state: 'canceled' })
    ], translate)
    expect(summary).toContain('groupEditedFiles:2')
    expect(summary).toContain('toolSummaryFailed:1')
    expect(summary).toContain('toolSummaryCanceled:1')
    expect(processBlockErrorTone(block('cancel', { state: 'canceled' }))).toBeNull()
    expect(processBlockErrorTone(block('failure', { state: 'failed' }))).toBe('tool')
  })

  it('retains calls with unknown paths and deduplicates fetched pages', () => {
    const summary = summarizeProcessWork([
      block('unknown-1', {}), block('unknown-2', {}),
      block('fetch-1', { kind: 'fetch', url: 'https://example.test/docs' }),
      block('fetch-2', { kind: 'fetch', url: 'https://example.test/docs' })
    ], translate)
    expect(summary).toContain('groupReadFiles:2')
    expect(summary).toContain('toolSummaryFetched:1')
  })

  it('exposes pending and canceled states without inventing unknown execution times', () => {
    const pending = renderToStaticMarkup(createElement(ToolStateMeta, { block: block('p', { state: 'pending' }) }))
    expect(pending).toContain('data-tool-state="pending"')
    expect(pending.replace(/<[^>]+>/g, '')).toBe('Pending')
    const canceled = renderToStaticMarkup(createElement(ToolStateMeta, { block: block('c', { state: 'canceled', durationMs: 1520,
      terminals: [{ terminalId: 't', output: '', exitCode: 130 }] }) }))
    expect(canceled).toContain('data-tool-state="canceled"')
    expect(canceled).toContain('1.5s')
    expect(canceled).toContain('130')
    expect(canceled).not.toContain('text-orange')
  })
})
