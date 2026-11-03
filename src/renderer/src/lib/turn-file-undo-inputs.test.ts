import { describe, expect, it } from 'vitest'
import type { ChatBlock } from '../agent/types'
import { collectTurnUndoInputs, readToolFileState, resolveTurnUndoRange } from './turn-file-undo-inputs'

const SHA_A = 'a'.repeat(64)
const SHA_B = 'B'.repeat(64)

function edit(id: string, path: string, sha?: string, status: 'success' | 'error' = 'success'): ChatBlock {
  return {
    kind: 'tool',
    id,
    summary: 'edit',
    status,
    toolKind: 'file_change',
    filePath: path,
    ...(sha ? { meta: { fileState: { path: `/repo/${path}`, afterSha256: sha } } } : {})
  }
}

describe('readToolFileState', () => {
  it('accepts only a path plus a sha256 hex digest', () => {
    expect(readToolFileState({ fileState: { path: '/repo/a.ts', afterSha256: SHA_B } }))
      .toEqual({ path: '/repo/a.ts', afterSha256: 'b'.repeat(64) })
    expect(readToolFileState({ fileState: { path: '/repo/a.ts', afterSha256: 'nope' } })).toBeNull()
    expect(readToolFileState({ fileState: 'x' })).toBeNull()
    expect(readToolFileState(undefined)).toBeNull()
  })
})

describe('collectTurnUndoInputs', () => {
  it('keeps the last end state per file and flags shell commands', () => {
    const blocks: ChatBlock[] = [
      edit('t1', 'src/a.ts', SHA_A),
      { kind: 'tool', id: 'c1', summary: 'npm test', status: 'success', toolKind: 'command_execution' },
      edit('t2', 'src/b.ts'),
      edit('t3', 'src/a.ts', SHA_B),
      edit('t4', 'src/failed.ts', SHA_A, 'error')
    ]
    expect(collectTurnUndoInputs(blocks, '/repo')).toEqual({
      files: [
        { path: '/repo/src/b.ts', afterSha256: null },
        { path: '/repo/src/a.ts', afterSha256: 'b'.repeat(64) }
      ],
      shellCommandsRan: true
    })
  })

  it('resolves relative tool paths against the workspace root', () => {
    expect(collectTurnUndoInputs([edit('t1', './notes.md')], 'C:\\work\\repo').files)
      .toEqual([{ path: 'C:\\work\\repo\\notes.md', afterSha256: null }])
  })
})

describe('resolveTurnUndoRange', () => {
  const blocks: ChatBlock[] = [
    { kind: 'user', id: 'u1', turnId: 'turn_1', text: 'one', meta: { workspaceCheckpointId: 'gcp_1' } },
    edit('t1', 'a.ts', SHA_A),
    { kind: 'user', id: 'u1b', turnId: 'turn_1', text: 'guidance' },
    edit('t2', 'b.ts', SHA_A),
    { kind: 'user', id: 'u2', turnId: 'turn_2', text: 'two', meta: { workspaceCheckpointId: 'gcp_2' } },
    edit('t3', 'c.ts', SHA_A)
  ]

  it('covers one turn including guided inputs and bounds it by the next checkpoint', () => {
    const range = resolveTurnUndoRange(blocks, 'u1', { untilEnd: false })
    expect(range?.checkpointId).toBe('gcp_1')
    expect(range?.blocks.map((block) => block.id)).toEqual(['t1', 'u1b', 't2'])
    expect(range?.windowEndCheckpointId).toBe('gcp_2')
  })

  it('covers every later turn for an edited message', () => {
    const range = resolveTurnUndoRange(blocks, 'u1', { untilEnd: true })
    expect(range?.blocks.map((block) => block.id)).toEqual(['t1', 'u1b', 't2', 'u2', 't3'])
    expect(range?.windowEndCheckpointId).toBeUndefined()
  })

  it('needs a checkpoint on the user message', () => {
    expect(resolveTurnUndoRange(blocks, 'u1b', { untilEnd: false })).toBeNull()
    expect(resolveTurnUndoRange(blocks, 'missing', { untilEnd: false })).toBeNull()
  })
})
