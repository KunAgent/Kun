import { z } from 'zod'

export type HarnessInstallationSource = 'kun-bundled' | 'managed' | 'native' | 'npm' | 'homebrew' | 'application' | 'custom' | 'unavailable'
export type HarnessInstallation = {
  path?: string
  version?: string
  fingerprint: string
  source: HarnessInstallationSource
  owner?: string
}
export type HarnessUpdateState = {
  harnessId: string
  current: HarnessInstallation
  candidate?: HarnessInstallation
  latestVersion?: string
  channel: string
  checkedAt?: string
  status: 'unchecked' | 'current' | 'available' | 'unknown' | 'unsupported'
  error?: string
  docsUrl?: string
  canUpdate: boolean
  canInstallManaged: boolean
  ownerUpdateRequired?: boolean
  job?: HarnessUpdateJob
}
export type HarnessUpdateJob = {
  id: string
  action: 'update' | 'managed' | 'use-local' | 'rollback'
  status: 'waiting' | 'running' | 'verifying' | 'ready' | 'completed' | 'failed' | 'cancelled'
  startedAt: string
  finishedAt?: string
  output: string
  error?: string
  activationPath?: string
  activationFingerprint?: string
  previousPath?: string
  version?: string
  models?: string[]
}
export const HarnessUpdateRequestSchema = z.object({
  action: z.enum(['update', 'managed', 'use-local']),
  /** Bind the user's click to the installation they reviewed. */
  expectedFingerprint: z.string().min(1).max(256)
}).strict()
export const HarnessUpdateCheckSchema = z.object({ force: z.boolean().optional() }).strict()
export const HarnessUpdateCancelSchema = z.object({ jobId: z.string().uuid() }).strict()

export type HarnessModelCatalogStatus = {
  source: 'native' | 'cache' | 'fallback' | 'provider' | 'static'
  fetchedAt: string
  version?: string
  command?: string
  message?: string
}
