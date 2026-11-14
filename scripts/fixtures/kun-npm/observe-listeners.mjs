import { appendFileSync } from 'node:fs'
import { Server } from 'node:net'

// Observe real Node socket/exit events without changing their completion or
// injecting delays. Polling can miss the interval between two fast closes.
const trace = process.env.KUN_NPM_LIFECYCLE_TRACE
if (trace) {
  const ports = new WeakMap()
  const emit = Server.prototype.emit
  const record = (event, port) => appendFileSync(trace, JSON.stringify({
    event, pid: process.pid, port, monotonicNs: process.hrtime.bigint().toString()
  }) + '\n')
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
