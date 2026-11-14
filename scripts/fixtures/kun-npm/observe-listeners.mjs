import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { Server } from 'node:net'

// Observe real Node socket/exit events without changing their completion or
// injecting delays. Polling can miss the interval between two fast closes.
const trace = process.env.KUN_NPM_LIFECYCLE_TRACE
if (trace) {
  const ports = new WeakMap()
  const emit = Server.prototype.emit
  const record = (event, port) => {
    const probe = process.env.KUN_NPM_WORK_PROCESS_SNAPSHOT
    const pids = probe && existsSync(probe) ? JSON.parse(readFileSync(probe, 'utf8')) : []
    const liveWorkPids = pids.filter(pid => { try { process.kill(pid, 0); return true } catch { return false } })
    appendFileSync(trace, JSON.stringify({ event, pid: process.pid, port, liveWorkPids,
      monotonicNs: process.hrtime.bigint().toString() }) + '\n')
  }
  Server.prototype.emit = function (event, ...args) {
    if (event === 'listening') {
      const address = this.address()
      if (address && typeof address === 'object') ports.set(this, address.port)
    }
    if (event === 'close' && ports.has(this)) record('listener-closed', ports.get(this))
    return Reflect.apply(emit, this, [event, ...args])
  }
  process.once('exit', () => record('process-exit'))
}
