// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearApprovalDenyNotes,
  readApprovalDenyNote,
  rememberApprovalDenyNote,
  useApprovalDenyNote
} from './approval-deny-note-memory'

afterEach(() => {
  clearApprovalDenyNotes()
})

describe('approval deny note memory', () => {
  it('stores trimmed notes per approval block and forgets blank ones', () => {
    rememberApprovalDenyNote('blk_1', '  use a dry run first ')
    expect(readApprovalDenyNote('blk_1')).toBe('use a dry run first')
    expect(readApprovalDenyNote('blk_2')).toBeNull()
    expect(readApprovalDenyNote(null)).toBeNull()
    rememberApprovalDenyNote('blk_1', '   ')
    expect(readApprovalDenyNote('blk_1')).toBeNull()
  })

  it('stays bounded, dropping the oldest notes first', () => {
    for (let index = 0; index < 205; index += 1) rememberApprovalDenyNote(`blk_${index}`, `note ${index}`)
    expect(readApprovalDenyNote('blk_0')).toBeNull()
    expect(readApprovalDenyNote('blk_4')).toBeNull()
    expect(readApprovalDenyNote('blk_5')).toBe('note 5')
    expect(readApprovalDenyNote('blk_204')).toBe('note 204')
  })

  it('re-renders a reader when the note arrives', async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const host = document.createElement('div')
    const root = createRoot(host)
    function Record(): ReactElement {
      return createElement('span', null, useApprovalDenyNote('blk_9') ?? 'none')
    }
    try {
      await act(async () => root.render(createElement(Record)))
      expect(host.textContent).toBe('none')
      await act(async () => rememberApprovalDenyNote('blk_9', 'try the staging db'))
      expect(host.textContent).toBe('try the staging db')
    } finally {
      await act(async () => root.unmount())
      ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false
    }
  })
})
