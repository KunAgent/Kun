import { readLocalOfficeDocument } from '../services/office-document-service'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile, rename, rm } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { app } from 'electron'
import { z } from 'zod'
import { uploadRuntimeDocumentAttachment } from '../services/runtime-document-attachment-service'
import { uploadRuntimeImageAttachment } from '../services/runtime-image-attachment-service'
import { readLocalPdfText } from '../services/write-pdf-text-service'
import type { LinkDependencies } from './service'
import { runtimeExportSource } from './export-source'
const Receive = z
  .object({
    transferId: z.string().uuid(),
    name: z.string().min(1).max(180),
    mimeType: z.string().max(120),
    size: z
      .number()
      .int()
      .positive()
      .max(25 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .strict()
async function bytes(response: Response, max: number) {
  if (!response.body) throw new Error('FILE_UNAVAILABLE')
  const reader = response.body.getReader(),
    chunks: Buffer[] = []
  let count = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      count += value.length
      if (count > max) throw new Error('FILE_LIMIT')
      chunks.push(Buffer.from(value))
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return Buffer.concat(chunks, count)
}
export const transferFiles: NonNullable<LinkDependencies['files']> = async (
  scope,
  call
) => {
  const lease = await scope.lease()
  // Commit the receipt before touching R2 or local files; a lost response is queried, never guessed.
  const identity = {
    accountId: scope.owner,
    deviceId: scope.peer,
    authorizationId: scope.authorizationId,
    requestId: call.requestId,
    method: call.method,
    params: call.params
  }
  const start = await lease.request(
    '/v1/remote/transfer-receipt',
    'POST',
    JSON.stringify({ ...identity, action: 'start' })
  )
  if (!start.ok) throw new Error('RECEIPT_CONFLICT')
  const prior = JSON.parse(start.body)
  if (prior.receipt) return prior
  if (!scope.current()) throw new Error('ACCOUNT_CHANGED')
  const result = await performTransfer(scope, call)
  const finish = await lease.request(
    '/v1/remote/transfer-receipt',
    'POST',
    JSON.stringify({ ...identity, action: 'finish', result })
  )
  if (!finish.ok) throw new Error('RESULT_UNKNOWN')
  return JSON.parse(finish.body)
}
const performTransfer: NonNullable<LinkDependencies['files']> = async (
  scope,
  call
) => {
  const lease = await scope.lease()
  if (call.method === 'attachment.export') {
    if (!lease.baseUrl) throw new Error('RUNTIME_UNAVAILABLE')
    const source = runtimeExportSource(call.params, scope, lease.runtimeToken)
    const response = await fetch(lease.baseUrl + source.path, {
      headers: source.headers,
      signal: AbortSignal.timeout(30000)
    })
    if (!response.ok) throw new Error('FILE_NOT_ALLOWED')
    const data = await bytes(response, 25 * 1024 * 1024)
    if (!scope.current()) throw new Error('ACCOUNT_CHANGED')
    const sha256 = createHash('sha256').update(data).digest('hex')
    const transfer = await scope.api.request('/transfers', 'POST', {
      recipientId: scope.peer,
      size: data.length,
      sha256
    })
    try {
      await scope.api.request(
        '/transfers/' + transfer.id + '/content',
        'PUT',
        new Uint8Array(data),
        true
      )
    } catch (error) {
      await scope.api
        .request('/transfers/' + transfer.id, 'DELETE')
        .catch(() => {})
      throw error
    }
    return {
      transferId: transfer.id,
      size: data.length,
      sha256,
      name: decodeURIComponent(
        response.headers.get('X-Kun-File-Name') ?? 'attachment'
      ),
      mimeType:
        response.headers.get('Content-Type') ?? 'application/octet-stream'
    }
  }
  const p = Receive.parse(call.params)
  const response = await scope.api.request<Response>(
    '/transfers/' + p.transferId + '/content',
    'GET',
    undefined,
    true
  )
  const data = await bytes(response, p.size)
  if (
    data.length !== p.size ||
    createHash('sha256').update(data).digest('hex') !== p.sha256
  )
    throw new Error('FILE_INTEGRITY')
  if (!scope.current()) throw new Error('ACCOUNT_CHANGED')
  const root = join(app.getPath('userData'), 'mobile-transfers', scope.owner)
  await mkdir(root, { recursive: true, mode: 0o700 })
  const path = join(
      root,
      p.sha256 + '-' + basename(p.name).replace(/[^a-zA-Z0-9._-]/g, '_')
    ),
    temporary = path + '.' + randomUUID() + '.tmp'
  await writeFile(temporary, data, { mode: 0o600 })
  await rename(temporary, path)
  let result
  if (p.mimeType.startsWith('image/'))
    result = await uploadRuntimeImageAttachment(
      { source: { kind: 'localPath', path }, name: p.name },
      { runtimeRequest: lease.request }
    )
  else {
    const pdf =
      p.mimeType === 'application/pdf' ? await readLocalPdfText({ path }) : null
    const office = /\.(docx|xlsx|pptx)$/i.test(p.name)
      ? await readLocalOfficeDocument({ path })
      : null
    if (office && !office.ok) throw new Error('DOCUMENT_UNREADABLE')
    if (pdf && !pdf.ok) throw new Error('PDF_UNREADABLE')
    result = await uploadRuntimeDocumentAttachment(
      {
        path,
        name: p.name,
        mimeType: p.mimeType,
        ...(pdf?.ok
          ? {
              documentText: pdf.pages.map((page) => page.text).join('\n'),
              documentFormat: 'pdf' as const,
              pageCount: pdf.pageCount
            }
          : {}),
        ...(office?.ok
          ? {
              documentText: office.documentText,
              documentFormat: office.format,
              pageCount: office.pageCount
            }
          : {}),
        sourceSha256: p.sha256
      },
      { runtimeRequest: lease.request }
    )
  }
  if (!result.ok) {
    await rm(path, { force: true })
    throw new Error('ATTACHMENT_REJECTED')
  }
  if (!scope.current()) throw new Error('ACCOUNT_CHANGED')
  await scope.api.request('/transfers/' + p.transferId + '/received', 'POST')
  return { attachment: result.attachment }
}
