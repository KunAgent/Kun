import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IPty } from 'node-pty'
import { registerTerminalPtyIpc } from './terminal-pty-ipc'

async function waitFor(read: () => Promise<boolean>, timeout = 5_000): Promise<void> {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await read()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('PTY fixture did not become ready')
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch { return false }
}

function setup(loadPty: Parameters<typeof registerTerminalPtyIpc>[0]['loadPty']) {
  const handlers = new Map<string, (...args: any[]) => any>()
  const sender = Object.assign(new EventEmitter(), { isDestroyed: (): boolean => false, send: vi.fn() })
  const controller = registerTerminalPtyIpc({
    ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler) } as never,
    getMainWindow: () => null,
    logError: vi.fn(),
    loadPty
  })
  return { controller, sender, call: (name: string, args: unknown) => handlers.get(name)!({ sender }, args) }
}

afterEach(() => vi.unstubAllEnvs())

describe('terminal lifetime', () => {
  it('blocks a pending native-backend load from spawning after shutdown', async () => {
    let ready!: (value: { spawn: typeof import('node-pty').spawn }) => void
    const spawn = vi.fn()
    const backend = new Promise<{ spawn: typeof import('node-pty').spawn }>((resolve) => { ready = resolve })
    const { controller, call } = setup(() => backend)
    const creating = call('terminal:create', { sessionId: 'pending' })
    const stopping = controller.disposeAllAndWait()
    ready({ spawn })
    expect(await creating).toMatchObject({ ok: false })
    await stopping
    expect(spawn).not.toHaveBeenCalled()
    expect(controller.listSessionIds()).toEqual([])
  })

  it.skipIf(process.platform === 'win32')('waits for TERM/HUP-ignoring background grandchildren after the window is destroyed', async () => {
    const native = await import('node-pty')
    const dir = await mkdtemp(join(tmpdir(), 'kun-pty-tree-'))
    const pids: number[] = []
    let pty: IPty | undefined
    const script = join(dir, 'tree.cjs')
    await writeFile(script, `
      const {spawn}=require('node:child_process');
      const {writeFileSync}=require('node:fs');
      const {join}=require('node:path');
      const depth=Number(process.argv[2]||0);
      if(depth>0) { process.on('SIGHUP',()=>{}); process.on('SIGTERM',()=>{}); }
      writeFileSync(join(${JSON.stringify(dir)},'pid-'+depth),String(process.pid));
      if(depth<2) spawn(process.execPath,[__filename,String(depth+1)],{stdio:'ignore'});
      setInterval(()=>{},1000);
    `)
    vi.stubEnv('SHELL', '/bin/bash')
    const { controller, sender, call } = setup(async () => ({
      spawn: (...args) => { pty = native.spawn(...args); return pty }
    }))
    try {
      expect(await call('terminal:create', { sessionId: 'tree', cwd: dir })).toMatchObject({ ok: true })
      pids.push(pty!.pid)
      await call('terminal:write', { sessionId: 'tree', data: `'${process.execPath.replace(/'/g, "'\\''")}' '${script.replace(/'/g, "'\\''")}' &\r` })
      await waitFor(async () => {
        try { return (await readFile(join(dir, 'pid-2'), 'utf8')).length > 0 } catch { return false }
      })
      for (let depth = 0; depth < 3; depth++) pids.push(Number(await readFile(join(dir, `pid-${depth}`), 'utf8')))
      expect(pids.every(alive)).toBe(true)
      sender.isDestroyed = () => true
      sender.emit('destroyed')
      const stopping = controller.disposeAllAndWait()
      expect(controller.listSessionIds()).toContain('tree')
      await stopping
      expect(pids.filter(alive)).toEqual([])
      expect(controller.listSessionIds()).toEqual([])
      expect(await call('terminal:create', { sessionId: 'late' })).toMatchObject({ ok: false })
    } finally {
      await controller.disposeAllAndWait().catch(() => undefined)
      try { pty?.kill() } catch { /* fixture already gone */ }
      for (const pid of pids) { try { process.kill(pid, 'SIGKILL') } catch { /* fixture already gone */ } }
      await rm(dir, { recursive: true, force: true })
    }
  }, 12_000)
})
