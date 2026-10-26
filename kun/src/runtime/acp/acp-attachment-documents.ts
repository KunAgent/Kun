/**
 * Document attachment text for `session/prompt`. Kept separate from the ACP
 * lifecycle plumbing so the prompt-input path has no process or session
 * dependencies.
 */
import type { AttachmentStore } from '../../attachments/attachment-store.js'

/** Mirrors the native loop's inline document budget so both paths bound alike. */
export const ACP_INLINE_DOCUMENT_MAX_CHARS = 400_000

export type AcpInlineDocument = { name: string; text: string; truncated?: boolean }

/**
 * Inline text of document attachments. ACP agents cannot read Kun's private
 * attachment store, so a document that exists only as an attachment id would
 * otherwise reach the agent as nothing at all. Image payloads stay separate and
 * gated on the agent's image capability; text is not, so a text-only agent
 * still receives pasted long text.
 */
export async function resolveAcpDocuments(
  attachmentStore: AttachmentStore | undefined,
  threadId: string,
  workspace: string,
  attachmentIds: readonly string[]
): Promise<{ documents: AcpInlineDocument[]; unreadable: string[] }> {
  const documents: AcpInlineDocument[] = []
  const unreadable: string[] = []
  if (!attachmentStore || !attachmentIds.length) return { documents, unreadable }
  let remainingChars = ACP_INLINE_DOCUMENT_MAX_CHARS
  for (const id of attachmentIds) {
    if (remainingChars <= 0) break
    let attachment: Awaited<ReturnType<AttachmentStore['resolveContent']>>
    try {
      attachment = await attachmentStore.resolveContent(id, { threadId, workspace })
    } catch {
      // Missing or out-of-scope attachments are reported, never silently sent.
      unreadable.push(id)
      continue
    }
    if (attachment.kind === 'image') continue
    const fullText = attachment.documentText ?? ''
    if (!fullText.trim()) {
      unreadable.push(attachment.name)
      continue
    }
    const text = fullText.slice(0, remainingChars)
    remainingChars -= text.length
    const truncated = attachment.truncated === true || text.length < fullText.length
    documents.push({
      name: attachment.name,
      text,
      ...(truncated ? { truncated: true } : {})
    })
  }
  return { documents, unreadable }
}
