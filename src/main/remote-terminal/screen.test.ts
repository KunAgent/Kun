import { describe, expect, it } from 'vitest'
import { createReplayScreens, loadTerminalScreens, safeReplay, utf8Length, SCREEN_SCROLLBACK, XtermScreen } from './screen'
import { TERMINAL_LIMITS } from '@kun/remote-protocol'

const RESET = '\u001bc'
const CLEAR = '\u001b[0m\u001b[2J\u001b[H'

describe('terminal screen snapshots', () => {
  it('always resets parser state and never starts a replay inside a control sequence', () => {
    const value = 'y'.repeat(1000) + '\u001b[31mred\u001b[0m'
    const replay = safeReplay(value, 64)
    expect(replay.startsWith(RESET + CLEAR)).toBe(true)
    expect(replay).toBe(RESET + CLEAR)
    expect(utf8Length(replay)).toBeLessThanOrEqual(64)
  })

  it('clears instead of replaying a fragment when no line or escape boundary exists', () => {
    const replay = safeReplay('x'.repeat(5000), 100)
    expect(replay.startsWith(RESET + CLEAR)).toBe(true)
    expect(replay.length).toBe(RESET.length + CLEAR.length)
    expect(safeReplay('')).toBe(RESET + CLEAR)
  })

  it('never begins on a low surrogate after trimming', () => {
    const value = '😀'.repeat(400)
    for (const limit of [16, 32, 64]) {
      const body = safeReplay(value, limit).slice(RESET.length + CLEAR.length)
      if (!body) continue
      const first = body.charCodeAt(0)
      expect(first >= 0xdc00 && first <= 0xdfff).toBe(false)
    }
  })

  it('keeps a bounded plain replay that survives serialization failure', () => {
    const screens = createReplayScreens()
    const screen = screens.create(80, 24)
    screen.write('hello\n'.repeat(20000))
    const snapshot = screen.serialize()
    expect(utf8Length(snapshot)).toBeLessThanOrEqual(TERMINAL_LIMITS.snapshotBytes)
    expect(snapshot.startsWith(RESET + CLEAR)).toBe(true)
    screen.dispose()
    expect(screen.serialize().length).toBeLessThanOrEqual(RESET.length + CLEAR.length)
  })

  it('serializes a real headless screen with full-screen state when the dependency exists', async () => {
    const factory = await loadTerminalScreens()
    expect(factory.fullScreen).toBe(true)
    const screen = factory.create(40, 10)
    screen.write('\u001b[?1049h\u001b[2J\u001b[Htop output\r\nrow two')
    const snapshot = await screen.capture()
    expect(snapshot.length).toBeGreaterThan(0)
    expect(utf8Length(snapshot)).toBeLessThanOrEqual(TERMINAL_LIMITS.snapshotBytes)
    // Alternate-buffer state is captured after the async parser, not raw write bytes.
    expect(snapshot.includes('row two')).toBe(true)
    expect(SCREEN_SCROLLBACK).toBeGreaterThan(0)
    screen.dispose()
  })

  function deferredScreen() {
    let visible = ''
    const callbacks: Array<() => void> = []
    const term = {
      write(data: string, callback?: () => void) { callbacks.push(() => { visible += data; callback?.() }) },
      resize() {}, dispose() {}, loadAddon() {}
    }
    const screen = new XtermScreen(term, { serialize: () => visible })
    return { screen, callbacks }
  }

  it('captures the parser boundary before writes queued after capture', async () => {
    const { screen, callbacks } = deferredScreen()
    screen.write('before')
    const snapshot = screen.capture()
    screen.write('after')
    await Promise.resolve()
    callbacks.shift()?.()
    expect(await snapshot).toBe('before')
    await new Promise(resolve => setImmediate(resolve))
    callbacks.shift()?.()
    await screen.flush()
    expect(await screen.capture()).toBe('beforeafter')
    screen.dispose()
  })

  it('caps parser bytes independently of the outbound stream queue', async () => {
    const { screen, callbacks } = deferredScreen()
    const chunk = 'x'.repeat(8192)
    const count = TERMINAL_LIMITS.outputBytes / chunk.length
    for (let i = 0; i < count; i++) screen.write(chunk)
    expect(screen.pendingBytes).toBe(TERMINAL_LIMITS.outputBytes)
    expect(() => screen.write('x')).toThrow('TERMINAL_PARSER_OVERFLOW')
    for (let i = 0; i < count; i++) {
      await new Promise(resolve => setImmediate(resolve))
      callbacks.shift()?.()
    }
    await screen.flush()
    expect(screen.pendingBytes).toBe(0)
    screen.dispose()
  })

  it('does not expose an OSC payload after an unsafe truncation boundary', () => {
    for (const value of [
      'x'.repeat(1000) + '\u001b]52;c;' + 'secret\n'.repeat(1000),
      'x'.repeat(1000) + '\u001bP' + '\u001b[31mpayload'.repeat(1000),
      '😀'.repeat(1000) + '\u001b]8;;https://example.test\nremaining'
    ]) expect(safeReplay(value, 64)).toBe(RESET + CLEAR)
  })
})
