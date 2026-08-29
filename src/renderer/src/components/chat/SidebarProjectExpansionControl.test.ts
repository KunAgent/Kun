import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create as createRenderer, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import {
  SidebarProjectExpansionControl,
  type SidebarProjectExpansionControlProps
} from './SidebarProjectExpansionControl'

function controlProps(overrides: Partial<SidebarProjectExpansionControlProps> = {}): SidebarProjectExpansionControlProps {
  return {
    hiddenThreadCount: 0,
    canLoadMore: false,
    loading: false,
    canCollapse: false,
    onShowMore: vi.fn(),
    onLoadMore: vi.fn(),
    onCollapse: vi.fn(),
    t: (key: string) => key,
    ...overrides
  }
}

type ControlButton = { label: string; node: { props: Record<string, unknown> } }

function flattenButtonLabel(node: { props: Record<string, unknown> }): string {
  const ariaLabel = node.props['aria-label']
  if (typeof ariaLabel === 'string' && ariaLabel) return ariaLabel
  const children = node.props.children
  if (typeof children === 'string') return children
  if (Array.isArray(children)) {
    return children.map((child) => {
      if (typeof child === 'string') return child
      const text = (child as { props?: Record<string, unknown> } | null)?.props?.children
      return typeof text === 'string' ? text : ''
    }).join('')
  }
  return ''
}

function findControlButtons(root: ReactTestRenderer['root']): ControlButton[] {
  return root.findAll((node) => node.type === 'button')
    .map((node) => ({ label: flattenButtonLabel(node), node }))
}

function findButtonByLabel(root: ReactTestRenderer['root'], label: string) {
  const match = findControlButtons(root).find((button) => button.label === label)
  if (!match) throw new Error(`button not found: ${label}`)
  return match.node
}

describe('SidebarProjectExpansionControl', () => {
  it('renders only the primary action at the initial stage', () => {
    const html = renderToStaticMarkup(createElement(SidebarProjectExpansionControl, controlProps({
      hiddenThreadCount: 3
    })))
    expect(html).toContain('sidebarWorkspaceShowMore')
    expect(html).not.toContain('sidebarWorkspaceShowLess')
  })

  it('hides the whole control when nothing remains locally or remotely', () => {
    const html = renderToStaticMarkup(createElement(SidebarProjectExpansionControl, controlProps()))
    expect(html).toBe('')
  })

  it('pairs show-more with collapse while hidden loaded threads remain', () => {
    const html = renderToStaticMarkup(createElement(SidebarProjectExpansionControl, controlProps({
      hiddenThreadCount: 4,
      canCollapse: true
    })))
    expect(html).toContain('sidebarWorkspaceShowMore')
    expect(html).toContain('sidebarWorkspaceShowLess')
  })

  it('pairs load-more with collapse while the remote has another page', () => {
    const html = renderToStaticMarkup(createElement(SidebarProjectExpansionControl, controlProps({
      canLoadMore: true,
      canCollapse: true
    })))
    expect(html).toContain('sidebarWorkspaceLoadMore')
    expect(html).toContain('sidebarWorkspaceShowLess')
  })

  it('disables the primary action while loading but keeps collapse clickable', () => {
    let renderer: ReactTestRenderer | null = null
    try {
      act(() => {
        renderer = createRenderer(createElement(SidebarProjectExpansionControl, controlProps({
          canLoadMore: true,
          loading: true,
          canCollapse: true
        })))
      })
      const primary = findButtonByLabel(renderer!.root, 'sidebarWorkspaceLoading')
      expect(primary.props.disabled).toBe(true)
      expect(primary.props['aria-busy']).toBe(true)
      const collapse = findButtonByLabel(renderer!.root, 'sidebarWorkspaceShowLess')
      expect(collapse.props.disabled).toBeUndefined()
    } finally {
      ;(renderer as ReactTestRenderer | null)?.unmount()
    }
  })

  it('keeps collapse as the only action once the remote is complete', () => {
    const html = renderToStaticMarkup(createElement(SidebarProjectExpansionControl, controlProps({
      canCollapse: true
    })))
    expect(html).toContain('sidebarWorkspaceShowLess')
    expect(html).not.toContain('sidebarWorkspaceLoadMore')
    expect(html).not.toContain('sidebarWorkspaceLoading')
  })

  it('routes clicks to one dedicated callback per action', async () => {
    let renderer: ReactTestRenderer | null = null
    try {
      const onShowMore = vi.fn()
      const onLoadMore = vi.fn()
      const onCollapse = vi.fn()
      await act(async () => {
        renderer = createRenderer(createElement(SidebarProjectExpansionControl, controlProps({
          hiddenThreadCount: 2,
          canLoadMore: true,
          canCollapse: true,
          onShowMore,
          onLoadMore,
          onCollapse
        })))
      })
      await act(async () => {
        (findButtonByLabel(renderer!.root, 'sidebarWorkspaceShowMore') as { props: { onClick: () => void } }).props.onClick()
      })
      await act(async () => {
        (findButtonByLabel(renderer!.root, 'sidebarWorkspaceShowLess') as { props: { onClick: () => void } }).props.onClick()
      })
      expect(onShowMore).toHaveBeenCalledTimes(1)
      expect(onCollapse).toHaveBeenCalledTimes(1)
      expect(onLoadMore).not.toHaveBeenCalled()
    } finally {
      ;(renderer as ReactTestRenderer | null)?.unmount()
    }
  })
})
