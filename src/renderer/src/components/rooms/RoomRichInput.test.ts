// @vitest-environment jsdom
import { act, createRef, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Editor } from '@tiptap/core'
import type { Room } from '@shared/rooms-api'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RoomRichInput, type RoomRichInputHandle } from './RoomRichInput'
import { roomMentionToken, roomRichContent, roomRichDraft, roomSendMentionIds } from './room-mentions'
import i18n from '../../i18n'

const room = { id: 'room', members: [
  { id: 'developer', displayName: 'Developer', enabled: true },
  { id: 'reviewer', displayName: 'Reviewer', enabled: false }
] } as Room
let root: Root, element: HTMLDivElement
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  await i18n.changeLanguage('en')
  element = document.createElement('div'); document.body.append(element); root = createRoot(element)
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => new DOMRect()
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => [] as unknown as DOMRectList
})
afterEach(async () => { await act(async () => root.unmount()); element.remove(); vi.unstubAllGlobals() })
async function render(body = '', mentions: string[] = []) {
  const change = vi.fn(), submit = vi.fn(), ref = createRef<RoomRichInputHandle>()
  await act(async () => root.render(createElement(RoomRichInput, { ref, room, value: body, mentions, placeholder: 'Message', onChange: change, onSubmit: submit })))
  const dom = element.querySelector('.ProseMirror') as HTMLDivElement & { editor: Editor }
  expect(dom).not.toBeNull()
  const editor = dom.editor
  const key = async (properties: KeyboardEventInit) => { await act(async () => { dom.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...properties })) }) }
  return { change, submit, ref, dom, editor, key }
}

describe('minimal room rich editor', () => {
  it('inserts an atomic member at the caret while retaining trailing text', async () => {
    const f = await render('Ask @Dev about tests')
    await act(async () => { f.editor.commands.setTextSelection(9) })
    expect(element.querySelector('[role="option"]')?.textContent).toBe('@Developer')
    await f.key({ key: 'Enter' })
    const saved = roomRichDraft(f.editor.getJSON())
    expect(saved.mentions).toEqual(['developer'])
    expect(saved.body).toContain('about tests')
    expect(saved.body).toContain(roomMentionToken('developer', 'Developer'))
    expect(f.dom.querySelector('[data-room-mention="developer"]')?.getAttribute('contenteditable')).toBe('false')
    expect(f.submit).not.toHaveBeenCalled()
  })

  it('sends with Enter, inserts a newline with Shift, and protects IME', async () => {
    const f = await render('Discuss')
    await act(async () => { f.editor.commands.setTextSelection(f.editor.state.doc.content.size - 1) })
    await f.key({ key: 'Enter', shiftKey: true })
    expect(roomRichDraft(f.editor.getJSON()).body).toContain('\n')
    expect(f.submit).not.toHaveBeenCalled()
    await f.key({ key: 'Enter', metaKey: true, isComposing: true, keyCode: 229 })
    expect(f.submit).not.toHaveBeenCalled()
    await f.key({ key: 'Enter', metaKey: true })
    expect(f.submit).toHaveBeenCalledTimes(1)
    await f.key({ key: 'Enter' })
    expect(f.submit).toHaveBeenCalledTimes(2)
  })

  it('pastes plain content and never turns pasted mention syntax into recipients', async () => {
    const f = await render()
    const content = '[@Developer](#kun-room-member-developer) <b>plain</b>\nsecond line'
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: { files: [], getData: () => content } })
    await act(async () => { f.dom.dispatchEvent(event) })
    expect(roomRichDraft(f.editor.getJSON())).toEqual({ body: content, mentions: [] })
    expect(f.dom.querySelector('[data-room-mention]')).toBeNull()
  })

  it('restores only explicit draft mention identities and expands @all using current enabled members', () => {
    const body = roomMentionToken('*', 'all') + ' ' + roomMentionToken('developer', 'Dev [code]')
    expect(roomRichDraft(roomRichContent(body, ['*', 'developer']))).toEqual({ body, mentions: ['*', 'developer'] })
    expect(roomRichDraft(roomRichContent(body, [])).mentions).toEqual([])
    expect(roomSendMentionIds(['*'], room)).toEqual(['developer'])
    // Named draft recipients stay explicit; the host reports removal instead of routing to a default member.
    expect(roomSendMentionIds(['reviewer'], room)).toEqual(['reviewer'])
  })
})
