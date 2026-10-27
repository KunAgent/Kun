import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ComposerActionFlyout, type ComposerFlyoutItem } from './FloatingComposerActionFlyout'

const items: ComposerFlyoutItem[] = [
  { id: 'sdd-spec', name: 'sdd-spec', description: 'Turn a request into a spec' },
  { id: 'code-review', name: 'code-review', description: 'Review the current diff' },
  { id: 'weekly', name: 'weekly-report', description: 'Summarise the week' }
]

const labels = {
  title: 'Skills', search: 'Search skills', empty: 'No skills available',
  manage: 'Manage skills', explore: 'Explore more skills'
}

function render(overrides: Partial<Parameters<typeof ComposerActionFlyout>[0]> = {}) {
  const handlers = { onPick: vi.fn(), onManage: vi.fn(), onExplore: vi.fn(), onClose: vi.fn() }
  let renderer!: ReturnType<typeof create>
  act(() => {
    renderer = create(createElement(ComposerActionFlyout, {
      kind: 'skills', items, labels, place: () => ({ left: 10, top: 10, width: 340, maxHeight: 400 }),
      ...handlers, ...overrides
    }))
  })
  return { renderer, ...handlers }
}

describe('composer action flyout', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists the items with manage and explore actions', () => {
    const { renderer } = render()
    const rows = renderer.root.findAllByProps({ role: 'menuitem' }).filter((node) => typeof node.type === 'string')
    expect(rows).toHaveLength(items.length + 2)
    const text = JSON.stringify(renderer.toJSON())
    expect(text).toContain('Manage skills')
    expect(text).toContain('Explore more skills')
    act(() => renderer.unmount())
  })

  it('filters by name or description and picks the clicked item', () => {
    const { renderer, onPick } = render()
    const input = renderer.root.findByType('input')
    act(() => input.props.onChange({ target: { value: 'diff' } }))
    const rows = renderer.root.findAllByProps({ role: 'menuitem' }).filter((node) => typeof node.type === 'string')
    expect(rows).toHaveLength(3)
    act(() => rows[0]!.props.onClick())
    expect(onPick).toHaveBeenCalledWith(items[1])
    act(() => renderer.unmount())
  })

  it('shows the empty label and closes on Escape', () => {
    const { renderer, onClose } = render({ items: [] })
    expect(JSON.stringify(renderer.toJSON())).toContain('No skills available')
    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()
    act(() => renderer.root.findByProps({ 'data-composer-flyout': 'skills' }).props.onKeyDown({ key: 'Escape', preventDefault, stopPropagation }))
    expect(onClose).toHaveBeenCalledOnce()
    act(() => renderer.unmount())
  })
})
