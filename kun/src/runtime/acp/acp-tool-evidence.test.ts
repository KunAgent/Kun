import type { DelegatedToolPresentation } from '../../contracts/delegated-tool-presentation.js'
import { describe, expect, it } from 'vitest'
import { AcpEventMapper } from './acp-event-mapper.js'
import { parseAcpSessionUpdate } from './acp-schema.js'
import { acpToolPresentation } from './acp-tool-presentation.js'
import type { RuntimeEventDraft } from '../../services/runtime-event-recorder.js'

function fixture() {
  let n = 0
  const mapper = new AcpEventMapper({ threadId: 'thread', turnId: 'turn', nextId: (prefix) => `${prefix}_${++n}` })
  const apply = (value: Record<string, unknown>) => mapper.apply(parseAcpSessionUpdate(value))
  const item = (draft: RuntimeEventDraft) => {
    if (!('item' in draft) || !draft.item || !('meta' in draft.item)) throw new Error('Expected tool evidence')
    return { meta: { delegatedTool: draft.item.meta?.delegatedTool as DelegatedToolPresentation } }
  }
  return { mapper, apply, item }
}

describe('ACP tool evidence', () => {
  it('keeps paths outside truncated inputs and does not discard raw output behind a summary', () => {
    const detail = acpToolPresentation({ toolCallId: 'call', title: 'Read', kind: 'read',
      rawInput: { file_path: '/repo/README.md', content: 'x'.repeat(80_000) },
      content: [{ type: 'content', content: { type: 'text', text: '201 lines' } }],
      rawOutput: { content: 'actual contents' } })
    expect(detail).toMatchObject({ filePath: '/repo/README.md', truncated: true, text: '201 lines', fileContent: 'actual contents', output: { content: 'actual contents' } })
  })
  it('updates late metadata without finishing twice and treats content updates as snapshots', () => {
    const f = fixture()
    f.apply({ sessionUpdate: 'tool_call', toolCallId: 'a', title: 'Running', kind: 'execute', status: 'in_progress', rawInput: { command: 'pwd' } })
    const first = f.apply({ sessionUpdate: 'tool_call_update', toolCallId: 'a', content: [{ type: 'content', content: { type: 'text', text: 'partial' } }] })
    expect(f.item(first[0]).meta.delegatedTool.text).toBe('partial')
    const done = f.apply({ sessionUpdate: 'tool_call_update', toolCallId: 'a', status: 'completed', rawInput: null,
      content: [{ type: 'content', content: { type: 'text', text: 'complete' } }] })
    expect(f.item(done.at(-1)!).meta.delegatedTool).toMatchObject({ command: 'pwd', text: 'complete' })
    const late = f.apply({ sessionUpdate: 'tool_call_update', toolCallId: 'a', rawOutput: { exitCode: 0 } })
    expect(late.every((event) => event.kind === 'item_updated')).toBe(true)
    expect(f.item(late.at(-1)!).meta.delegatedTool.output).toEqual({ exitCode: 0 })
  })
  it('links a mediated read only to an unambiguous active tool and retains terminal output', () => {
    const f = fixture()
    const read = { sessionUpdate: 'tool_call', toolCallId: 'read', title: 'Read', kind: 'read', rawInput: { file_path: '/repo/file' } }
    f.apply(read)
    expect(f.item(f.mapper.recordFileRead('/repo/file', 'actual read snapshot')[0]).meta.delegatedTool.fileContent).toBe('actual read snapshot')
    f.apply({ ...read, toolCallId: 'other' })
    expect(f.mapper.recordFileRead('/repo/file', 'ambiguous')).toEqual([])
    f.apply({ sessionUpdate: 'tool_call', toolCallId: 'shell', title: 'Execute', kind: 'execute', content: [{ type: 'terminal', terminalId: 't' }] })
    const draft = f.mapper.recordTerminal({ terminalId: 't', command: 'pwd', cwd: '/repo', output: '/repo\n', truncated: false, exitCode: 0 })
    expect(f.item(draft[0]).meta.delegatedTool.terminals?.[0]).toMatchObject({ command: 'pwd', output: '/repo\n', exitCode: 0 })
  })
})
