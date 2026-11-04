import { describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import { spawnPty, terminalSupported } from './pty-host'
import type { TerminalReceiver } from './session-service'

const supported = await terminalSupported()
const posix = process.platform !== 'win32'

function receiver() {
  const state: { data: string[]; exit?: number; signal?: string } = { data: [] }
  let resolveExit: () => void = () => {}
  const exited = new Promise<void>((resolve) => { resolveExit = resolve })
  const receive: TerminalReceiver = {
    data: (value) => state.data.push(value),
    exit: (exitCode, signal) => { state.exit = exitCode; state.signal = signal; resolveExit() }
  }
  return { state, receive, exited, text: () => state.data.join('') }
}

async function until(check: () => boolean, timeout = 5_000) {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > timeout) throw new Error('timed out')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

// These exercise the real node-pty boundary with harmless commands only.
describe.skipIf(!supported || !posix)('remote terminal PTY (real node-pty)', () => {
  it('streams a harmless command and reports its exit code', async () => {
    const sink = receiver()
    const pty = await spawnPty({ file: '/bin/sh', args: ['-c', 'printf "hello-pty\\n"'], cwd: tmpdir(), cols: 80, rows: 24 }, sink.receive, () => false)
    await Promise.race([sink.exited, new Promise((_, reject) => setTimeout(() => reject(new Error('no exit')), 8_000))])
    expect(sink.text()).toContain('hello-pty')
    expect(sink.state.exit).toBe(0)
    await pty.kill()
  })

  it('delivers keyboard input to the child process once', async () => {
    const sink = receiver()
    const pty = await spawnPty({ file: '/bin/sh', args: ['-c', 'read line; printf "got:%s\\n" "$line"'], cwd: tmpdir(), cols: 80, rows: 24 }, sink.receive, () => false)
    pty.write('abc\n')
    await until(() => sink.text().includes('got:abc'))
    expect(sink.text().match(/got:abc/g)).toHaveLength(1)
    await sink.exited
    expect(sink.state.exit).toBe(0)
    await pty.kill()
  })

  it('kills the whole tree on close and settles quickly', async () => {
    const sink = receiver()
    const pty = await spawnPty({ file: '/bin/sh', args: ['-c', 'sleep 30'], cwd: tmpdir(), cols: 80, rows: 24 }, sink.receive, () => false)
    const started = Date.now()
    await pty.kill()
    expect(Date.now() - started).toBeLessThan(5_000)
    await Promise.race([sink.exited, new Promise((_, reject) => setTimeout(() => reject(new Error('no exit')), 5_000))])
  })

  it('reclaims a background descendant after its shell exits naturally', async () => {
    const sink = receiver()
    const pty = await spawnPty({ file: '/bin/sh', args: ['-c', 'sleep 30 & printf "CHILD=%s\\n" "$!"; exit 0'], cwd: tmpdir(), cols: 80, rows: 24 }, sink.receive, () => false)
    try {
      await until(() => sink.state.exit !== undefined && /CHILD=\d+/.test(sink.text()))
      const pid = Number(/CHILD=(\d+)/.exec(sink.text())?.[1])
      expect(pid).toBeGreaterThan(1)
      await pty.kill()
      await until(() => { try { process.kill(pid, 0); return false } catch { return true } })
    } finally { await pty.kill() }
  })

  it('refuses to spawn once the caller is cancelled', async () => {
    const sink = receiver()
    await expect(spawnPty({ file: '/bin/sh', args: ['-c', 'true'], cwd: tmpdir(), cols: 80, rows: 24 }, sink.receive, () => true))
      .rejects.toThrow('TERMINAL_START_CANCELLED')
    expect(sink.text()).toBe('')
  })
})
