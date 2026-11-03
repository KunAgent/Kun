import { Fragment, createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../../i18n'
import {
  InterruptBadge,
  InterruptCard,
  InterruptCardBody,
  InterruptCardHeader,
  InterruptCountdownChip,
  InterruptFooter,
  InterruptFreeTextRow,
  InterruptNote,
  InterruptOptionList,
  InterruptOptionRow,
  InterruptPager,
  InterruptPreview,
  InterruptPrimaryButton,
  InterruptQuestionTitle,
  InterruptSecondaryButton,
  interruptOptionId
} from './interrupt-card-primitives'

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

function option(index: number, overrides: Record<string, unknown> = {}) {
  return createElement(InterruptOptionRow, {
    key: index,
    listId: 'ask',
    index,
    label: `Option ${index + 1}`,
    selected: false,
    onSelect: vi.fn(),
    ...overrides
  })
}

describe('interrupt card shell', () => {
  it('renders a focusable labelled region with the stack marker', () => {
    const html = renderToStaticMarkup(createElement(InterruptCard, {
      ariaLabel: 'Kun asks',
      marker: 'user-input',
      compact: true,
      children: createElement(Fragment, null,
        createElement(InterruptCardHeader, {
          trailing: createElement(InterruptPager, { index: 1, total: 3, onPrevious: vi.fn(), onNext: vi.fn() })
        }, createElement(InterruptBadge, { children: 'State management' })),
        createElement(InterruptQuestionTitle, { children: 'Where should login state live?' }),
        createElement(InterruptNote, { tone: 'faint', children: 'Choose up to 3' }))
    }))
    expect(html).toMatch(/^<section/)
    expect(html).toContain('tabindex="-1"')
    expect(html).toContain('aria-label="Kun asks"')
    expect(html).toContain('data-composer-stack-item="user-input"')
    expect(html).toContain('data-compact="true"')
    expect(html).toContain('ds-interrupt-badge')
    expect(html).toContain('2 / 3')
    expect(html).toContain('aria-label="2 of 3"')
    expect(html).toContain('<h2 class="ds-interrupt-question">')
    expect(html).toContain('data-tone="faint"')
  })

  it('hides the pager for a single item and disables edge buttons', () => {
    expect(renderToStaticMarkup(createElement(InterruptPager, { index: 0, total: 1, onPrevious: vi.fn(), onNext: vi.fn() }))).toBe('')
    const first = renderToStaticMarkup(createElement(InterruptPager, { index: 0, total: 2, onPrevious: vi.fn(), onNext: vi.fn() }))
    expect(first).toMatch(/aria-label="Previous"[^>]*disabled=""/)
    expect(first).not.toMatch(/aria-label="Next"[^>]*disabled=""/)
  })

  it('shows the countdown only near the deadline and a deciding label after it', () => {
    expect(renderToStaticMarkup(createElement(InterruptCountdownChip, { deadlineMs: Date.now() + 10 * 60_000 }))).toBe('')
    expect(renderToStaticMarkup(createElement(InterruptCountdownChip, { deadlineMs: null }))).toBe('')
    const counting = renderToStaticMarkup(createElement(InterruptCountdownChip, { deadlineMs: Date.now() + 42_000 }))
    expect(counting).toContain('data-interrupt-countdown="counting"')
    expect(counting).toMatch(/4[12] s/)
    const deciding = renderToStaticMarkup(createElement(InterruptCountdownChip, { deadlineMs: Date.now() - 1_000 }))
    expect(deciding).toContain('Kun is deciding on its own')
  })

  it('renders a scrolling body that passes data markers through', () => {
    const html = renderToStaticMarkup(createElement(InterruptCardBody, {
      'data-approval-evidence-scroll': true, children: 'diff'
    } as Record<string, unknown>))
    expect(html).toBe('<div data-approval-evidence-scroll="true" class="ds-interrupt-card-body">diff</div>')
  })

  it('renders a tool preview header with status', () => {
    const html = renderToStaticMarkup(createElement(InterruptPreview, {
      header: 'src/main/session-store.ts', status: 'Awaiting approval', children: createElement('pre', null, 'diff')
    }))
    expect(html).toContain('ds-interrupt-preview-status')
    expect(html).toContain('<pre>diff</pre>')
  })
})

describe('interrupt options', () => {
  it('builds an accessible single-choice listbox with numbered rows', () => {
    const html = renderToStaticMarkup(createElement(InterruptOptionList, {
      id: 'ask', activeIndex: 1,
      after: createElement(InterruptFreeTextRow, { index: 3, value: '', onChange: vi.fn(), placeholder: 'Type your own answer…' }),
      children: [option(0, { selected: true, recommended: true, description: 'Matches chat-store' }), option(1, { active: true }), option(2)]
    }))
    expect(html).toContain('role="listbox"')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('aria-label="Options"')
    expect(html).not.toContain('aria-multiselectable')
    expect(html).toContain(`aria-activedescendant="${interruptOptionId('ask', 1)}"`)
    expect(html).toContain('data-interrupt-autofocus')
    expect(html.match(/role="option"/g)).toHaveLength(3)
    expect(html).toContain('>1.<')
    expect(html).toContain('Recommended')
    expect(html).toContain('Matches chat-store')
    expect(html).toMatch(/aria-selected="true"[^>]*data-selected="true"/)
    expect(html).toMatch(/id="ask-option-1"[^>]*tabindex="-1"[^>]*data-active="true"/)
    // The free-text row sits after the listbox, not inside it.
    expect(html.indexOf('data-interrupt-freetext')).toBeGreaterThan(html.lastIndexOf('role="option"'))
    expect(html).toContain('>4.<')
    expect(html).toContain('placeholder="Type your own answer…"')
    expect(html).toContain('aria-label="Your own answer"')
    expect(html.match(/data-interrupt-autofocus/g)).toHaveLength(1)
  })

  it('makes the free-text row the autofocus target when asked (no options)', () => {
    const html = renderToStaticMarkup(createElement(InterruptOptionList, {
      id: 'free',
      after: createElement(InterruptFreeTextRow, { index: 0, value: '', onChange: vi.fn(), placeholder: 'Type', autoFocus: true }),
      children: []
    }))
    expect(html).not.toContain('role="listbox"')
    expect(html).toMatch(/<textarea[^>]*data-interrupt-autofocus="true"/)
  })

  it('uses checkboxes for multi-select and ignores a free-text active index', () => {
    const html = renderToStaticMarkup(createElement(InterruptOptionList, {
      id: 'multi', multiSelect: true, activeIndex: 2,
      after: createElement(InterruptFreeTextRow, { index: 2, value: '', onChange: vi.fn(), placeholder: 'Other', multiSelect: true }),
      children: [option(0, { multiSelect: true, selected: true }), option(1, { multiSelect: true, disabled: true })]
    }))
    expect(html).toContain('aria-multiselectable="true"')
    expect(html).not.toContain('aria-activedescendant')
    expect(html).toContain('data-checked="true"')
    expect(html).toContain('data-dashed="true"')
    expect(html).toContain('aria-disabled="true"')
    expect(html).not.toContain('>1.<')
  })
})

describe('interrupt footer', () => {
  it('renders the hint, secondary and primary buttons in a footer element', () => {
    const html = renderToStaticMarkup(createElement(InterruptFooter, { hint: '↑↓ to choose, Enter to submit' },
      createElement(InterruptSecondaryButton, { variant: 'ghost' }, 'Stop this turn'),
      createElement(InterruptPrimaryButton, { loading: true }, 'Confirm')))
    expect(html).toMatch(/^<footer class="ds-interrupt-footer">/)
    expect(html).toContain('lucide-info')
    expect(html).toContain('↑↓ to choose, Enter to submit')
    expect(html).toContain('data-variant="ghost"')
    expect(html).toContain('data-variant="primary"')
    expect(html).toContain('aria-busy="true"')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-busy="true"[^>]*data-variant="primary"/)
    expect(html).toContain('lucide-loader-circle')
  })
})
