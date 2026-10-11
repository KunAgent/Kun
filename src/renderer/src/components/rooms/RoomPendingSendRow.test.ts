import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import type { SendRoomMessage } from '@shared/rooms-api'
import i18n from '../../i18n'
import { RoomPendingSendRow } from './RoomPendingSendRow'
vi.mock('./RoomAvatar', () => ({ RoomAvatar: () => null }))
vi.mock('./RoomLegacyAttachment', () => ({ RoomLegacyAttachment: () => null }))
it('renders an attachment-only pending send as file cards instead of an empty message', async () => {
  await i18n.changeLanguage('en')
  let renderer!: ReturnType<typeof create>
  await act(async () => { renderer = create(createElement(RoomPendingSendRow, { item: {
    clientRequestId: 'send', body: '', createdAt: new Date().toISOString(), state: 'sending',
    message: { attachmentIds: ['image', 'doc'] } as SendRoomMessage,
    attachments: [{ id: 'image', name: 'diagram.png', mimeType: 'image/png', previewUrl: 'data:image/webp;base64,YQ==' },
      { id: 'doc', name: 'notes.pdf', mimeType: 'application/pdf' }]
  }, onRetry: vi.fn(), onDismiss: vi.fn() })) })
  expect(renderer.root.findAllByProps({ className: 'rooms-pending-body' })).toHaveLength(0)
  expect(renderer.root.findByType('img').props.alt).toBe('diagram.png')
  expect(JSON.stringify(renderer.toJSON())).toContain('notes.pdf')
  act(() => renderer.unmount())
})
