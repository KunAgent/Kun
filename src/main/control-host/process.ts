import { utilityProcess } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { RpcPeer, type Manifest } from '@kun/control-host'

export async function startControlProcess(directory: string, release: Manifest,
  handlers: Record<string, (value: any) => any>, event: (name: string, value: any) => void,
  lost: () => void) {
  const generation = randomUUID()
  const child = utilityProcess.fork(join(directory, release.entrypoints.runtime), [], {
    cwd: directory, env: { LANG: process.env.LANG ?? 'en_US.UTF-8', ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot ?? 'C:\\Windows' } : {}) },
    execArgv: [], stdio: 'pipe', serviceName: 'Kun Remote Control'
  })
  // The control program has its own bounded diagnostic channel. Never forward arbitrary stdout.
  child.stdout?.resume(); child.stderr?.resume()
  let exited = false, stopping = false
  let exit!: () => void
  const exitPromise = new Promise<void>(resolve => { exit = resolve })
  const rpc = new RpcPeer(value => child.postMessage(value), generation, handlers, event)
  child.on('exit', () => { exited = true; rpc.close(); exit(); if (!stopping) lost() })
  const stop = async () => {
    if (stopping) return exitPromise
    stopping = true
    if (!exited) {
      await rpc.call('shutdown', {}, 3000).catch(() => {})
      rpc.close()
      child.kill()
      let timer: ReturnType<typeof setTimeout> | undefined
      try { await Promise.race([exitPromise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('CONTROL_PROCESS_EXIT_UNCONFIRMED')), 5000) })]) }
      finally { clearTimeout(timer) }
    }
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(Error('CONTROL_START_TIMEOUT')) }, 10000)
      const onExit = () => { cleanup(); reject(Error('CONTROL_START_FAILED')) }
      const cleanup = () => { clearTimeout(timer); child.removeListener('exit', onExit) }
      child.once('exit', onExit)
      child.on('message', value => {
        if (value?.type === 'ready' && value.generation === generation) {
          cleanup()
          if (value.releaseId !== release.releaseId) reject(Error('CONTROL_RELEASE_MISMATCH'))
          else resolve()
        } else void rpc.receive(value)
      })
      child.once('spawn', () => child.postMessage({ type: 'bootstrap', generation }))
    })
    const health = await rpc.call('health')
    if (health.releaseId !== release.releaseId || health.hostApi !== 1) throw Error('CONTROL_RELEASE_MISMATCH')
    return { rpc, stop, directory, release, get exited() { return exited } }
  } catch (error) { await stop(); throw error }
}
export type ControlProcess = Awaited<ReturnType<typeof startControlProcess>>
