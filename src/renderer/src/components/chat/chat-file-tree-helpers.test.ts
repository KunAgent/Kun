import { describe, expect, it } from 'vitest'
import {
  chatFileTreeEntryReference,
  chatFileTreeUniqueRoots,
  owningChatFileTreeRoot
} from './chat-file-tree-helpers'

describe('chat file tree multi-root helpers', () => {
  it('keeps unique roots in primary-first order', () => {
    expect(chatFileTreeUniqueRoots('/tmp/app/', ['/tmp/api', '/tmp/app', '/tmp/api/'])).toEqual([
      '/tmp/app/',
      '/tmp/api'
    ])
  })

  it('picks the longest matching owning root', () => {
    const roots = ['/tmp/app', '/tmp/backend']
    expect(owningChatFileTreeRoot('/tmp/backend/src/index.ts', roots)).toBe('/tmp/backend')
    expect(owningChatFileTreeRoot('/tmp/app/src/index.ts', roots)).toBe('/tmp/app')
    expect(owningChatFileTreeRoot('/tmp/other/file.ts', roots)).toBe('/tmp/app')
  })

  it('attaches the owning workspaceRoot to file-tree references', () => {
    expect(chatFileTreeEntryReference({
      name: 'index.ts',
      path: '/tmp/backend/src/index.ts',
      type: 'file',
      ext: '.ts'
    }, '/tmp/backend')).toEqual({
      name: 'index.ts',
      path: '/tmp/backend/src/index.ts',
      relativePath: 'src/index.ts',
      type: 'file',
      workspaceRoot: '/tmp/backend'
    })
  })
})
