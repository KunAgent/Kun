/**
 * Web Worker entry for off-main-thread Markdown parsing (implementation
 * §3.9/§11). remark fidelity costs ~1.5s at 300k characters; documents past
 * `WORK_PARSE_WORKER_THRESHOLD` parse here so the editor stays responsive.
 * Replies with the structured-clone-safe parse result.
 */
import { parseWorkDocument, serializeWorkContext } from './document-codec'

export type ParseWorkerRequest = { id: number; markdown: string }
export type ParseWorkerResponse =
  | {
      id: number
      ok: true
      doc: ReturnType<typeof parseWorkDocument>['doc']
      ctx: ReturnType<typeof serializeWorkContext>
      blocks: ReturnType<typeof parseWorkDocument>['blocks']
    }
  | { id: number; ok: false; error: string }

self.onmessage = (event: MessageEvent<ParseWorkerRequest>) => {
  const { id, markdown } = event.data
  try {
    const parsed = parseWorkDocument(markdown)
    const response: ParseWorkerResponse = {
      id,
      ok: true,
      doc: parsed.doc,
      ctx: serializeWorkContext(parsed.ctx),
      blocks: parsed.blocks
    }
    self.postMessage(response)
  } catch (error) {
    const response: ParseWorkerResponse = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }
    self.postMessage(response)
  }
}
