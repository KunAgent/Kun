// @vitest-environment jsdom

import { act, createElement, createRef, useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import '../../i18n'
import type { ComposerFileReference } from '../../lib/composer-file-references'
import {
  editedFileReferences,
  MessageEditAssistProvider,
  userToComposerFileReferences,
  UserMessageEditField
} from './UserMessageEditField'

describe('edited message file mentions', () => {
  const file = { path: '/repo/src/a.ts', relativePath: 'src/a.ts', name: 'a.ts', kind: 'file' as const }
  const folder = { path: '/repo/docs', relativePath: 'docs', name: 'docs', kind: 'directory' as const }

  it('round-trips sent references through the editor shape', () => {
    const composer = userToComposerFileReferences([file, folder])
    expect(composer.map((reference) => reference.type)).toEqual(['file', 'directory'])
    expect(editedFileReferences('see @src/a.ts and @docs/', composer)).toEqual([file, folder])
  })

  it('drops references whose mention was deleted from the edited text', () => {
    const composer = userToComposerFileReferences([file, folder])
    expect(editedFileReferences('only @docs/ now', composer)).toEqual([folder])
    expect(editedFileReferences('no mentions left', composer)).toEqual([])
  })
})

describe('UserMessageEditField skills', () => {
  it('offers skills for a leading slash and inserts the chosen one', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const textareaRef = createRef<HTMLTextAreaElement>()
    let latest = ''
    function Harness(): ReactElement {
      const [value, setValue] = useState('/rev')
      const [references, setReferences] = useState<ComposerFileReference[]>([])
      latest = value
      return createElement(MessageEditAssistProvider, {
        skillCommands: [
          { id: 'review-diff', name: 'Review diff', description: 'Review the working diff' },
          { id: 'write-tests', name: 'Write tests', description: 'Add missing tests' }
        ],
        children: createElement(UserMessageEditField, {
          value,
          onChange: setValue,
          references,
          onReferencesChange: setReferences,
          textareaRef,
          onSubmit: () => undefined,
          onCancel: () => undefined
        })
      })
    }
    await act(async () => root.render(createElement(Harness)))
    expect(container.textContent).toContain('Review diff')
    expect(container.textContent).not.toContain('Write tests')
    await act(async () => {
      textareaRef.current!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(latest).toBe('/skill:review-diff ')
    await act(async () => root.unmount())
    container.remove()
  })
})
