import { randomUUID } from 'node:crypto'
import { createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const UPDATE_ROLLBACK_READY_TIMEOUT_MS = 45_000

/** A fresh, bounded rendezvous with the actual helper, including after UAC. */
export function openUpdateRollbackReadiness(timeoutMs = UPDATE_ROLLBACK_READY_TIMEOUT_MS) {
  const token = randomUUID()
  const pipeName = `kun-update-rollback-${randomUUID()}`
  const pipePath = process.platform === 'win32' ? `\\\\.\\pipe\\${pipeName}` : join(tmpdir(), `${pipeName}.sock`)
  let resolveReady!: () => void
  let rejectReady!: (error: Error) => void
  let resolveListening!: () => void
  let rejectListening!: (error: Error) => void
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
  const listening = new Promise<void>((resolve, reject) => { resolveListening = resolve; rejectListening = reject })
  // The deadline can expire while listen/spawn is pending. The caller still
  // observes rejection when it reaches the corresponding awaited promise.
  void ready.catch(() => undefined)
  void listening.catch(() => undefined)
  const sockets = new Set<Socket>()
  let settled = false
  const cancel = (error: Error) => {
    if (settled) return
    settled = true
    rejectReady(error)
    rejectListening(error)
    dispose()
  }
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.setEncoding('utf8')
    let buffered = ''
    let accepted = false
    socket.on('error', cancel)
    socket.on('close', () => {
      sockets.delete(socket)
      if (!settled) cancel(new Error('Update rollback helper disconnected before readiness.'))
    })
    socket.on('data', (chunk: string) => {
      buffered += chunk
      if (buffered.length > 512) { cancel(new Error('Invalid update rollback readiness response.')); return }
      while (buffered.includes('\n') && !settled) {
        const end = buffered.indexOf('\n')
        const message = buffered.slice(0, end).trim()
        buffered = buffered.slice(end + 1)
        if (!accepted && message === `ready:${token}`) {
          accepted = true
          socket.write(`accepted:${token}\n`)
        } else if (accepted && message === `armed:${token}`) {
          settled = true
          clearTimeout(timer)
          socket.end()
          server.close()
          resolveReady()
        } else {
          cancel(new Error('Invalid or stale update rollback readiness response.'))
        }
      }
    })
  })
  const timer = setTimeout(() => cancel(new Error('Update rollback helper readiness timed out.')), timeoutMs)
  function dispose() {
    clearTimeout(timer)
    for (const socket of sockets) socket.destroy()
    server.close()
  }
  server.once('error', cancel)
  server.listen(pipePath, resolveListening)
  return { pipeName, pipePath, token, listening, ready, cancel, dispose }
}

export function powershellRollbackReadiness(pipeName: string, token: string): string[] {
  return [
    // These values are generated UUIDs, never installer-controlled strings.
    `$pipe=[IO.Pipes.NamedPipeClientStream]::new('.', '${pipeName}', [IO.Pipes.PipeDirection]::InOut)`,
    '$pipe.Connect(5000)',
    '$writer=[IO.StreamWriter]::new($pipe)',
    '$writer.AutoFlush=$true',
    '$reader=[IO.StreamReader]::new($pipe)',
    `$writer.WriteLine('ready:${token}')`,
    '$accepted=$reader.ReadLineAsync()',
    `if (-not $accepted.Wait(5000) -or $accepted.Result -ne 'accepted:${token}') { throw 'Rollback readiness was not accepted.' }`,
    `$writer.WriteLine('armed:${token}')`,
    '$pipe.Dispose()'
  ]
}

/** Capture identity and cache its OS handle while the GUI is still waiting for readiness. */
export function powershellCaptureGuiProcess(): string[] {
  return ['$gui=[Diagnostics.Process]::GetProcessById($waitPid)', '$null=$gui.Handle']
}

/** An already-exited GUI satisfies the wait; never resolve its PID again after acknowledgment. */
export function powershellWaitForGuiExit(): string {
  return 'try { if (-not $gui.WaitForExit(90000)) { throw "The GUI did not exit before rollback." } } finally { $gui.Dispose() }'
}
