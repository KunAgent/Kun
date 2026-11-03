import { describe, expect, it } from 'vitest'
import { acpToolPresentation } from './acp-tool-presentation.js'
import { toKunToolResult } from './acp-tool-call-mapper.js'
import { TOOL_PRESENTATION_MAX_BYTES } from '../../contracts/tool-presentation-bounds.js'
import type { ToolPresentation } from '../../contracts/tool-presentation.js'
import { AcpEventMapper } from './acp-event-mapper.js'

describe('ACP rich tool evidence', () => {
  it('preserves all target locations and mixed content alongside diffs and raw output', () => {
    const view = acpToolPresentation({ toolCallId: 'call', title: 'Change two files', kind: 'edit', status: 'completed',
      locations: [{ path: '/a', line: 3 }, { path: '/b', line: 7 }], rawInput: { files: ['/a', '/b'] }, rawOutput: { summary: 'Done' },
      content: [
        { type: 'diff', path: '/a', oldText: 'old', newText: 'new' },
        { type: 'content', content: { type: 'text', text: 'Reason for this change' } },
        { type: 'content', content: { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' } },
        { type: 'content', content: { type: 'audio', data: 'aGVsbG8=', mimeType: 'audio/wav' } },
        { type: 'content', content: { type: 'resource_link', uri: 'https://example.test/result', name: 'Result' } },
        { type: 'content', content: { type: 'resource', resource: { uri: 'file:///report.txt', text: 'Report text' } } },
        { type: 'content', content: { type: 'resource', resource: { uri: 'file:///report.bin', blob: 'aGVsbG8=' } } }
      ] })
    expect(view).toMatchObject({ state: 'completed', canCancel: false, locations: [{ path: '/a', line: 3 }, { path: '/b', line: 7 }],
      text: 'Reason for this change\nReport text', diffs: [{ path: '/a', oldText: 'old', newText: 'new' }],
      input: { files: ['/a', '/b'] }, output: { summary: 'Done' } })
    expect(view.content?.map((entry) => entry.type)).toEqual(['text', 'image', 'audio', 'resource_link', 'resource', 'resource'])
    expect(view.content?.[3]).toMatchObject({ uri: 'https://example.test/result', name: 'Result' })
    expect(view.content?.[5].resource?.blob).toBe('aGVsbG8=')
  })

  it('keeps multiple terminal commands, signals and explanatory output', () => {
    const view = acpToolPresentation({ toolCallId: 'c', title: 'Commands', kind: 'execute', status: 'in_progress',
      content: [{ type: 'terminal', terminalId: 'one' }, { type: 'terminal', terminalId: 'two' },
        { type: 'content', content: { type: 'text', text: 'Partial explanation' } }] }, {
      terminals: [{ terminalId: 'one', command: 'pwd', cwd: '/a', output: '/a', truncated: false, exitCode: 0 },
        { terminalId: 'two', command: 'sleep 10', cwd: '/b', output: '', truncated: false, signal: 'SIGTERM' }]
    })
    expect(view.terminals).toHaveLength(2)
    expect(view.terminals?.[1]).toMatchObject({ command: 'sleep 10', cwd: '/b', signal: 'SIGTERM' })
    expect(view.text).toBe('Partial explanation')
  })

  it('bounds the entire multi-diff display payload and signals omitted binary evidence', () => {
    const view = acpToolPresentation({ toolCallId: 'large', title: 'Large tool', kind: 'edit',
      content: [
        { type: 'content', content: { type: 'image', data: 'a'.repeat(600_000), mimeType: 'image/png' } },
        ...Array.from({ length: 40 }, (_, i) => ({ type: 'diff' as const, path: `/file${i}`, oldText: 'x'.repeat(90_000), newText: 'y'.repeat(90_000) }))
      ] })
    expect(view.truncated).toBe(true)
    expect(new TextEncoder().encode(JSON.stringify(view)).byteLength).toBeLessThanOrEqual(TOOL_PRESENTATION_MAX_BYTES)
    expect(view.content?.[0]).toMatchObject({ type: 'image', mimeType: 'image/png', omitted: true })
    expect(view.content?.[0].data).toBeUndefined()
    expect(view.diffs?.every((diff) => diff.oldText === 'x'.repeat(90_000) && diff.newText === 'y'.repeat(90_000))).toBe(true)
  })

  it('omits an over-budget diff atomically instead of inventing a diff between clipped files', () => {
    const view = acpToolPresentation({ toolCallId: 'c', title: 'Edit', kind: 'edit',
      rawInput: { large: 'a'.repeat(64_000) }, rawOutput: { large: 'b'.repeat(64_000) },
      content: Array.from({ length: 8 }, (_, index) => ({ type: 'diff' as const, path: `/file${index}`,
        oldText: 'old'.repeat(15_000), newText: 'new'.repeat(15_000) })) })
    expect(view.truncated).toBe(true)
    expect((view.diffs?.length ?? 0)).toBeLessThan(8)
    for (const diff of view.diffs ?? []) {
      expect(diff.oldText).toBe('old'.repeat(15_000))
      expect(diff.newText).toBe('new'.repeat(15_000))
    }
    expect(view.locations).toHaveLength(8)
    expect(new TextEncoder().encode(JSON.stringify(view)).byteLength).toBeLessThanOrEqual(TOOL_PRESENTATION_MAX_BYTES)
  })

  it('persists canceled separately from failure in the common presentation', () => {
    const item = toKunToolResult({ call: { toolCallId: 'c', title: 'Read', kind: 'read' },
      threadId: 't', turnId: 'u', itemId: 'i', outcome: 'interrupted' })
    const view = ('meta' in item ? item.meta?.toolPresentation : undefined) as ToolPresentation
    expect(view).toMatchObject({ state: 'canceled', canCancel: false })
  })

  it('does not turn an interrupted tool into success when late evidence arrives', () => {
    const mapper = new AcpEventMapper({ threadId: 't', turnId: 'u', nextId: (prefix) => prefix })
    mapper.apply({ sessionUpdate: 'tool_call', toolCallId: 'call', title: 'Wait', kind: 'execute', status: 'in_progress',
      content: [{ type: 'terminal', terminalId: 'terminal' }] })
    mapper.flush()
    const late = mapper.recordTerminal({ terminalId: 'terminal', command: 'sleep 10', cwd: '/repo', output: 'Stopped', truncated: false, signal: 'SIGTERM' })
    const result = late.find((event) => 'item' in event && event.item?.kind === 'tool_result')
    expect(result && 'item' in result ? result.item : undefined).toMatchObject({ status: 'aborted',
      meta: { toolPresentation: { state: 'canceled', canCancel: false } } })
  })
})
