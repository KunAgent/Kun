// @vitest-environment jsdom
import { Terminal } from '@xterm/xterm'
import { describe, expect, it, vi } from 'vitest'
import { commandStateFor, decodeOscValue, ShellCommandTracker } from './terminal-shell-commands'

function write(term: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve))
}

describe('shell command tracking', () => {
  it('decodes escaped OSC values', () => {
    expect(decodeOscValue('echo a\\x3bb\\\\c\\x0ad')).toBe('echo a;b\\c\nd')
    expect(decodeOscValue('100%\\x')).toBe('100%\\x')
  })

  it('treats Ctrl-C and unknown codes as neutral', () => {
    expect(commandStateFor(0)).toBe('ok')
    expect(commandStateFor(1)).toBe('failed')
    expect(commandStateFor(130)).toBe('neutral')
    expect(commandStateFor(null)).toBe('neutral')
  })

  it('records commands, output and exit codes from OSC 633', async () => {
    const term = new Terminal({ cols: 40, rows: 10, allowProposedApi: true })
    const onStart = vi.fn()
    const onFinish = vi.fn()
    const onCwd = vi.fn()
    const tracker = new ShellCommandTracker(term, { onCommandStart: onStart, onCommandFinish: onFinish, onCwd })
    await write(term, '\x1b]633;P;Cwd=/tmp/a\\x3bb\x07\x1b]633;A\x07$ npx vitest\r\n')
    await write(term, '\x1b]633;E;npx vitest run\x07\x1b]633;C\x07 FAIL one\r\n expected 1\r\n')
    expect(tracker.running?.command).toBe('npx vitest run')
    await write(term, '\x1b]633;D;1\x07\x1b]633;A\x07$ ')
    expect(onCwd).toHaveBeenCalledWith('/tmp/a;b')
    expect(onStart).toHaveBeenCalledTimes(1)
    const record = onFinish.mock.calls[0]![0]
    expect(record).toMatchObject({ command: 'npx vitest run', exitCode: 1, state: 'failed', cwd: '/tmp/a;b' })
    expect(tracker.output(record)).toEqual([' FAIL one', ' expected 1'])
    expect(tracker.running).toBeNull()
    tracker.dispose()
    term.dispose()
  })
})
