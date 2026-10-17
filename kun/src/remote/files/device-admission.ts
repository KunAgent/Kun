import { createHash } from 'node:crypto'
import type { RemoteScope } from '../contracts.js'
/** Same bytes may be independently received by several authorized installations. */
export function deviceAttachmentAdmissionKey(scope: Pick<RemoteScope, 'accountId' | 'deviceId'>, attachmentId: string) {
  return 'remote-device-attachment-' + createHash('sha256').update(JSON.stringify([scope.accountId, scope.deviceId, attachmentId])).digest('hex')
}
