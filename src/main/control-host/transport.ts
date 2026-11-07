import { randomUUID } from 'node:crypto'
import type { ClientDependencies, Frame, RemoteClient, Socket } from '@kun/remote-protocol'
import type { RpcPeer } from '@kun/control-host'
import { parseFrame, Reassembler } from '@kun/remote-protocol'
import { RelayAuthority } from './relay-authority'
export type RelayClient = Pick<RemoteClient, 'start' | 'stop' | 'reconnect' | 'resume' | 'send' | 'online'>
export class ControlRelay implements RelayClient {
  readonly id = randomUUID()
  online = false
  private desired = false
  private serial = 0
  private rpc?: RpcPeer
  private tickets = new Map<string, { url: string; ticket: string }>()
  private sockets = new Map<string, Socket>()
  private abort = new AbortController()
  private authority = new RelayAuthority()
  private currentSocket?: string
  private outgoing = new Reassembler()
  constructor(readonly deps: ClientDependencies, private ready: () => Promise<RpcPeer>, private retire: () => void) {}
  async attach(rpc: RpcPeer) {
    this.rpc = rpc
    if (!this.desired) return
    await rpc.call('relay.create', { id: this.id })
    if (this.desired) await rpc.call('relay.command', { id: this.id, method: 'start' })
  }
  start() {
    if (this.desired && this.rpc) { void this.rpc.call('relay.command', { id: this.id, method: 'start' }).catch(() => {}); return }
    this.desired = true
    const serial = ++this.serial
    void this.ready().then(async rpc => { if (serial === this.serial && this.desired && this.rpc !== rpc) await this.attach(rpc) })
      .catch(() => { if (serial === this.serial) this.deps.state?.(false, 'CONTROL_PROCESS_UNAVAILABLE') })
  }
  stop() {
    this.desired = false; ++this.serial
    if (this.rpc) void this.rpc.call('relay.command', { id: this.id, method: 'stop' }).catch(() => {})
    this.detach(); this.retire()
  }
  reconnect() { if (this.desired && this.rpc) void this.rpc.call('relay.command', { id: this.id, method: 'reconnect' }).catch(() => {}) }
  resume() { if (this.desired && this.rpc) void this.rpc.call('relay.command', { id: this.id, method: 'resume' }).catch(() => {}) }
  send(frame: Frame) {
    if (!this.online || !this.rpc) throw Error('DEVICE_OFFLINE')
    void this.rpc.call('relay.command', { id: this.id, method: 'send', frame }).catch(() => this.detach())
  }
  event(event: string, value: any) {
    if (!this.desired) return
    if (event === 'state') { this.online = value.online === true && this.authority.online(); this.deps.state?.(this.online, value.reason) }
    if (event === 'lease' && Number.isSafeInteger(value) && this.authority.online()) this.deps.leaseChanged?.(Math.min(value, this.authority.expiresAt))
    if (event === 'relay') this.deps.relay?.(value)
    if (event === 'frame' && this.authority.consume(value)) this.deps.frame?.(value)
    if (event === 'diagnostic') this.deps.diagnostic?.(value.code, value.details)
  }
  detach() {
    this.rpc = undefined; this.online = false; this.abort.abort(); this.abort = new AbortController()
    for (const socket of this.sockets.values()) { socket.onmessage = socket.onopen = socket.onerror = socket.onclose = null; socket.close() }
    this.sockets.clear(); this.tickets.clear()
    this.currentSocket = undefined; this.authority.clear(); this.outgoing.clear()
    if (this.desired) this.deps.state?.(false, 'CONTROL_RESTARTING')
  }
  async ticket() {
    const rpc = this.rpc, signal = this.abort.signal
    const ticket = await this.deps.ticket(signal)
    if (rpc !== this.rpc || signal.aborted || !this.desired) throw Error('AUTHORIZATION_REJECTED')
    if (this.tickets.size >= 8) this.tickets.clear()
    const key = randomUUID(); this.tickets.set(key, ticket)
    return { url: 'control://ticket/' + key, ticket: key }
  }
  async renew() { const value = await this.deps.renew(this.abort.signal); this.authority.renew((value as any)?.expiresAt); return value }
  open(key: string, id: string) {
    const ticket = this.tickets.get(key)
    this.tickets.delete(key)
    if (!ticket || id !== this.id + ':' + key || !this.desired || !this.rpc || this.sockets.size >= 2) throw Error('CONTROL_RPC_REJECTED')
    const socket = this.deps.socket(ticket.url, { Authorization: 'Ticket ' + ticket.ticket, 'X-Kun-Relay-Features': 'presence,authorization,lossy' })
    this.sockets.set(id, socket)
    this.currentSocket = id; this.authority.clear()
    const rpc = this.rpc
    const emit = (event: string, fields = {}) => { if (this.rpc === rpc && !rpc.closed) rpc.notify('relay.socket.event', { id, event, ...fields }) }
    socket.onopen = () => emit('open')
    socket.onmessage = event => {
      if (this.currentSocket !== id) return
      try { this.authority.observe(String(event.data)); emit('message', { data: String(event.data) }) }
      catch { socket.close(); this.authority.clear(); this.online = false; this.deps.state?.(false, 'PROTOCOL_ERROR') }
    }
    socket.onerror = () => emit('error')
    socket.onclose = event => { this.sockets.delete(id); if (this.currentSocket === id) { this.authority.clear(); this.online = false }; emit('close', { code: event?.code }) }
  }
  socketSend(id: string, data: string) {
    const socket = this.sockets.get(id)
    if (!socket || typeof data !== 'string' || Buffer.byteLength(data) > 262144 || (socket.bufferedAmount ?? 0) > 8388608) throw Error('BACKPRESSURE')
    const frame = this.outgoing.accept(parseFrame(data))
    if (frame && !['ping', 'pong', 'ack', 'event', 'result', 'error'].includes(frame.kind)) throw Error('CONTROL_RPC_REJECTED')
    socket.send(data); return socket.bufferedAmount ?? 0
  }
  socketClose(id: string) { const socket = this.sockets.get(id); this.sockets.delete(id); socket?.close() }
}
