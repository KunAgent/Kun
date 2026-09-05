import {
  enterForegroundRuntimeRead,
  noteRuntimeReadOverload
} from './runtime-load-shedder.js'

export type ThreadReadPriority = 'foreground' | 'background'

type QueueEntry<T> = {
  key: string
  priority: ThreadReadPriority
  operation: () => Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
  started: boolean
}

type InflightEntry = {
  entry: QueueEntry<unknown>
  promise: Promise<unknown>
}

export class ThreadReadOverloadedError extends Error {
  constructor(readonly retryAfterSeconds = 1) {
    super('thread timeline reader is temporarily overloaded')
    this.name = 'ThreadReadOverloadedError'
  }
}

export type ThreadReadCoordinatorStats = {
  activeForeground: number
  activeBackground: number
  queuedForeground: number
  queuedBackground: number
  joined: number
  started: number
  promoted: number
  rejected: number
}

export class ThreadReadCoordinator {
  private readonly inflight = new Map<string, InflightEntry>()
  private readonly foreground: QueueEntry<unknown>[] = []
  private readonly background: QueueEntry<unknown>[] = []
  private activeForeground = 0
  private activeBackground = 0
  private joined = 0
  private started = 0
  private promoted = 0
  private rejected = 0

  constructor(private readonly limits = {
    foreground: 2,
    background: 1,
    queued: 8
  }) {}

  run<T>(key: string, priority: ThreadReadPriority, operation: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key)
    if (existing) {
      this.joined += 1
      // A foreground waiter joining a queued background read upgrades it in
      // place so the user's open is not delayed behind background warm-up.
      if (priority === 'foreground' && existing.entry.priority === 'background' && !existing.entry.started) {
        this.promote(existing.entry)
      }
      return existing.promise as Promise<T>
    }
    if (this.foreground.length + this.background.length >= this.limits.queued) {
      this.rejected += 1
      noteRuntimeReadOverload()
      return Promise.reject(new ThreadReadOverloadedError())
    }
    let entry!: QueueEntry<T>
    const promise = new Promise<T>((resolve, reject) => {
      entry = { key, priority, operation, resolve, reject, started: false }
    })
    const record: InflightEntry = {
      entry: entry as QueueEntry<unknown>,
      promise: promise as Promise<unknown>
    }
    this.inflight.set(key, record)
    if (this.canStart(priority)) this.start(entry as QueueEntry<unknown>)
    else (priority === 'foreground' ? this.foreground : this.background)
      .push(entry as QueueEntry<unknown>)
    return promise
  }

  hasForegroundWork(): boolean {
    return this.activeForeground > 0 || this.foreground.length > 0
  }

  stats(): ThreadReadCoordinatorStats {
    return {
      activeForeground: this.activeForeground,
      activeBackground: this.activeBackground,
      queuedForeground: this.foreground.length,
      queuedBackground: this.background.length,
      joined: this.joined,
      started: this.started,
      promoted: this.promoted,
      rejected: this.rejected
    }
  }

  private canStart(priority: ThreadReadPriority): boolean {
    if (priority === 'foreground') return this.activeForeground < this.limits.foreground
    return this.activeBackground < this.limits.background &&
      this.activeForeground === 0 && this.foreground.length === 0
  }

  private start(entry: QueueEntry<unknown>): void {
    entry.started = true
    this.started += 1
    if (entry.priority === 'foreground') this.activeForeground += 1
    else this.activeBackground += 1
    const releaseForeground = entry.priority === 'foreground'
      ? enterForegroundRuntimeRead() : () => undefined
    void entry.operation().then(entry.resolve, entry.reject).finally(() => {
      releaseForeground()
      this.inflight.delete(entry.key)
      if (entry.priority === 'foreground') this.activeForeground -= 1
      else this.activeBackground -= 1
      this.pump()
    })
  }

  private promote(entry: QueueEntry<unknown>): void {
    const index = this.background.indexOf(entry)
    if (index === -1) return
    this.background.splice(index, 1)
    entry.priority = 'foreground'
    this.promoted += 1
    if (this.canStart('foreground')) this.start(entry)
    else this.foreground.push(entry)
    this.pump()
  }

  private pump(): void {
    while (this.foreground.length > 0 && this.canStart('foreground')) {
      this.start(this.foreground.shift()!)
    }
    while (this.background.length > 0 && this.canStart('background')) {
      this.start(this.background.shift()!)
    }
  }
}
