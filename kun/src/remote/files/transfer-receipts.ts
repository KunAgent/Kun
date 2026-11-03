import { attachmentAdmissionKey, receivedAttachmentId, type AttachmentAdmission } from './admissions.js'
import { deviceAttachmentAdmissionKey } from './device-admission.js'
import { createHash } from 'node:crypto'
import { canonical } from '@kun/remote-protocol'
import { z } from 'zod'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import { RemoteId } from '../contracts.js'
import { receiptKey, type Receipt } from '../requests/receipts.js'
const Input = z
  .object({
    accountId: RemoteId,
    deviceId: RemoteId,
    authorizationId: RemoteId,
    requestId: RemoteId,
    method: z.enum(['attachment.receive', 'attachment.export']),
    params: z.record(z.string(), z.unknown()),
    action: z.enum(['start', 'finish']),
    result: z.unknown().optional()
  })
  .strict()
export async function transferReceipt(rooms: RoomRuntime, raw: unknown) {
  const input = Input.parse(raw),
    key = receiptKey(input, input.requestId)
  const fingerprint = createHash('sha256')
    .update(canonical({ method: input.method, params: input.params }))
    .digest('hex')
  return rooms.exclusive(async () => {
    const row = await rooms.deps.store.get<Receipt>('remote_receipt', key)
    if (row && row.value.fingerprint !== fingerprint)
      throw new Error('REQUEST_CONFLICT')
    if (row?.value.status === 'applied') return { receipt: row.value }
    if (input.action === 'start' && row)
      return { receipt: { ...row.value, status: 'reconciliation_required' } }
    if (input.action === 'finish' && !row) throw new Error('RECEIPT_REQUIRED')
    const receipt: Receipt = {
      requestId: input.requestId,
      method: input.method,
      params: input.params,
      fingerprint,
      status: input.action === 'finish' ? 'applied' : 'accepted',
      createdAt: row?.value.createdAt ?? Date.now(),
      ...(input.action === 'finish' ? { result: input.result } : {})
    }
    const attachmentId = input.action === 'finish' && input.method === 'attachment.receive' ? receivedAttachmentId(input.result) : undefined
    if (input.action === 'finish' && input.method === 'attachment.receive' && !attachmentId) throw new Error('INVALID_RECEIVE_RESULT')
    const admissionId = attachmentId ? attachmentAdmissionKey(input, attachmentId) : undefined
    const admission = admissionId ? await rooms.deps.store.get<AttachmentAdmission>('remote_attachment_admission', admissionId) : null
    const deviceId = attachmentId ? deviceAttachmentAdmissionKey(input, attachmentId) : undefined
    const deviceProof = deviceId ? await rooms.deps.store.get<AttachmentAdmission>('remote_attachment_admission', deviceId) : null
    await rooms.deps.store.commit({
      requestId: key + '-transfer-' + input.action,
      checks: [
        {
          kind: 'remote_receipt',
          id: key,
          expectedRevision: row?.revision ?? null
        },
        ...(admissionId ? [{ kind: 'remote_attachment_admission' as const, id: admissionId, expectedRevision: admission?.revision ?? null }] : []),
        ...(deviceId ? [{ kind: 'remote_attachment_admission' as const, id: deviceId, expectedRevision: deviceProof?.revision ?? null }] : [])
      ],
      puts: [{ kind: 'remote_receipt', id: key, value: receipt },
        ...(admissionId && attachmentId ? [{ kind: 'remote_attachment_admission' as const, id: admissionId,
          value: admission?.value ?? { attachmentId, sourceDeviceId: input.deviceId, receiptId: input.requestId, confirmedAt: Date.now() } }] : []),
        ...(deviceId && attachmentId ? [{ kind: 'remote_attachment_admission' as const, id: deviceId,
          value: deviceProof?.value ?? { attachmentId, sourceDeviceId: input.deviceId, receiptId: input.requestId, confirmedAt: Date.now() } }] : [])]
    })
    return input.action === 'start' ? { started: true } : { receipt }
  })
}
