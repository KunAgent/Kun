import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'

vi.mock('react-dom', () => ({
  createPortal: (children: ReactNode) => children
}))

import {
  BackgroundShellOverlay,
  calculateBackgroundShellPopoverPlacement,
  stripAnsiSequences
} from './BackgroundShellOverlay'

type RuntimeRequestResult = { ok: boolean; status: number; body: string }
type ShellOverrides = { status?: string; output?: string; exitCode?: number | null }

function backgroundShell(
  id: string,
  threadId: string,
  command: string,
  overrides: ShellOverrides = {}
): Record<string, unknown> {
  return {
    id,
    threadId,
    turnId: `turn-${threadId}`,
    command,
    cwd: '/workspace',
    shell: 'zsh',
    status: overrides.status ?? 'running',
    startedAt: '2026-07-24T00:00:00.000Z',
    exitCode: overrides.exitCode ?? null,
    output: overrides.output ?? '',
    detached: true
  }
}

function response(sessions: Array<Record<string, unknown>>): RuntimeRequestResult {
  return { ok: true, status: 200, body: JSON.stringify({ sessions, running: sessions.length }) }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function renderedText(renderer: ReactTestRenderer): string {
  return JSON.stringify(renderer.toJSON())
}

async function renderOverlay(runtimeRequest: ReturnType<typeof vi.fn>): Promise<ReactTestRenderer> {
  vi.stubGlobal('document', { body: {}, documentElement: {} })
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    cancelAnimationFrame: vi.fn(),
    clearInterval,
    getComputedStyle: vi.fn(() => ({ zoom: '1' })),
    innerHeight: 900,
    innerWidth: 1200,
    kunGui: { runtimeRequest },
    removeEventListener: vi.fn(),
    requestAnimationFrame: vi.fn(() => 1),
    setInterval
  })
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(createElement(BackgroundShellOverlay, {
      runtimeReady: true,
      threadId: 'thread-a'
    }))
    await Promise.resolve()
  })
  return renderer
}

async function openOverlay(renderer: ReactTestRenderer): Promise<void> {
  await act(async () => { renderer.root.findByType('button').props.onClick() })
}

