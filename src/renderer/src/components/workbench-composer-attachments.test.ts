import { describe, expect, it } from 'vitest'
import type { AttachmentReference } from '../agent/types'
import {
  composerAttachmentScopeForSurface,
  createEmptyComposerAttachmentsByScope,
  removeComposerAttachmentsById,
  updateComposerAttachmentsByScope
} from './workbench-composer-attachments'
import { BUILTIN_RIGHT_PANEL_IDS } from '../extensions/contribution-ids'

function image(id: string): AttachmentReference {
  return { id, kind: 'image', name: `${id}.png`, mimeType: 'image/png' }
}

describe('workbench composer attachment scopes', () => {
  it('maps assistant surfaces to isolated attachment scopes', () => {
    expect(composerAttachmentScopeForSurface('chat', null)).toBe('chat')
    expect(composerAttachmentScopeForSurface('ade', null)).toBe('ade')
    expect(composerAttachmentScopeForSurface('ade', BUILTIN_RIGHT_PANEL_IDS.sddAi)).toBe('ade')
    expect(composerAttachmentScopeForSurface('write', null)).toBe('write')
    expect(composerAttachmentScopeForSurface('design', null)).toBe('design')
    expect(composerAttachmentScopeForSurface('chat', BUILTIN_RIGHT_PANEL_IDS.sddAi)).toBe('sdd')
    expect(composerAttachmentScopeForSurface('claw', null)).toBe('inactive')
  })

  it('updates only the target scope', () => {
    const initial = createEmptyComposerAttachmentsByScope()
    const withChatImage = updateComposerAttachmentsByScope(initial, 'chat', [image('code-drawing')])
    const withDesignImage = updateComposerAttachmentsByScope(withChatImage, 'design', (current) => [
      ...current,
      image('design-canvas')
    ])

    expect(withDesignImage.chat.map((attachment) => attachment.id)).toEqual(['code-drawing'])
    expect(withDesignImage.ade).toEqual([])
    expect(withDesignImage.design.map((attachment) => attachment.id)).toEqual(['design-canvas'])
    expect(withDesignImage.write).toEqual([])
    expect(withDesignImage.sdd).toEqual([])
  })

  it('removes only captured attachment ids and preserves later additions', () => {
    const attachments = [image('sent'), image('added-while-sending')]

    expect(removeComposerAttachmentsById(attachments, ['sent'])).toEqual([
      image('added-while-sending')
    ])
  })
})
