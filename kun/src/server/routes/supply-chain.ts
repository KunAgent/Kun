import { z } from 'zod'
import { auditPackage, evaluateUpdate, type PackageSource } from '../../supplychain/package-audit.js'
import type { ServerRuntime } from './server-runtime.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { readJsonBody } from '../read-json-body.js'
import { ERRORS } from './runtime-error.js'

const MAX_AUDIT_CONTENT_BYTES = 16 * 1024 * 1024
const MAX_AUDIT_BODY_BYTES = MAX_AUDIT_CONTENT_BYTES * 2

const manifestSchema = z.object({
  name: z.string().trim().min(1).max(256),
  version: z.string().trim().min(1).max(128),
  publisher: z.string().trim().min(1).max(256).optional(),
  packageName: z.string().trim().min(1).max(256).optional(),
  permissions: z.array(z.string().trim().min(1).max(128)).max(100).optional(),
  contentHash: z.string().trim().min(1).max(256).optional(),
  signed: z.boolean().optional(),
  signatureBase64: z.string().trim().min(1).max(MAX_AUDIT_BODY_BYTES).optional()
}).strict()

const sourceSchema = z.enum(['skill', 'mcp', 'remote-mcp'])

const auditSchema = z.object({
  source: sourceSchema.default('mcp'),
  manifest: manifestSchema,
  contentBase64: z.string().trim().min(1).max(MAX_AUDIT_BODY_BYTES).optional(),
  strict: z.boolean().optional(),
  sensitivePermissionConsent: z.boolean().optional()
}).strict()

const updateSchema = z.object({
  current: manifestSchema,
  next: manifestSchema,
  locked: z.boolean().optional(),
  autoUpdate: z.boolean().optional()
}).strict()

export async function auditSupplyChainPackage(runtime: ServerRuntime, request: Request): Promise<JsonResponse> {
  const body = await readJsonBody(request, MAX_AUDIT_BODY_BYTES)
  if (!body.ok) return body.response
  const parsed = auditSchema.safeParse(body.value)
  if (!parsed.success) return ERRORS.validation('invalid supply-chain audit request', parsed.error.issues)

  const content = parseBase64Content(parsed.data.contentBase64)
  if (!content.ok) return content.response
  const publisherKey = parsed.data.manifest.publisher
    ? runtime.supplyChainTrust?.getPublisherKey(parsed.data.manifest.publisher)
    : undefined

  return jsonResponse(auditPackage({
    source: parsed.data.source as PackageSource,
    manifest: parsed.data.manifest,
    ...(content.value ? { content: content.value } : {}),
    ...(publisherKey && parsed.data.manifest.publisher
      ? { trustedPublisherKeys: { [parsed.data.manifest.publisher]: publisherKey } }
      : {}),
    strict: parsed.data.strict !== false,
    sensitivePermissionConsent: parsed.data.sensitivePermissionConsent === true
  }))
}

export async function checkSupplyChainUpdate(request: Request): Promise<JsonResponse> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = updateSchema.safeParse(body.value)
  if (!parsed.success) return ERRORS.validation('invalid supply-chain update request', parsed.error.issues)
  return jsonResponse(evaluateUpdate(parsed.data))
}

function parseBase64Content(value: string | undefined): { ok: true; value?: Buffer } | { ok: false; response: JsonResponse } {
  if (!value) return { ok: true }
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    return { ok: false, response: ERRORS.validation('contentBase64 is invalid') }
  }
  const content = Buffer.from(value, 'base64')
  if (content.byteLength > MAX_AUDIT_CONTENT_BYTES) {
    return { ok: false, response: ERRORS.validation(`package content exceeds ${MAX_AUDIT_CONTENT_BYTES} byte audit limit`) }
  }
  return { ok: true, value: content }
}