describe('BackgroundShellOverlay', () => {
  beforeEach(async () => { await i18n.changeLanguage('en') })
  afterEach(() => { vi.unstubAllGlobals() })

  it('calculates responsive placement above, below, and through body zoom', () => {
    expect(calculateBackgroundShellPopoverPlacement({
      anchorRect: { left: 500, right: 700, top: 760, bottom: 804 },
      popoverHeight: 560,
      viewportHeight: 900,
      viewportWidth: 1200
    })).toEqual({ left: 232, top: 192, width: 736, maxHeight: 620 })

    expect(calculateBackgroundShellPopoverPlacement({
      anchorRect: { left: 100, right: 220, top: 40, bottom: 84 },
      popoverHeight: 300,
      viewportHeight: 500,
      viewportWidth: 320
    })).toEqual({ left: 12, top: 92, width: 296, maxHeight: 396 })

    expect(calculateBackgroundShellPopoverPlacement({
      anchorRect: { left: 880, right: 1120, top: 1400, bottom: 1488 },
      popoverHeight: 300,
      viewportHeight: 1800,
      viewportWidth: 2000,
      coordinateScale: 2
    })).toEqual({ left: 132, top: 392, width: 736, maxHeight: 620 })
  })

  it('renders localized shell controls in English and Chinese', async () => {
    const runtimeRequest = vi.fn(async () => response([
      backgroundShell('shell-a', 'thread-a', 'npm run test')
    ]))
    const renderer = await renderOverlay(runtimeRequest)

    for (const [locale, expected] of [['en', 'Background shells'], ['zh', '后台 Shell']] as const) {
      await i18n.changeLanguage(locale)
      await act(async () => { renderer.update(createElement(BackgroundShellOverlay, {
        runtimeReady: true,
        threadId: 'thread-a'
      })) })
      const trigger = renderer.root.findByProps({ 'aria-haspopup': 'dialog' })
      if (!trigger.props['aria-expanded']) await openOverlay(renderer)
      expect(renderedText(renderer)).toContain(expected)
      expect(renderedText(renderer)).not.toContain('backgroundShells.')
    }
    act(() => renderer.unmount())
  })

  it('exposes a floating composer trigger and dialog semantics', async () => {
    const renderer = await renderOverlay(vi.fn(async () => response([
      backgroundShell('shell-a', 'thread-a', 'npm run test')
    ])))
    const root = renderer.root.findByProps({ 'data-composer-stack-item': 'background-shell' })
    const trigger = root.findByType('button')
    expect(trigger.props['aria-expanded']).toBe(false)
    expect(trigger.props['aria-haspopup']).toBe('dialog')
    await openOverlay(renderer)
    expect(renderer.root.findByProps({ 'data-background-shell-popover': true }).props.role).toBe('dialog')
    expect(root.findByType('button').props['aria-expanded']).toBe(true)
    act(() => renderer.unmount())
  })

  it('strips ANSI escape sequences from rendered shell output', async () => {
    const runtimeRequest = vi.fn(async () => response([
      backgroundShell('shell-a', 'thread-a', 'npm run test', {
        output: '\u001B[32m✓\u001B[39m passed \u001B[2m(4 tests)\u001B[22m'
      })
    ]))
    const renderer = await renderOverlay(runtimeRequest)
    await openOverlay(renderer)
    const text = renderedText(renderer)
    expect(text).toContain('✓ passed (4 tests)')
    expect(text).not.toContain('[32m')
    expect(text).not.toContain('[2m')
    act(() => renderer.unmount())
  })

  it('leaves plain text untouched when no escape sequences exist', () => {
    expect(stripAnsiSequences('plain output line')).toBe('plain output line')
  })

  it('keeps long commands and output inside the popover without clipping', async () => {
    const runtimeRequest = vi.fn(async () => response([
      backgroundShell('shell-a', 'thread-a', `cd /very/long/path && npx vitest run ${'x'.repeat(200)}`, {
        output: 'line with long content'
      })
    ]))
    const renderer = await renderOverlay(runtimeRequest)
    await openOverlay(renderer)
    const grid = renderer.root.findAllByType('div').find((node) => (
      typeof node.props.className === 'string' && node.props.className.includes('grid-cols-[minmax(0,1fr)]')
    ))
    expect(grid).toBeDefined()
    const pre = renderer.root.findByType('pre')
    expect(pre.props.className).toContain('overflow-y-auto')
    expect(pre.props.className).toContain('overflow-x-hidden')
    expect(pre.props.className).toContain('whitespace-pre-wrap')
    const commandParagraphs = renderer.root.findAllByType('p').filter((node) => (
      node.children.some((child) => typeof child === 'string' && child.includes('npx vitest run'))
    ))
    expect(commandParagraphs.some((node) => node.props.className.includes('whitespace-pre-wrap'))).toBe(true)
    expect(commandParagraphs.every((node) => !node.props.className.includes('truncate'))).toBe(true)
    act(() => renderer.unmount())
  })

  it('requests and displays background shells only for the active thread', async () => {
    const runtimeRequest = vi.fn(async () => response([
      backgroundShell('shell-a', 'thread-a', 'npm run test:a', { output: 'current output' }),
      backgroundShell('shell-b', 'thread-b', 'npm run test:b')
    ]))
    const renderer = await renderOverlay(runtimeRequest)
    expect(runtimeRequest).toHaveBeenCalledWith('/v1/background-shells?thread_id=thread-a')
    await openOverlay(renderer)
    expect(renderedText(renderer)).toContain('npm run test:a')
    expect(renderedText(renderer)).toContain('current output')
    expect(renderedText(renderer)).not.toContain('npm run test:b')
    act(() => renderer.unmount())
  })

  it('stops a running shell while completed shells have no stop action', async () => {
    const sessions = [
      backgroundShell('shell-a', 'thread-a', 'running command'),
      backgroundShell('shell-b', 'thread-a', 'completed command', { status: 'completed', exitCode: 0 })
    ]
    const runtimeRequest = vi.fn(async (path: string) => {
      if (path.endsWith('/stop')) return { ok: true, status: 200, body: '{}' }
      return response(sessions)
    })
    const renderer = await renderOverlay(runtimeRequest)
    await openOverlay(renderer)
    const stopButton = renderer.root.findAllByType('button').find((button) => button.children.includes('Stop'))
    expect(stopButton).toBeDefined()
    await act(async () => { await stopButton!.props.onClick() })
    expect(runtimeRequest).toHaveBeenCalledWith('/v1/background-shells/shell-a/stop', 'POST')
    const completedButton = renderer.root.findAllByType('button').find((button) => (
      button.findAllByType('span').some((span) => span.children.includes('completed command'))
    ))
    await act(async () => { completedButton!.props.onClick() })
    expect(renderer.root.findAllByType('button').filter((button) => button.children.includes('Stop'))).toHaveLength(0)
    act(() => renderer.unmount())
  })

  it('ignores an earlier response after the active thread changes', async () => {
    const first = deferred<RuntimeRequestResult>()
    const second = deferred<RuntimeRequestResult>()
    const runtimeRequest = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const renderer = await renderOverlay(runtimeRequest)
    await act(async () => {
      renderer.update(createElement(BackgroundShellOverlay, { runtimeReady: true, threadId: 'thread-b' }))
      await Promise.resolve()
    })
    second.resolve(response([backgroundShell('shell-b', 'thread-b', 'current command')]))
    await act(async () => { await second.promise })
    await openOverlay(renderer)
    expect(renderedText(renderer)).toContain('current command')
    first.resolve(response([backgroundShell('shell-a', 'thread-a', 'stale command')]))
    await act(async () => { await first.promise })
    expect(renderedText(renderer)).not.toContain('stale command')
    act(() => renderer.unmount())
  })
})
