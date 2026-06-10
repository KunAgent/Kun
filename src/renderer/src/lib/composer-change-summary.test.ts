import { describe, expect, it } from 'vitest'
import type { ChatBlock } from '../agent/types'
import { collectComposerChangeSummary } from './composer-change-summary'

describe('collectComposerChangeSummary', () => {
  it('summarizes successful file changes by display path', () => {
    const blocks: ChatBlock[] = [
      {
        kind: 'tool',
        id: 'tool_1',
        summary: 'edit',
        status: 'success',
        toolKind: 'file_change',
        detail: [
          'diff --git a/src/a.ts b/src/a.ts',
          '--- a/src/a.ts',
          '+++ b/src/a.ts',
          '@@ -1,2 +1,3 @@',
          ' old',
          '-remove',
          '+add',
          '+more'
        ].join('\n')
      },
      {
        kind: 'tool',
        id: 'tool_2',
        summary: 'edit',
        status: 'success',
        toolKind: 'file_change',
        filePath: 'src/a.ts',
        detail: [
          '--- a/src/a.ts',
          '+++ b/src/a.ts',
          '@@ -1 +1 @@',
          '-again',
          '+next'
        ].join('\n')
      }
    ]

    expect(collectComposerChangeSummary(blocks, '/repo')).toEqual({
      files: [{ path: 'src/a.ts', added: 3, removed: 2 }],
      added: 3,
      removed: 2
    })
  })

  it('ignores pending tools and non-diff details', () => {
    const blocks: ChatBlock[] = [
      {
        kind: 'tool',
        id: 'tool_1',
        summary: 'edit',
        status: 'running',
        toolKind: 'file_change',
        detail: 'diff --git a/a b/a'
      },
      {
        kind: 'tool',
        id: 'tool_2',
        summary: 'tool',
        status: 'success',
        toolKind: 'tool_call',
        detail: 'ok'
      }
    ]

    expect(collectComposerChangeSummary(blocks, '/repo')).toBeNull()
  })
})
