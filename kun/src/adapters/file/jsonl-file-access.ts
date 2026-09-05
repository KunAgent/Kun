import { AsyncLocalStorage } from 'node:async_hooks'
import { resolve } from 'node:path'

type Release = () => void
type Waiter = {
  kind: 'read' | 'replace'
  grant: (release: Release) => void
}
type AccessState = {
  readers: number
  replacing: boolean
  waiters: Waiter[]
}
type ReadScope = Map<string, { active: boolean }>

/**
 * Coordinates finite JSONL access with atomic file replacement.
 *
 * Windows refuses a rename-over-existing operation while a reader that did
 * not opt into delete sharing still has the destination open. Manager-backed
 * SSE and timeline requests can otherwise keep large logs almost continuously
 * open. FIFO admission gives a queued replacement priority over later readers,
 * so polling cannot starve compaction. Appends use a shared lease too: they may
 * coexist with readers, but cannot jump ahead of a queued replacement.
 */
export class JsonlFileAccessCoordinator {
  private readonly states = new Map<string, AccessState>()
  private readonly readScopes = new AsyncLocalStorage<ReadScope>()

  async acquireRead(path: string): Promise<Release> {
    const key = resolve(path)
    if (this.readScopes.getStore()?.get(key)?.active) return () => undefined
    const state = this.state(key)
    if (!state.replacing && !state.waiters.some((waiter) => waiter.kind === 'replace')) {
      state.readers += 1
      return this.releaseReader(key, state)
    }
    return new Promise<Release>((grant) => {
      state.waiters.push({ kind: 'read', grant })
      this.drain(key, state)
    })
  }

  async withRead<T>(path: string, operation: () => Promise<T>): Promise<T> {
    const key = resolve(path)
    const inherited = this.readScopes.getStore()
    if (inherited?.get(key)?.active) return operation()
    const release = await this.acquireRead(key)
    const token = { active: true }
    const scope = new Map(inherited)
    scope.set(key, token)
    try {
      return await this.readScopes.run(scope, operation)
    } finally {
      token.active = false
      release()
    }
  }

  async withReplacement<T>(path: string, operation: () => Promise<T>): Promise<T> {
    const key = resolve(path)
    const state = this.state(key)
    const release = await new Promise<Release>((grant) => {
      state.waiters.push({ kind: 'replace', grant })
      this.drain(key, state)
    })
    try {
      return await operation()
    } finally {
      release()
    }
  }

  private state(key: string): AccessState {
    const current = this.states.get(key)
    if (current) return current
    const created: AccessState = { readers: 0, replacing: false, waiters: [] }
    this.states.set(key, created)
    return created
  }

  private releaseReader(key: string, state: AccessState): Release {
    let released = false
    return () => {
      if (released) return
      released = true
      state.readers = Math.max(0, state.readers - 1)
      this.drain(key, state)
    }
  }

  private releaseReplacement(key: string, state: AccessState): Release {
    let released = false
    return () => {
      if (released) return
      released = true
      state.replacing = false
      this.drain(key, state)
    }
  }

  private drain(key: string, state: AccessState): void {
    if (state.replacing || state.readers > 0) return
    const next = state.waiters.shift()
    if (!next) {
      this.states.delete(key)
      return
    }
    if (next.kind === 'replace') {
      state.replacing = true
      next.grant(this.releaseReplacement(key, state))
      return
    }
    state.readers += 1
    next.grant(this.releaseReader(key, state))
    while (state.waiters[0]?.kind === 'read') {
      const reader = state.waiters.shift()!
      state.readers += 1
      reader.grant(this.releaseReader(key, state))
    }
  }
}
