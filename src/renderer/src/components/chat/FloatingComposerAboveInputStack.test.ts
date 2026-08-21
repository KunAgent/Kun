import { readFile } from 'node:fs/promises'
import { Fragment, createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  COMPOSER_FLOATING_STATUS_HEIGHT_PROPERTY,
  FloatingComposerAboveInputStack,
  publishComposerFloatingStatusHeight
} from './FloatingComposerAboveInputStack'

describe('FloatingComposerAboveInputStack', () => {
  it('floats ordered summaries while keeping large panels in normal flow', () => {
    const html = renderToStaticMarkup(createElement(FloatingComposerAboveInputStack, {
      floatingStatuses: createElement(Fragment, null,
        createElement('div', { 'data-composer-stack-item': 'todo' }),
        createElement('div', { 'data-composer-stack-item': 'graph' }),
        createElement('div', { 'data-composer-stack-item': 'goal' })
      ),
      flowPanels: createElement(Fragment, null,
        createElement('div', { 'data-composer-queue': true }),
        createElement('div', { 'data-composer-stack-item': 'user-input' })
      )
    }))

    const floatingIndex = html.indexOf('data-composer-floating-status-stack')
    const todoIndex = html.indexOf('data-composer-stack-item="todo"')
    const graphIndex = html.indexOf('data-composer-stack-item="graph"')
    const goalIndex = html.indexOf('data-composer-stack-item="goal"')
    const flowIndex = html.indexOf('data-composer-flow-panel-stack')
    const queueIndex = html.indexOf('data-composer-queue')
    const userInputIndex = html.indexOf('data-composer-stack-item="user-input"')

    expect(floatingIndex).toBeGreaterThanOrEqual(0)
    expect(todoIndex).toBeGreaterThan(floatingIndex)
    expect(graphIndex).toBeGreaterThan(todoIndex)
    expect(goalIndex).toBeGreaterThan(graphIndex)
    expect(flowIndex).toBeGreaterThan(goalIndex)
    expect(queueIndex).toBeGreaterThan(flowIndex)
    expect(userInputIndex).toBeGreaterThan(queueIndex)
    expect(html).toContain('pointer-events-none absolute inset-x-0 bottom-full')
    expect(html).toContain('data-composer-flow-panel-stack')
  })

  it('publishes a finite rounded reserve and ignores missing chat stacks', () => {
    const style = {
      setProperty: vi.fn(),
      removeProperty: vi.fn()
    }
    const chatStack = { style }
    const floatingStack = {
      closest: vi.fn(() => chatStack)
    } as unknown as HTMLElement

    expect(publishComposerFloatingStatusHeight(floatingStack, 43.2)).toBe(chatStack)
    expect(style.setProperty).toHaveBeenLastCalledWith(
      COMPOSER_FLOATING_STATUS_HEIGHT_PROPERTY,
      '44px'
    )

    publishComposerFloatingStatusHeight(floatingStack, Number.NaN)
    expect(style.setProperty).toHaveBeenLastCalledWith(
      COMPOSER_FLOATING_STATUS_HEIGHT_PROPERTY,
      '0px'
    )

    const detachedStack = { closest: vi.fn(() => null) } as unknown as HTMLElement
    expect(publishComposerFloatingStatusHeight(detachedStack, 20)).toBeNull()
  })

  it('defines a theme-aware 40px frost with dynamic scroll reserve', async () => {
    const [css, baseShell] = await Promise.all([
      readFile(new URL('../../styles/base-shell/composer-status-overlay.css', import.meta.url), 'utf8'),
      readFile(new URL('../../styles/base-shell.css', import.meta.url), 'utf8')
    ])

    expect(baseShell).toContain("@import './base-shell/composer-status-overlay.css';")
    expect(css).toContain('--ds-composer-transition-height: 2.5rem')
    expect(css).not.toContain('--ds-composer-transition-height: 4rem')
    expect(css).toMatch(/\.ds-composer-dock::before\s*\{[^}]*top:\s*0;/s)
    expect(css).not.toContain('top: calc(0px - var(--ds-composer-transition-height))')
    expect(css).toContain('var(--ds-composer-floating-status-height)')
    expect(css).toContain('var(--bg-canvas)')
    expect(css).toContain('backdrop-filter: blur(12px)')
    expect(css).toContain('mask-image: linear-gradient')
    expect(css).toContain('pointer-events: none')
    expect(css).toContain('.ds-composer-status-glass')
  })
})
