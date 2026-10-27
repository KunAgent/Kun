import { act, createElement } from 'react'
import { create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { countDocumentWords } from './WriteDocStatusLine'
import { SelectionActionStrip } from './selection-menu/SelectionActionStrip'
import { formatXlsxStat, summarizeXlsxSelection } from '../workspace-xlsx-selection'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('document word count', () => {
  it('counts CJK characters one each and other words by spaces, skipping markup and frontmatter', () => {
    const doc = '---\ntitle: x\n---\n# 问题定义\n\nLarge models **invent** APIs. [见](https://a.b)\n\n```ts\nignored code\n```'
    expect(countDocumentWords(doc)).toBe(4 + 4 + 1)
  })
})

describe('spreadsheet selection summary', () => {
  it('sums numeric cells, counts all non-empty ones', () => {
    expect(summarizeXlsxSelection('0.42\t1,200\n50%\tn/a\n\t')).toEqual({ cells: 4, numbers: 3, sum: 1200.92, mean: 1200.92 / 3 })
    expect(formatXlsxStat(0.1 + 0.2, 'en')).toBe('0.3')
  })
})

describe('selection action strip', () => {
  it('rewrites and expands in place, explains in the session and quotes', async () => {
    const onAskEdit = vi.fn()
    const onAskChat = vi.fn()
    const onQuoteSelection = vi.fn()
    const onDone = vi.fn()
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(SelectionActionStrip, { editEnabled: true, onAskEdit, onAskChat, onQuoteSelection, onDone }))
    })
    for (const id of ['rewrite', 'expand', 'explain', 'quote']) {
      renderer!.root.findByProps({ 'data-selection-action': id }).props.onClick()
    }
    expect(onAskEdit.mock.calls).toEqual([['writeSelectionActionRewritePrompt'], ['writeSelectionActionExpandPrompt']])
    expect(onAskChat).toHaveBeenCalledWith('writeQuickActionExplainPrompt')
    expect(onQuoteSelection).toHaveBeenCalledOnce()
    expect(onDone).toHaveBeenCalledTimes(4)
  })

  it('hides the editing moves when the document cannot be edited', async () => {
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(SelectionActionStrip, { editEnabled: false, onAskEdit: vi.fn(), onAskChat: vi.fn(), onDone: vi.fn() }))
    })
    expect(renderer!.root.findAll((node) => typeof node.props['data-selection-action'] === 'string')
      .map((node) => node.props['data-selection-action'])).toEqual(['explain'])
  })
})
