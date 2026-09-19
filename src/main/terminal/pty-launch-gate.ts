import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { IPty } from 'node-pty'
import { prepareWindowsOwnedPty, stopWindowsOwnedProcess } from '../../../kun/src/process/owned-process-windows.js'

type PtyModule = Pick<typeof import('node-pty'), 'spawn'>
type PtyOptions = Parameters<PtyModule['spawn']>[2]
type PtyLaunch = {
  pty: IPty
  ready: Promise<void>
  exited: Promise<void>
  release(): void
  takeInitialOutput(): string
  ownership?: { stop(): Promise<void> }
}

/** ConPTY runs a native launcher that owns the target shell's Windows Job. */
async function spawnWindowsPty(module: PtyModule, file: string, args: string[], options: PtyOptions, cancelled: () => boolean): Promise<PtyLaunch> {
  const prepared = await prepareWindowsOwnedPty(file, args, { env: options?.env, cwd: options?.cwd })
  if (cancelled()) {
    await prepared.abort()
    throw new Error('Terminal service is stopping.')
  }
  let pty: IPty
  try {
    pty = module.spawn(prepared.command, prepared.args, { ...options, env: prepared.env })
  } catch (error) {
    await prepared.abort()
    throw error
  }
  const child = Object.assign(new EventEmitter(), {
    pid: pty.pid,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    kill: () => { pty.kill(); return true }
  })
  const exited = new Promise<void>((resolve) => {
    pty.onExit(({ exitCode, signal }) => {
      child.exitCode = exitCode
      child.emit('exit', exitCode, signal)
      resolve()
    })
  })
  let initialOutput = ''
  const output = pty.onData((data) => { initialOutput = `${initialOutput}${data}`.slice(-65_536) })
  const facade = child as unknown as ChildProcess
  return {
    pty,
    exited,
    ready: prepared.bind(facade).then(() => undefined),
    release() {},
    takeInitialOutput: () => { output.dispose(); return initialOutput },
    ownership: { stop: () => stopWindowsOwnedProcess(facade, { graceMs: 0, timeoutMs: 5_000 }) }
  }
}

/** Blocks a POSIX PTY before user shell startup files or commands can run. */
export async function spawnPtyBehindGate(
  module: PtyModule,
  file: string,
  args: string[],
  options: PtyOptions,
  cancelled: () => boolean = () => false
): Promise<PtyLaunch> {
  if (cancelled()) throw new Error('Terminal service is stopping.')
  if (process.platform === 'win32') return spawnWindowsPty(module, file, args, options, cancelled)
  const marker = `kun-pty-ready-${randomUUID()}`
  const token = randomUUID()
  const pty = module.spawn('/bin/sh', ['-c',
    'stty -echo; printf "%s\\n" "$1"; shift; IFS= read -r kun_gate || exit 125; [ "$kun_gate" = "$1" ] || exit 125; shift; stty echo; exec "$@"',
    'kun-pty-gate', marker, token, file, ...args
  ], options)
  const exited = new Promise<void>((resolve) => { pty.onExit(() => resolve()) })
  const ready = new Promise<void>((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => {
      data.dispose()
      exit.dispose()
      reject(new Error('Terminal ownership gate did not become ready.'))
    }, 5_000)
    const data = pty.onData((chunk) => {
      output = `${output}${chunk}`.slice(-512)
      if (!output.includes(marker)) return
      clearTimeout(timer)
      data.dispose()
      exit.dispose()
      resolve()
    })
    const exit = pty.onExit(() => {
      clearTimeout(timer)
      data.dispose()
      exit.dispose()
      reject(new Error('Terminal shell exited before ownership registration.'))
    })
  })
  return { pty, ready, exited, release: () => pty.write(`${token}\r`), takeInitialOutput: () => '' }
}
