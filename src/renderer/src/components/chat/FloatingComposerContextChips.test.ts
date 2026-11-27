import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesignComposerContext } from '../../design/design-composer-context'
import { FloatingComposerContextChips } from './FloatingComposerContextChips'

const quoteChip: DesignComposerContext = {
  id: 'workspace-selection-context:test',
  kind: 'document-quote',
  label: 'weekly-report.docx',
  removable: true,
  quote: {
    pageStart: 1,
    pageEnd: 1,
    charCount: 23,
    text: 'The complete selected passage'
  }
}

describe('FloatingComposerContextChips', () => {
  let dom: JSDOM
  let renderer: ReactTestRenderer | undefined

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    dom = new JSDOM('<!doctype html><html><body></body></html>')
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('Node', dom.window.document.createTextNode('').constructor)
  })

  afterEach(async () => {
    if (renderer) await act(async () => renderer?.unmount())
    dom.window.close()
    vi.unstubAllGlobals()
  })

  it('keeps quote text collapsed until the compact source chip is opened', async () => {
    const onRemove = vi.fn()
    const t = (key: string, values?: unknown): string => {
      const record = values as Record<string, number> | undefined
      if (key === 'composerDocumentQuotePage') return `Page ${record?.page}`
      if (key === 'composerDocumentQuoteCharacters') return `${record?.count} characters`
      return key
    }
    await act(async () => {
      renderer = create(createElement(FloatingComposerContextChips, {
        chips: [quoteChip],
        onRemove,
        t
      }))
    })

    expect(JSON.stringify(renderer!.toJSON())).not.toContain('The complete selected passage')
    const chipButton = renderer!.root.findByProps({ 'data-document-quote-chip': true })
    expect(chipButton.props['aria-expanded']).toBe(false)
    await act(async () => chipButton.props.onClick())
    expect(JSON.stringify(renderer!.toJSON())).toContain('The complete selected passage')

    await act(async () => renderer!.root.findByProps({
      'aria-label': 'composerRemoveContext'
    }).props.onClick())
    expect(onRemove).toHaveBeenCalledWith(quoteChip.id)
  })

  it('renders tray reference chips and reveals their hover preview card', async () => {
    const onRemove = vi.fn()
    const trayChip: DesignComposerContext = {
      id: 'workspace-selection-context:tray1',
      kind: 'tray-reference',
      label: '#2 Verify session UI',
      removable: true,
      trayReference: {
        targetKind: 'todo',
        targetId: 'todo_2',
        badge: '#2',
        title: 'Verify session UI',
        statusLabel: 'In progress',
        tone: 'running',
        note: 'Checking hover tooltip',
        stepIndex: 2,
        totalSteps: 4
      }
    }
    await act(async () => {
      renderer = create(createElement(FloatingComposerContextChips, {
        chips: [trayChip],
        onRemove,
        t: (key) => key
      }))
    })

    expect(JSON.stringify(renderer!.toJSON())).toContain('#2')
    expect(JSON.stringify(renderer!.toJSON())).toContain('Verify session UI')
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('Checking hover tooltip')

    const wrapper = renderer!.root.findByProps({ 'data-tray-reference-chip': 'todo' })
    await act(async () => wrapper.props.onMouseEnter())
    expect(JSON.stringify(renderer!.toJSON())).toContain('Checking hover tooltip')
    expect(JSON.stringify(renderer!.toJSON())).toContain('In progress')

    await act(async () => renderer!.root.findByProps({
      'aria-label': 'composerRemoveContext'
    }).props.onClick())
    expect(onRemove).toHaveBeenCalledWith(trayChip.id)
  })
})
