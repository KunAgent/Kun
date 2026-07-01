import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto'

export type PackageSource = 'skill' | 'mcp' | 'remote-mcp'

export type PackageManifest = {
  name: string
  version: string
  publisher?: string
  packageName?: string
  permissions?: string[]
  contentHash?: string
  signed?: boolean
  signatureBase64?: string
}

export type AuditFinding = {
  severity: 'info' | 'warn' | 'block'
  code: string
  message: string
}

export type PackageAuditResult = {
  name: string
  version: string
  source: PackageSource
  policy: 'advisory' | 'strict'
  installable: boolean
  findings: AuditFinding[]
  sensitivePermissions: string[]
  hashVerified?: boolean
  signatureVerified?: boolean
}

export type UpdateDecision = {
  allowed: boolean
  requiresConsent: boolean
  reason: string
}

const SENSITIVE_PERMISSIONS = new Set([
  'command',
  'exec',
  'shell',
  'secret',
  'secrets',
  'env',
  'network',
  'file',
  'filesystem-write',
  'process'
])

export function computeContentHash(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

export function verifyContentHash(content: string | Buffer, expectedHash: string): boolean {
  const actual = computeContentHash(content).toLowerCase()
  const expected = expectedHash.trim().toLowerCase().replace(/^sha256:/, '')
  if (actual.length !== expected.length) return false
  let diff = 0
  for (let index = 0; index < actual.length; index += 1) {
    diff |= actual.charCodeAt(index) ^ expected.charCodeAt(index)
  }
  return diff === 0
}

export function verifyPackageSignature(input: {
  content: string | Buffer
  signatureBase64: string
  publisherPublicKeyPem: string
}): boolean {
  try {
    const key = createPublicKey(input.publisherPublicKeyPem)
    const signature = Buffer.from(input.signatureBase64, 'base64')
    if (signature.length === 0) return false
    const data = Buffer.isBuffer(input.content) ? input.content : Buffer.from(input.content, 'utf8')
    const algorithm = key.asymmetricKeyType === 'ed25519' || key.asymmetricKeyType === 'ed448'
      ? null
      : 'sha256'
    return cryptoVerify(algorithm, data, key, signature)
  } catch {
    return false
  }
}

export function auditPackage(input: {
  source: PackageSource
  manifest: PackageManifest
  content?: string | Buffer
  trustedPublisherKeys?: Record<string, string>
  strict?: boolean
  sensitivePermissionConsent?: boolean
}): PackageAuditResult {
  const findings: AuditFinding[] = []
  const { manifest } = input
  const policy = input.strict === false ? 'advisory' : 'strict'
  const strict = policy === 'strict'
  const policySeverity = (severity: AuditFinding['severity']): AuditFinding['severity'] =>
    strict && severity === 'warn' ? 'block' : severity

  if (!isExactVersion(manifest.version)) {
    findings.push({
      severity: policySeverity('warn'),
      code: 'unpinned_version',
      message: `version "${manifest.version}" is not exactly pinned`
    })
  }
  if (!manifest.publisher) {
    findings.push({
      severity: policySeverity('warn'),
      code: 'unknown_publisher',
      message: 'package has no declared publisher'
    })
  }

  let hashVerified: boolean | undefined
  if (input.content === undefined) {
    hashVerified = false
    findings.push({
      severity: strict ? 'block' : 'warn',
      code: 'content_missing',
      message: 'downloaded package bytes were not provided, so integrity cannot be verified'
    })
  } else if (!manifest.contentHash) {
    hashVerified = false
    findings.push({
      severity: policySeverity('warn'),
      code: 'no_content_hash',
      message: 'no declared content hash to verify downloaded bytes'
    })
  } else if (verifyContentHash(input.content, manifest.contentHash)) {
    hashVerified = true
    findings.push({
      severity: 'info',
      code: 'hash_verified',
      message: 'downloaded bytes match the declared SHA-256 hash'
    })
  } else {
    hashVerified = false
    findings.push({
      severity: 'block',
      code: 'hash_mismatch',
      message: 'downloaded bytes do not match the declared content hash'
    })
  }

  let signatureVerified: boolean | undefined
  if (manifest.signatureBase64 && input.content !== undefined) {
    const publisherKey = manifest.publisher ? input.trustedPublisherKeys?.[manifest.publisher] : undefined
    if (!publisherKey) {
      findings.push({
        severity: policySeverity('warn'),
        code: 'unknown_signer',
        message: 'package is signed, but the publisher is not in the runtime trust store'
      })
    } else if (verifyPackageSignature({
      content: input.content,
      signatureBase64: manifest.signatureBase64,
      publisherPublicKeyPem: publisherKey
    })) {
      signatureVerified = true
      findings.push({
        severity: 'info',
        code: 'signature_verified',
        message: `signature verified against trusted publisher "${manifest.publisher}"`
      })
    } else {
      signatureVerified = false
      findings.push({
        severity: 'block',
        code: 'signature_invalid',
        message: 'package signature does not verify against the trusted publisher key'
      })
    }
  } else if (manifest.signed || manifest.signatureBase64) {
    findings.push({
      severity: strict ? 'block' : 'warn',
      code: 'signature_unverified',
      message: 'package declares a signature, but it could not be verified from the provided bytes'
    })
  } else {
    findings.push({
      severity: strict ? 'block' : 'warn',
      code: 'unsigned',
      message: 'package is not signed'
    })
  }

  const sensitivePermissions = (manifest.permissions ?? [])
    .filter((permission) => SENSITIVE_PERMISSIONS.has(permission))
  if (sensitivePermissions.length > 0) {
    findings.push({
      severity: strict && !input.sensitivePermissionConsent ? 'block' : 'warn',
      code: 'sensitive_permissions',
      message: `requests sensitive permission(s): ${sensitivePermissions.join(', ')}`
    })
  }

  return {
    name: manifest.name,
    version: manifest.version,
    source: input.source,
    policy,
    installable: !findings.some((finding) => finding.severity === 'block'),
    findings,
    sensitivePermissions,
    ...(hashVerified !== undefined ? { hashVerified } : {}),
    ...(signatureVerified !== undefined ? { signatureVerified } : {})
  }
}

export function evaluateUpdate(input: {
  current: PackageManifest
  next: PackageManifest
  locked?: boolean
  autoUpdate?: boolean
}): UpdateDecision {
  if (input.locked) {
    return { allowed: false, requiresConsent: true, reason: 'package version is locked' }
  }
  const currentMajor = majorVersion(input.current.version)
  const nextMajor = majorVersion(input.next.version)
  if (currentMajor === null || nextMajor === null) {
    return { allowed: false, requiresConsent: true, reason: 'update version is not exactly pinned' }
  }
  if (nextMajor > currentMajor) {
    return {
      allowed: false,
      requiresConsent: true,
      reason: `major version change ${input.current.version} -> ${input.next.version}`
    }
  }
  const previousPermissions = new Set(input.current.permissions ?? [])
  const newSensitivePermissions = (input.next.permissions ?? [])
    .filter((permission) => SENSITIVE_PERMISSIONS.has(permission) && !previousPermissions.has(permission))
  if (newSensitivePermissions.length > 0) {
    return {
      allowed: false,
      requiresConsent: true,
      reason: `new sensitive permission(s): ${newSensitivePermissions.join(', ')}`
    }
  }
  if (!input.autoUpdate) {
    return { allowed: false, requiresConsent: true, reason: 'auto-update is disabled' }
  }
  return { allowed: true, requiresConsent: false, reason: 'minor/patch update within policy' }
}

function isExactVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version.trim())
}

function majorVersion(version: string): number | null {
  if (!isExactVersion(version)) return null
  return Number.parseInt(version.split('.')[0] ?? '0', 10)
}
