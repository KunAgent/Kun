import { join } from 'node:path'
import { app, net } from 'electron'
import { createSharedFileTransfer } from './share-files'
import { uploadRuntimeImageAttachment } from '../services/runtime-image-attachment-service'
import { uploadRuntimeDocumentAttachment } from '../services/runtime-document-attachment-service'
import { readLocalOfficeDocument } from '../services/office-document-service'
import { readLocalPdfText } from '../services/write-pdf-text-service'
/** Reuses native attachment conversion and persistence; its trusted task ID is fixed by the local share journal. */
export const transferSharedFiles = createSharedFileTransfer({
  root: (actor) => join(app.getPath('userData'), 'shared-mobile-transfers', actor.ownerAccountId, actor.shareId),
  fetch: (input, init) => net.fetch(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, init),
  upload: async (input, lease) => {
    if (input.mimeType.startsWith('image/')) {
      const result = await uploadRuntimeImageAttachment({ source: { kind: 'localPath', path: input.path }, name: input.name,
        threadId: input.threadId }, { runtimeRequest: lease.request })
      if (!result.ok) throw new Error('ATTACHMENT_REJECTED')
      return { attachment: result.attachment }
    }
    const pdf = input.mimeType === 'application/pdf' ? await readLocalPdfText({ path: input.path }) : null
    const office = /\.(docx|xlsx|pptx)$/i.test(input.name) ? await readLocalOfficeDocument({ path: input.path }) : null
    if (pdf && !pdf.ok || office && !office.ok) throw new Error('DOCUMENT_UNREADABLE')
    const result = await uploadRuntimeDocumentAttachment({ path: input.path, name: input.name, mimeType: input.mimeType,
      threadId: input.threadId, sourceSha256: input.sha256,
      ...(pdf?.ok ? { documentText: pdf.pages.map((page) => page.text).join('\n'), documentFormat: 'pdf' as const, pageCount: pdf.pageCount } : {}),
      ...(office?.ok ? { documentText: office.documentText, documentFormat: office.format, pageCount: office.pageCount } : {}) }, { runtimeRequest: lease.request })
    if (!result.ok) throw new Error('ATTACHMENT_REJECTED')
    return { attachment: result.attachment }
  }
})
