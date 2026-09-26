/**
 * Async front-end for `parseWorkDocument` (implementation §3.9/§11).
 * Documents up to `WORK_PARSE_WORKER_THRESHOLD` parse synchronously — a
 * worker round-trip costs more than the parse at that size. Larger
 * documents go through a shared Web Worker so agent-streamed snapshots and
 * file opens never block the UI thread; stale requests are answered but
 * callers drop superseded results via their own cancellation.
 */
import {
  deserializeWorkContext,
  parseWorkDocument,
  type ParsedWorkDocument
} from './document-codec'
import type { ParseWorkerRequest, ParseWorkerResponse } from './parse-worker'

export const WORK_PARSE_WORKER_THRESHOLD = 50_000

type Pending = {
  resolve: (parsed: ParsedWorkDocument) => void
  reject: (error: Error) => void
}

let worker: Worker | null = null
let requestId = 0
const pending = new Map<number, Pending>()

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null
  if (!worker) {
    try {
      worker = new Worker(new URL('./parse-worker.ts', import.meta.url), { type: 'module' })
    } catch {
      return null
    }
    worker.onmessage = (event: MessageEvent<ParseWorkerResponse>) => {
      const response = event.data
      const entry = pending.get(response.id)
      if (!entry) return
      pending.delete(response.id)
      if (!response.ok) {
        entry.reject(new Error(response.error))
        return
      }
      entry.resolve({
        doc: response.doc,
        ctx: deserializeWorkContext(response.ctx),
        blocks: response.blocks
      })
    }
    worker.onerror = () => {
      for (const entry of pending.values()) {
        entry.reject(new Error('Markdown parse worker failed'))
      }
      pending.clear()
      worker?.terminate()
      worker = null
    }
  }
  return worker
}

export function parseWorkDocumentAsync(markdown: string): Promise<ParsedWorkDocument> {
  if (markdown.length < WORK_PARSE_WORKER_THRESHOLD) {
    return Promise.resolve(parseWorkDocument(markdown))
  }
  const target = getWorker()
  if (!target) return Promise.resolve(parseWorkDocument(markdown))
  return new Promise<ParsedWorkDocument>((resolve, reject) => {
    requestId += 1
    pending.set(requestId, { resolve, reject })
    const request: ParseWorkerRequest = { id: requestId, markdown }
    target.postMessage(request)
  })
}

/**
 * Parse `markdown` on the best available path — synchronously below the
 * worker threshold, off-thread above it — and invoke `onParsed` with the
 * result. Returns a cancel function: once cancelled, `onParsed` is never
 * called again, so superseded snapshots are dropped by the caller.
 */
export function scheduleWorkParse(
  markdown: string,
  onParsed: (parsed: ParsedWorkDocument) => void
): () => void {
  if (markdown.length < WORK_PARSE_WORKER_THRESHOLD || typeof Worker === 'undefined') {
    onParsed(parseWorkDocument(markdown))
    return () => undefined
  }
  let cancelled = false
  void parseWorkDocumentAsync(markdown)
    .then((parsed) => {
      if (!cancelled) onParsed(parsed)
    })
    .catch(() => {
      if (!cancelled) onParsed(parseWorkDocument(markdown))
    })
  return () => {
    cancelled = true
  }
}
