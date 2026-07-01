/**
 * Remote Profile (Issue #647, #10).
 *
 * A shareable, SECRET-FREE description of a remote target: which host alias,
 * which workspace, the default run mode, how to health-check and test, and
 * which paths are protected. Accounts, private keys, passphrases, and tokens
 * are intentionally NOT part of this schema — they always stay with the system
 * ssh / ssh-agent / OS keychain. Profiles can live in project config and be
 * shared with a team.
 */

import { z } from 'zod'
import { posix } from 'node:path'

export const RemoteRunModeSchema = z.enum(['observe', 'develop', 'operations', 'deploy'])

export const RemoteProfileSchema = z
  .object({
    /** Display name, e.g. "Production API". */
    name: z.string().min(1),
    /** ~/.ssh/config host alias — never an IP/credential. */
    host: z.string().min(1),
    /** Remote working directory ("project root"). */
    workspace: z.string().min(1),
    /** Default task run mode for threads created against this profile. */
    mode: RemoteRunModeSchema.default('observe'),
    /** True to mark this as a production target (escalates confirmations). */
    production: z.boolean().default(false),
    /** Optional health-check URL the verification step probes. */
    healthCheck: z.string().min(1).optional(),
    /** Optional command used by the auto-acceptance step. */
    testCommand: z.string().min(1).optional(),
    /** Paths the agent must never read or modify without explicit confirmation. */
    protectedPaths: z.array(z.string().min(1)).default([])
  })
  // Reject unknown keys so a secret accidentally added to a shared profile is a
  // loud validation error, not a silently persisted credential.
  .strict()
export type RemoteProfile = z.infer<typeof RemoteProfileSchema>

/** Keys that must never appear in a profile (defense-in-depth against leaks). */
const FORBIDDEN_SECRET_KEYS = ['password', 'passphrase', 'privatekey', 'private_key', 'token', 'secret', 'apikey', 'api_key']

/**
 * Validate a profile AND assert it carries no secret-like fields. Returns the
 * parsed profile or throws a descriptive error.
 */
export function parseRemoteProfile(input: unknown): RemoteProfile {
  if (input && typeof input === 'object') {
    for (const key of Object.keys(input as Record<string, unknown>)) {
      if (FORBIDDEN_SECRET_KEYS.includes(key.toLowerCase().replace(/[-\s]/g, '_').replace(/_/g, ''))) {
        throw new Error(`remote profile must not contain secrets (offending key: "${key}")`)
      }
    }
  }
  return RemoteProfileSchema.parse(input)
}

/**
 * Normalize a remote POSIX path: collapse `//`, resolve `.`/`..`, strip a
 * trailing slash. This is what makes protected-path matching robust against
 * `..` traversal bypasses (e.g. `/srv/app/../../etc/shadow`).
 */
export function normalizeRemotePath(remotePath: string): string {
  const normalized = posix.normalize(remotePath.replace(/\\/g, '/'))
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized
}

/** Whether a remote path is protected by the profile (normalized exact or prefix match). */
export function isProtectedPath(profile: Pick<RemoteProfile, 'protectedPaths'>, remotePath: string): boolean {
  const target = normalizeRemotePath(remotePath)
  return profile.protectedPaths.some((protectedPath) => {
    const base = normalizeRemotePath(protectedPath)
    if (target === base) return true
    // Absolute protected path → prefix match on a path boundary.
    if (base.startsWith('/')) return target.startsWith(`${base}/`)
    // Relative protected name (e.g. ".env") → match any path segment.
    return target.split('/').includes(base) || target.endsWith(`/${base}`)
  })
}

/** Whether a recursive operation rooted at `remotePath` can enter a protected path. */
export function containsProtectedPath(profile: Pick<RemoteProfile, 'protectedPaths'>, remotePath: string): boolean {
  const root = normalizeRemotePath(remotePath)
  return profile.protectedPaths.some((protectedPath) => {
    const base = normalizeRemotePath(protectedPath)
    if (!base.startsWith('/')) return true
    return base === root || base.startsWith(`${root === '/' ? '' : root}/`) || root.startsWith(`${base}/`)
  })
}

export type RemotePathCapability = 'read' | 'write'

export type RemotePathAccessDecision = {
  decision: 'allow' | 'confirm' | 'deny'
  protected: boolean
  reason: string
}

/**
 * Capability + path access check for file tools (read/edit/write), independent
 * of command-string classification — permissions are target + capability +
 * path, not just command. A protected path always requires confirmation; on a
 * production target a WRITE to a protected path is denied outright.
 */
export function evaluateRemotePathAccess(input: {
  capability: RemotePathCapability
  path: string
  profile: Pick<RemoteProfile, 'protectedPaths'>
  production?: boolean
  recursive?: boolean
}): RemotePathAccessDecision {
  const protectedPath = input.recursive
    ? containsProtectedPath(input.profile, input.path)
    : isProtectedPath(input.profile, input.path)
  if (!protectedPath) {
    return { decision: 'allow', protected: false, reason: 'path is not protected' }
  }
  if (input.capability === 'write' && input.production) {
    return { decision: 'deny', protected: true, reason: 'writing a protected path on a production target is not allowed' }
  }
  return {
    decision: 'confirm',
    protected: true,
    reason: input.recursive
      ? `${input.capability} may traverse protected paths and requires confirmation`
      : `${input.capability} of a protected path requires confirmation`
  }
}
