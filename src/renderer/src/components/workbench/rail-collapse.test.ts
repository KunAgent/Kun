import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create } from 'react-test-renderer'
import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import { RailCollapseButton, RailReopenButton, useRailCollapseStore } from './rail-collapse'

describe('right rail collapse', () => {
  beforeEach(async () => {
    useRailCollapseStore.setState({ collapsed: false })
    await i18n.changeLanguage('en')
  })

  it('shows no reopen button while the rail is open', () => {
    expect(renderToStaticMarkup(createElement(RailReopenButton))).toBe('')
  })

  it('folds from the rail button and reopens from the top bar button', () => {
    let rail!: ReturnType<typeof create>
    act(() => {
      rail = create(createElement(RailCollapseButton))
    })
    act(() => rail.root.findByProps({ 'aria-label': 'Collapse toolbar' }).props.onClick())
    expect(useRailCollapseStore.getState().collapsed).toBe(true)
    act(() => rail.unmount())

    let top!: ReturnType<typeof create>
    act(() => {
      top = create(createElement(RailReopenButton))
    })
    const reopen = top.root.findByProps({ className: 'kun-rail-reopen' })
    expect(reopen.props['aria-label']).toBe('Show toolbar')
    act(() => reopen.props.onClick())
    expect(useRailCollapseStore.getState().collapsed).toBe(false)
    act(() => top.unmount())
  })
})
