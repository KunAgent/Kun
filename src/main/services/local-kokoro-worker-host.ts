import { Worker } from 'node:worker_threads'
import type { KokoroWorkerRequest, KokoroWorkerResponse } from './local-kokoro-worker-protocol'

export const KOKORO_WORKER_START_TIMEOUT_MS = 30_000
export const KOKORO_WORKER_RUN_TIMEOUT_MS = 120_000

type Result = Extract<KokoroWorkerResponse, { type: 'result' }>
type Run = Extract<KokoroWorkerRequest, { type: 'synthesize' }>
type Pending = { complete: (result: Result) => void }
type Generation = {
  worker: Worker
  ready: Promise<void>
  reject: (error: Error) => void
  pending: Map<string, Pending>
}

/** Every callback and pending result belongs to one exact worker generation. */
export class KokoroWorkerHost {
  private generation: Generation | null = null
  private epoch = 0
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly createWorker: () => Worker) {}

  get resident(): boolean { return this.generation !== null }
  get pendingRuns(): number { return this.generation?.pending.size ?? 0 }

  private ensure(): Generation {
    if (this.generation) return this.generation
    const worker = this.createWorker()
    let accept!: () => void
    let reject!: (error: Error) => void
    const ready = new Promise<void>((resolve, fail) => { accept = resolve; reject = fail })
    const generation: Generation = { worker, ready, reject, pending: new Map() }
    this.generation = generation
    const timer = setTimeout(() => this.fail(generation, 'Kokoro worker startup timed out'), KOKORO_WORKER_START_TIMEOUT_MS)
    // Readiness can fail before a queued caller starts awaiting it.
    void ready.then(() => clearTimeout(timer), () => clearTimeout(timer))
    worker.on('message', (message: KokoroWorkerResponse) => {
      if (message.type === 'ready') accept()
      if (message.type === 'result') generation.pending.get(message.id)?.complete(message)
    })
    worker.on('error', (error) => this.fail(generation, error.message))
    worker.on('exit', () => this.fail(generation, 'Kokoro speech worker stopped'))
    return generation
  }

  private fail(generation: Generation, message: string): void {
    generation.reject(new Error(message))
    for (const [id, run] of generation.pending) run.complete({ type: 'result', id, ok: false, message })
    if (this.generation !== generation) return
    this.generation = null
    void generation.worker.terminate().catch(() => undefined)
  }

  run(request: Run, canceled: () => boolean): Promise<Result> {
    const epoch = this.epoch
    const stale = (): boolean => epoch !== this.epoch || canceled()
    const task = this.queue.then(async (): Promise<Result> => {
      if (stale()) return { type: 'result', id: request.id, ok: false, canceled: true }
      const generation = this.ensure()
      await generation.ready
      if (stale() || generation !== this.generation) {
        return { type: 'result', id: request.id, ok: false, canceled: true }
      }
      return new Promise<Result>((resolve) => {
        const timer = setTimeout(() => this.fail(generation, 'Kokoro synthesis timed out'), KOKORO_WORKER_RUN_TIMEOUT_MS)
        generation.pending.set(request.id, {
          complete: (result) => {
            clearTimeout(timer)
            generation.pending.delete(request.id)
            resolve(result)
          }
        })
        try { generation.worker.postMessage(request) }
        catch (error) { this.fail(generation, String(error)) }
      })
    })
    this.queue = task.catch(() => undefined)
    return task
  }

  cancel(requestId: string): void {
    const generation = this.generation
    if (!generation?.pending.has(requestId)) return
    // Native inference cannot process a cancel message while blocking its thread.
    // Retire this generation so cancellation also unblocks the queue promptly.
    this.fail(generation, 'Kokoro speech canceled')
  }

  async reset(): Promise<void> {
    this.epoch += 1
    const generation = this.generation
    this.generation = null
    this.queue = Promise.resolve()
    if (!generation) return
    this.fail(generation, 'Kokoro speech worker reset')
    await generation.worker.terminate().catch(() => undefined)
  }
}
