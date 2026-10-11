import { describe, expect, it } from 'vitest'
import { AcpEventMapper } from '../../../../kun/src/runtime/acp/acp-event-mapper'
import { AcpDraftEmitter } from '../../../../kun/src/runtime/acp/acp-turn-emitter'
import { parseAcpSessionUpdate } from '../../../../kun/src/runtime/acp/acp-schema'
import { chatBlockFromItem, mergeChatBlocks } from './kun-mapper'
import type { CoreTurnItemJson } from './kun-contract'
import { deriveTurnSections, groupTurnProcessTimeline } from '../components/chat/derive-turn-sections'
import { summarizeToolBlock } from '../components/chat/message-timeline-process-detail'
import type { ChatBlock } from './types'

function fixture() {
  let n = 0
  const items = new Map<string, CoreTurnItemJson>()
  const store = (item: unknown) => { const value = item as CoreTurnItemJson; items.set(value.id, value) }
  const mapper = new AcpEventMapper({ threadId: 'thread', turnId: 'turn', nextId: (p) => `${p}_${++n}` })
  const emitter = new AcpDraftEmitter({ turns: {
    applyItem: async (_thread: string, item: unknown) => store(item),
    applyAssistantDelta: async (_thread: string, item: unknown) => store(item),
    updateItem: async (_thread: string, _id: string, item: unknown) => { store(item); return item }
  } as never, events: { record: async () => undefined } as never }, 'thread', 'turn')
  const apply = async (update: Record<string, unknown>) => emitter.emitAll(mapper.apply(parseAcpSessionUpdate(update)))
  const blocks = () => mergeChatBlocks([...items.values()].map((item) => chatBlockFromItem(item)).filter((block): block is ChatBlock => Boolean(block)))
  return { mapper, emitter, apply, blocks }
}
const text = (value: string) => ({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: value } })
const call = (id: string, kind = 'read') => ({ sessionUpdate: 'tool_call', toolCallId: id, kind, title: 'Read file', status: 'pending', rawInput: { file_path: '/repo/README.md' } })
const finish = (id: string) => ({ sessionUpdate: 'tool_call_update', toolCallId: id, status: 'completed', content: [{ type: 'content', content: { type: 'text', text: '201 lines' } }] })

describe('ACP chronological presentation', () => {
  it('keeps text and tools interleaved live and folds only intermediate output after settlement/reload', async () => {
    const f = fixture()
    await f.apply(text('First I will read the file.'))
    await f.apply(call('read'))
    await f.apply(finish('read'))
    await f.apply(text('Now I will check the result.'))
    await f.apply({ ...call('command', 'execute'), title: 'Run command', rawInput: { command: 'git diff --check' } })
    await f.apply(finish('command'))
    await f.apply(text('Final answer.'))
    await f.emitter.emitAll(f.mapper.flush())
    const blocks = f.blocks()
    expect(blocks.map((b) => b.kind)).toEqual(['assistant', 'tool', 'assistant', 'tool', 'assistant'])
    const input = { turn: { blocks }, workspaceRoot: '/repo', liveProcessText: '', liveContent: '' }
    const live = deriveTurnSections({ ...input, isProcessing: true })
    expect(groupTurnProcessTimeline(live.processTimelineBlocks).map((entry) => entry.kind === 'process' ? entry.section.kind : entry.kind))
      .toEqual(['output', 'execution', 'output', 'execution', 'output'])
    for (const history of [blocks, JSON.parse(JSON.stringify(blocks))]) {
      const settled = deriveTurnSections({ ...input, turn: { blocks: history }, isProcessing: false })
      expect(settled.assistantContentBlocks.map((b) => b.text)).toEqual(['Final answer.'])
      expect(settled.processBlocks.map((b) => b.kind)).toEqual(['assistant', 'tool', 'assistant', 'tool'])
    }
    const read = blocks[1]
    expect(read).toMatchObject({ filePath: '/repo/README.md', meta: { acpInput: { file_path: '/repo/README.md' }, acpText: '201 lines' } })
    expect(summarizeToolBlock(read as never, (key) => key)).toContain('/repo/README.md')
    expect(blocks[3]).toMatchObject({ meta: { command: 'git diff --check' } })
  })

  it('keeps received raw output alongside a short summary and preserves legacy input after result merging', async () => {
    const f = fixture()
    await f.apply(call('read'))
    await f.apply({ ...finish('read'), rawOutput: { content: 'Actual contents' } })
    expect(f.blocks()[0]).toMatchObject({ meta: { acpFileContent: 'Actual contents', acpText: '201 lines' } })
    const legacy = mergeChatBlocks([
      chatBlockFromItem({ turnId: 'old-turn', threadId: 'thread', role: 'tool', status: 'completed', createdAt: '2026-10-05T00:00:00Z', kind: 'tool_call', id: 'call', toolName: 'acp:read', callId: 'old', arguments: { rawInput: { file_path: '/repo/old.md' } } } as CoreTurnItemJson)!,
      chatBlockFromItem({ turnId: 'old-turn', threadId: 'thread', role: 'tool', status: 'completed', createdAt: '2026-10-05T00:00:00Z', kind: 'tool_result', id: 'result', toolName: 'acp:read', callId: 'old', output: '20 lines' } as CoreTurnItemJson)!
    ])
    expect(legacy[0]).toMatchObject({ filePath: '/repo/old.md', meta: { acpInput: { file_path: '/repo/old.md' }, acpText: '20 lines' } })
  })
})
