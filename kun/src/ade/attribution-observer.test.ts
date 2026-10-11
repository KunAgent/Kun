import { describe, expect, it } from 'vitest'
import type { TurnItem } from '../contracts/items.js'
import {
  createAttributionObserver,
  writeFragmentsFromItem,
  type AttributionObserverDeps
} from './attribution-observer.js'
import type { AttributionLedger } from './attribution-ledger.js'

const base = {
  id: 'it_1',
  turnId: 'turn_1',
  threadId: 'thr_worker',
  role: 'tool' as const,
  status: 'completed' as const,
  createdAt: 't'
}

const toolCall = (toolName: string, toolKind: 'file_change' | 'tool_call', args: object): TurnItem =>
  ({ ...base, kind: 'tool_call', toolName, callId: 'c1', toolKind, arguments: args }) as TurnItem

describe('writeFragmentsFromItem', () => {
  it('extracts Kun write/edit new-text fragments', () => {
    expect(writeFragmentsFromItem(toolCall('write', 'file_change', {
      path: 'src/a.ts', content: 'const a = 1'
    }))).toEqual([{ path: 'src/a.ts', text: 'const a = 1' }])
    expect(writeFragmentsFromItem(toolCall('edit', 'file_change', {
      path: 'src/a.ts',
      edits: [{ oldText: 'x', newText: 'y' }, { oldText: 'p', newText: 'q' }]
    }))).toEqual([
      { path: 'src/a.ts', text: 'y' },
      { path: 'src/a.ts', text: 'q' }
    ])
  })

  it('extracts Claude SDK Write/Edit/MultiEdit/NotebookEdit args', () => {
    expect(writeFragmentsFromItem(toolCall('Write', 'file_change', {
      file_path: '/abs/a.ts', content: 'body'
    }))).toEqual([{ path: '/abs/a.ts', text: 'body' }])
    expect(writeFragmentsFromItem(toolCall('MultiEdit', 'file_change', {
      file_path: '/abs/a.ts',
      edits: [{ old_string: 'o', new_string: 'n1' }, { old_string: 'x', new_string: 'n2' }]
    }))).toEqual([
      { path: '/abs/a.ts', text: 'n1' },
      { path: '/abs/a.ts', text: 'n2' }
    ])
    expect(writeFragmentsFromItem(toolCall('NotebookEdit', 'file_change', {
      notebook_path: '/abs/n.ipynb', new_source: 'cell'
    }))).toEqual([{ path: '/abs/n.ipynb', text: 'cell' }])
  })

  it('extracts ACP tool-result diffs', () => {
    const item = {
      ...base,
      kind: 'tool_result',
      toolName: 'acp:edit',
      callId: 'c1',
      toolKind: 'file_change',
      output: { diffs: [{ path: '/ws/a.ts', oldText: 'o', newText: 'n' }] },
      isError: false
    } as TurnItem
    expect(writeFragmentsFromItem(item)).toEqual([{ path: '/ws/a.ts', text: 'n' }])
  })

  it('ignores non-file items and malformed shapes', () => {
    expect(writeFragmentsFromItem(toolCall('read', 'tool_call', {
      path: 'a.ts', content: 'x'
    }))).toEqual([])
    expect(writeFragmentsFromItem({
      ...base, kind: 'assistant_text', text: 'hello'
    } as TurnItem)).toEqual([])
    expect(writeFragmentsFromItem({
      ...base, kind: 'tool_result', toolName: 'acp:edit', callId: 'c',
      toolKind: 'file_change', output: 'plain string', isError: false
    } as TurnItem)).toEqual([])
  })
})

function fixture(over: Partial<AttributionObserverDeps> = {}) {
  const recorded: Array<{ workspaceId: string; entry: Record<string, unknown> }> = []
  const ledger: Pick<AttributionLedger, 'record'> = {
    record: async (workspaceId, entry) => {
      recorded.push({ workspaceId, entry: entry as Record<string, unknown> })
    }
  }
  const deps: AttributionObserverDeps = {
    ledger,
    taskWorkspaces: {
      list: (filter) => filter?.boundThreadId === 'thr_worker'
        ? [{ workspaceId: 'tws_1', path: '/ws' } as never]
        : []
    },
    threads: { get: async () => ({ harnessId: 'claude-code' }) as never },
    teams: {
      list: async () => [{ teamId: 'team_1', workers: [{ workerId: 'thr_worker' }] } as never]
    },
    dispatches: {
      listByWorker: async () => [{ dispatchId: 'dsp_7' } as never]
    },
    nowIso: () => '2026-01-01T00:00:00Z',
    ...over
  }
  return { deps, recorded }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createAttributionObserver', () => {
  it('records fragments against the bound workspace with worker metadata', async () => {
    const { deps, recorded } = fixture()
    const observer = createAttributionObserver(deps)
    observer.record({
      kind: 'item_created', threadId: 'thr_worker', turnId: 'turn_1', itemId: 'it_1',
      item: toolCall('write', 'file_change', { path: '/ws/src/a.ts', content: 'const a = 1' })
    } as never)
    await flush()
    expect(recorded).toHaveLength(1)
    const { workspaceId, entry } = recorded[0]!
    expect(workspaceId).toBe('tws_1')
    expect(entry.path).toBe('src/a.ts')
    expect(entry.unitId).toBe('thr_worker')
    expect(entry.harnessId).toBe('claude-code')
    expect(entry.dispatchId).toBe('dsp_7')
    expect((entry.lineHashes as string[]).length).toBe(1)
  })

  it('resolves relative arg paths against the workspace root', async () => {
    const { deps, recorded } = fixture()
    createAttributionObserver(deps).record({
      kind: 'item_created', threadId: 'thr_worker', turnId: 'turn_1', itemId: 'it_1',
      item: toolCall('write', 'file_change', { path: 'src/a.ts', content: 'x = 1' })
    } as never)
    await flush()
    expect(recorded[0]?.entry.path).toBe('src/a.ts')
  })

  it('skips paths outside the workspace and unbound threads', async () => {
    const { deps, recorded } = fixture()
    const observer = createAttributionObserver(deps)
    observer.record({
      kind: 'item_created', threadId: 'thr_worker', turnId: 'turn_1', itemId: 'it_1',
      item: toolCall('write', 'file_change', { path: '/elsewhere/a.ts', content: 'x = 1' })
    } as never)
    observer.record({
      kind: 'item_created', threadId: 'thr_other', turnId: 'turn_1', itemId: 'it_2',
      item: toolCall('write', 'file_change', { path: 'a.ts', content: 'x = 1' })
    } as never)
    await flush()
    expect(recorded).toHaveLength(0)
  })

  it('ignores non-item_created events', async () => {
    const { deps, recorded } = fixture()
    createAttributionObserver(deps).record({
      kind: 'heartbeat', threadId: 'thr_worker'
    } as never)
    await flush()
    expect(recorded).toHaveLength(0)
  })
})
