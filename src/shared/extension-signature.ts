export const EXTENSION_SIGNATURE_ALGORITHMS = ['ed25519'] as const
export type ExtensionSignatureAlgorithm = (typeof EXTENSION_SIGNATURE_ALGORITHMS)[number]

export type ExtensionPackageSignature = {
  algorithm: ExtensionSignatureAlgorithm
  publisherId: string
  keyId: string
  publicKeyBase64: string
  packageSha256: string
  signatureBase64: string
  signedAt: string
  expiresAt: string
}

export type ExtensionSignatureParseResult =
  | { success: true; data: ExtensionPackageSignature }
  | { success: false; error: string }

const MAX_IDENTIFIER_LENGTH = 128
const MAX_SIGNATURE_BLOB_LENGTH = 256
const SHA256_HEX = /^[a-f0-9]{64}$/
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint !== undefined && (codePoint < 0x20 || codePoint === 0x7f)) return true
  }
  return false
}

function boundedIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new TypeError(`${field} must be a string`)
  if (
    value.length === 0 ||
    value.length > MAX_IDENTIFIER_LENGTH ||
    value !== value.trim() ||
    hasControlCharacter(value)
  ) {
    throw new TypeError(`${field} is invalid`)
  }
  return value
}

function parseTimestamp(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 64 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
  ) {
    throw new TypeError(`${field} must be an ISO timestamp`)
  }
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) throw new TypeError(`${field} must be an ISO timestamp`)
  return new Date(timestamp).toISOString()
}

function parseBase64(value: unknown, field: string, expectedLength: number, expectedSuffix: '=' | '=='): string {
  if (
    typeof value !== 'string' ||
    value.length !== expectedLength ||
    value.length > MAX_SIGNATURE_BLOB_LENGTH ||
    !value.endsWith(expectedSuffix) ||
    !BASE64.test(value)
  ) {
    throw new TypeError(`${field} must be a valid base64 blob`)
  }
  return value
}

/**
 * Parse untrusted signature metadata without performing cryptographic work.
 * Verification and publisher trust decisions belong to the install/runtime layer.
 */
export function parseExtensionPackageSignature(input: unknown): ExtensionSignatureParseResult {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError('extension signature must be an object')
    }
    const record = input as Record<string, unknown>
    if (record.algorithm !== 'ed25519') throw new TypeError('unsupported extension signature algorithm')

    const signedAt = parseTimestamp(record.signedAt, 'signedAt')
    const expiresAt = parseTimestamp(record.expiresAt, 'expiresAt')
    if (Date.parse(expiresAt) <= Date.parse(signedAt)) {
      throw new TypeError('expiresAt must be later than signedAt')
    }

    return {
      success: true,
      data: {
        algorithm: 'ed25519',
        publisherId: boundedIdentifier(record.publisherId, 'publisherId'),
        keyId: boundedIdentifier(record.keyId, 'keyId'),
        publicKeyBase64: parseBase64(record.publicKeyBase64, 'publicKeyBase64', 44, '='),
        packageSha256: (() => {
          if (typeof record.packageSha256 !== 'string' || !SHA256_HEX.test(record.packageSha256)) {
            throw new TypeError('packageSha256 must be a lowercase SHA-256 digest')
          }
          return record.packageSha256
        })(),
        signatureBase64: parseBase64(record.signatureBase64, 'signatureBase64', 88, '=='),
        signedAt,
        expiresAt
      }
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'invalid extension signature' }
  }
}

/**
 * Stable bytes to sign. Callers must verify the signature against this exact payload.
 */
export function buildExtensionSignaturePayload(input: {
  extensionId: string
  version: string
  apiMajor: number
  packageSha256: string
}): string {
  const extensionId = boundedIdentifier(input.extensionId, 'extensionId')
  const version = boundedIdentifier(input.version, 'version')
  if (!Number.isInteger(input.apiMajor) || input.apiMajor < 0 || input.apiMajor > 1000) {
    throw new TypeError('apiMajor is invalid')
  }
  if (!SHA256_HEX.test(input.packageSha256)) throw new TypeError('packageSha256 is invalid')
  return JSON.stringify({ apiMajor: input.apiMajor, extensionId, packageSha256: input.packageSha256, version })
}

export function isExtensionSignatureCurrent(
  signature: ExtensionPackageSignature,
  now: Date | number = Date.now()
): boolean {
  const timestamp = now instanceof Date ? now.getTime() : now
  const signedAt = Date.parse(signature.signedAt)
  const expiresAt = Date.parse(signature.expiresAt)
  return (
    Number.isFinite(timestamp) &&
    Number.isFinite(signedAt) &&
    Number.isFinite(expiresAt) &&
    timestamp >= signedAt &&
    timestamp <= expiresAt
  )
}
