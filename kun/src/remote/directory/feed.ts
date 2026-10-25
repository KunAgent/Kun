import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { onRoomStoreCommit } from '../../rooms/room-commit-signal.js'
import { invalidateRemoteCatalog } from '../catalog.js'
import { roomDirectoryChanges, type DirectoryResource } from './changes.js'

export const DIRECTORY_SPACING_MS = 300
const RESOURCES: DirectoryResource[] = ['agent', 'code', 'project', 'group']

/** One compact source subscription per Runtime, shared by all phone directory streams. */
export class RemoteDirectoryFeed {
  private listeners = new Set<(resources: DirectoryResource[]) => void>()
  private closers = new Set<() => void>()
  private detach: Array<() => void> = []
  private closed = false
  constructor(private runtime: ServerRuntime) {
    runtime.registerRemoteCleanup?.(() => this.close())
  }

  private startSources() {
    // A catalog may have been read just before the first observer attached.
    invalidateRemoteCatalog(this.runtime)
    const registry = this.runtime.threadActivity
    if (registry) {
      let cursor = registry.cursor()
      this.detach.push(registry.subscribe(() => {
        const result = registry.changesSince(cursor)
        cursor = result.resetRequired ? result.cursor : result.batch.cursor
        if (!result.resetRequired && !result.batch.changes.length) return
        this.changed(result.resetRequired || result.batch.changes.some((change) => change.kind !== 'runtime')
          ? ['code', 'project'] : ['code'])
      }))
    }
    this.detach.push(onRoomStoreCommit((change) => this.changed(roomDirectoryChanges(change))))
    const directory = this.runtime.rooms?.workbench.directory
    if (directory) this.detach.push(directory.subscribe(() => this.changed(['project'])))
  }

  private changed(resources: DirectoryResource[]) {
    if (!resources.length || this.closed) return
    if (resources.includes('project')) invalidateRemoteCatalog(this.runtime)
    for (const listener of this.listeners) listener(resources)
  }

  stream(request: Request, scopes: readonly string[]): Response {
    if (this.closed || this.listeners.size >= 16) return new Response(null, { status: 503 })
    const allowed = RESOURCES.filter((resource) => resource !== 'group' || scopes.includes('groups.read'))
    const encoder = new TextEncoder(), pending = new Set<DirectoryResource>()
    let close = () => {}, flush = () => {}
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        let ended = false, lastSent = -Infinity
        let timer: ReturnType<typeof setTimeout> | undefined
        const send = (value: unknown) => controller.enqueue(encoder.encode('data: ' + JSON.stringify(value) + '\n\n'))
        flush = () => {
          if (ended || !pending.size || (controller.desiredSize ?? 0) <= 0 || timer) return
          const wait = Math.max(0, lastSent + DIRECTORY_SPACING_MS - Date.now())
          timer = setTimeout(() => {
            timer = undefined
            if (ended || (controller.desiredSize ?? 0) <= 0) return
            const resources = [...pending]
            pending.clear(); lastSent = Date.now()
            send({ kind: 'directory_changed', resources })
          }, wait || DIRECTORY_SPACING_MS)
          timer.unref?.()
        }
        const changed = (resources: DirectoryResource[]) => {
          for (const resource of resources) if (allowed.includes(resource)) pending.add(resource)
          flush()
        }
        const heartbeat = setInterval(() => {
          if (!ended && (controller.desiredSize ?? 0) > 0) controller.enqueue(encoder.encode(': heartbeat\n\n'))
        }, 15000)
        heartbeat.unref?.()
        close = () => {
          if (ended) return
          ended = true; clearTimeout(timer); clearInterval(heartbeat); pending.clear()
          this.listeners.delete(changed); this.closers.delete(close)
          request.signal.removeEventListener('abort', close)
          if (!this.listeners.size) { for (const detach of this.detach) detach(); this.detach = [] }
          try { controller.close() } catch { /* Reader already cancelled. */ }
        }
        const first = !this.listeners.size
        this.listeners.add(changed); this.closers.add(close)
        if (first) this.startSources()
        request.signal.addEventListener('abort', close, { once: true })
        if (request.signal.aborted) { close(); return }
        // Sources are subscribed before this barrier. Clients refresh once after receiving it.
        send({ kind: 'synchronized', resources: allowed })
      }, pull: () => flush(), cancel: () => close()
    })
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } })
  }

  async close() {
    this.closed = true
    for (const close of [...this.closers]) close()
  }
}
