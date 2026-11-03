import { z } from 'zod'
import {
  MAX_OFFICE_VERSION_BYTES,
  MAX_OFFICE_VERSION_LABEL_CHARS
} from '../../../shared/office-version'
import { MAX_PATH_LENGTH, trimmedString } from './common'

const sha256Schema = z.string().trim().regex(/^[a-f0-9]{64}$/i)
const versionIdSchema = z.string().trim().regex(/^[a-z0-9-]{1,64}$/)
const targetShape = {
  path: trimmedString(MAX_PATH_LENGTH),
  workspaceRoot: trimmedString(MAX_PATH_LENGTH)
}
// Base64 of the largest accepted snapshot, plus padding.
const MAX_BASE64_CHARS = Math.ceil(MAX_OFFICE_VERSION_BYTES / 3) * 4 + 4

export const officeVersionRecordPayloadSchema = z.object({
  ...targetShape,
  dataBase64: z.string().min(1).max(MAX_BASE64_CHARS),
  sha256: sha256Schema,
  replacedBySha256: sha256Schema.optional(),
  label: z.string().max(MAX_OFFICE_VERSION_LABEL_CHARS * 4),
  threadId: trimmedString(256).optional()
}).strict()

export const officeVersionListPayloadSchema = z.object(targetShape).strict()

export const officeVersionReadPayloadSchema = z.object({
  ...targetShape,
  id: versionIdSchema
}).strict()

export const officeVersionRestorePayloadSchema = z.object({
  ...targetShape,
  id: versionIdSchema,
  expectedSha256: sha256Schema
}).strict()
