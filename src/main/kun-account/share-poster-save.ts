import { Buffer } from 'node:buffer'
import type { KunSharePosterSavePayload } from '../../shared/kun-account-economy'

export const MAX_SHARE_POSTER_BYTES = 6 * 1024 * 1024
const PNG_HEADER = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

/** Validate before allocating decoded bytes or showing a native file dialog. No paths cross this API. */
export function validateSharePosterSave(input: unknown): { bytes: Buffer; fileName: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid share poster')
  const payload = input as KunSharePosterSavePayload
  if (Object.keys(input).some((key) => key !== 'dataBase64' && key !== 'fileName') ||
      typeof payload.fileName !== 'string' || !/^[a-zA-Z0-9\u4e00-\u9fff_-]{1,96}\.png$/.test(payload.fileName) ||
      typeof payload.dataBase64 !== 'string' || payload.dataBase64.length > Math.ceil(MAX_SHARE_POSTER_BYTES / 3) * 4 ||
      payload.dataBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload.dataBase64)) throw new Error('invalid share poster')
  const bytes = Buffer.from(payload.dataBase64, 'base64')
  if (bytes.length <= PNG_HEADER.length || bytes.length > MAX_SHARE_POSTER_BYTES || !bytes.subarray(0, 8).equals(PNG_HEADER)) throw new Error('invalid PNG')
  return { bytes, fileName: payload.fileName }
}
