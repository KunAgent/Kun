import { describe, expect, it, vi } from 'vitest'
import { fitVisibleTerminal, resizeTerminalSession } from './terminal-dimensions'

const container = (width = 800, height = 400, isConnected = true): HTMLElement => ({
  isConnected,
  getBoundingClientRect: () => ({ width, height })
}) as HTMLElement

describe('terminal layout and PTY dimensions', () => {
  it('waits until the terminal is visible and measured', () => {
    const source = { proposeDimensions: vi.fn(() => ({ cols: 100, rows: 30 })) }
    const terminal = { cols: 80, rows: 24, resize: vi.fn() }
    for (const element of [container(0), container(800, 0), container(800, 400, false)]) {
      expect(fitVisibleTerminal(element, source, terminal)).toBeUndefined()
    }
    expect(source.proposeDimensions).not.toHaveBeenCalled()
    expect(fitVisibleTerminal(container(), source, terminal)).toEqual({ cols: 100, rows: 30 })
    expect(terminal.resize).toHaveBeenCalledWith(100, 30)
  })

  it.each([
    { cols: NaN, rows: NaN }, { cols: Infinity, rows: 30 }, { cols: 80, rows: 0 },
    { cols: 80.5, rows: 24 }, { cols: 501, rows: 24 }, { cols: 80, rows: 201 }
  ])('never passes invalid dimensions %j to xterm or IPC', async (dimensions) => {
    const terminal = { cols: 80, rows: 24, resize: vi.fn() }
    const resize = vi.fn(async () => true)
    expect(fitVisibleTerminal(container(), { proposeDimensions: () => dimensions }, terminal)).toBeUndefined()
    await resizeTerminalSession(resize, 'test-session', dimensions, vi.fn())
    expect(terminal.resize).not.toHaveBeenCalled()
    expect(resize).not.toHaveBeenCalled()
  })

  it('reports resize rejection without an unhandled promise and can resize again', async () => {
    const resize = vi.fn().mockRejectedValueOnce(new Error('PTY disconnected')).mockResolvedValue(true)
    const onError = vi.fn()
    await resizeTerminalSession(resize, 'test-session', { cols: 100, rows: 30 }, onError)
    expect(onError).toHaveBeenCalledWith('PTY disconnected')
    await resizeTerminalSession(resize, 'test-session', { cols: 101, rows: 31 }, onError)
    expect(resize).toHaveBeenLastCalledWith({ sessionId: 'test-session', cols: 101, rows: 31 })
  })
})
