export type CustomCaBundleConfig = {
  enabled: boolean
  bundlePath: string
  expectedSha256?: string
}

export type CustomCaValidationError =
  | 'not-an-object'
  | 'unknown-field'
  | 'invalid-enabled'
  | 'path-required'
  | 'path-not-absolute'
  | 'path-too-long'
  | 'path-control-character'
  | 'invalid-sha256'

export type CustomCaValidationResult =
  | { ok: true; value: CustomCaBundleConfig }
  | { ok: false; error: CustomCaValidationError }

const MAX_BUNDLE_PATH_LENGTH = 4096
const SHA256_PATTERN = /^[a-f0-9]{64}$/i

export function normalizeCustomCaBundleConfig(input: unknown): CustomCaValidationResult {
  if (!isRecord(input)) return { ok: false, error: 'not-an-object' }
  const keys = Object.keys(input).sort()
  if (keys.some((key) => !['bundlePath', 'enabled', 'expectedSha256'].includes(key))) {
    return { ok: false, error: 'unknown-field' }
  }
  if (typeof input.enabled !== 'boolean') return { ok: false, error: 'invalid-enabled' }

  const bundlePath = typeof input.bundlePath === 'string' ? input.bundlePath : ''
  const expectedSha256 = input.expectedSha256
  if (!input.enabled) {
    if (bundlePath || expectedSha256 !== undefined) return { ok: false, error: 'path-required' }
    return { ok: true, value: { enabled: false, bundlePath: '' } }
  }

  if (!bundlePath) return { ok: false, error: 'path-required' }
  if (bundlePath.length > MAX_BUNDLE_PATH_LENGTH) return { ok: false, error: 'path-too-long' }
  if (/\p{Cc}/u.test(bundlePath)) return { ok: false, error: 'path-control-character' }
  if (!isAbsolutePath(bundlePath)) return { ok: false, error: 'path-not-absolute' }
  if (expectedSha256 !== undefined &&
      (typeof expectedSha256 !== 'string' || !SHA256_PATTERN.test(expectedSha256))) {
    return { ok: false, error: 'invalid-sha256' }
  }

  return {
    ok: true,
    value: {
      enabled: true,
      bundlePath,
      ...(expectedSha256 === undefined ? {} : { expectedSha256: expectedSha256.toLowerCase() })
    }
  }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') ||
    value.startsWith('\\\\') ||
    /^[a-z]:[\\/]/i.test(value)
}
