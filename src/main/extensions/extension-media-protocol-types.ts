import { KUN_MEDIA_PRIVILEGED_SCHEME } from '../privileged-schemes'
import { createHash, randomBytes } from 'node:crypto'
import type { ReadStream } from 'node:fs'
import { open, realpath, stat, type FileHandle } from 'node:fs/promises'
import { extname } from 'node:path'
import { Readable } from 'node:stream'
import type { Protocol } from 'electron'
import type {
  ExtensionMediaDiagnostics,
  ExtensionMediaFileIdentity,
  ExtensionMediaLeaseRevocationReason
} from '../../shared/extension-media-ipc'
import type {
  ExtensionViewSessionRecord,
  ExtensionViewSessionRegistry
} from './extension-view-sessions'
import { KUN_EXTENSION_PRIVILEGED_SCHEME } from './extension-resource-protocol'
import { KUN_WORKSPACE_PREVIEW_PRIVILEGED_SCHEME } from '../services/workspace-preview-protocol'

import {
  fileIdentity
} from './extension-media-protocol-utils'

export const KUN_MEDIA_SCHEME = 'kun-media'

export const DEFAULT_LEASE_TTL_MS = 5 * 60 * 1_000

export const DEFAULT_MAX_LEASES_PER_VIEW = 32

export const DEFAULT_MAX_STREAMS_PER_LEASE = 4

export const DEFAULT_MAX_STREAMS_TOTAL = 32

export const DEFAULT_MAX_RANGE_BYTES = 512 * 1024 * 1024

export const MAX_TIMER_MS = 0x7fffffff

export const LEASE_TOKEN = /^[A-Za-z0-9_-]{32,128}$/

export type SchemeRegistrar = Pick<Protocol, 'registerSchemesAsPrivileged'>

export type ProtocolHandler = Pick<Protocol, 'handle' | 'unhandle'>

export type ExtensionMediaLeaseInput = {
  viewSessionId: string
  extensionId: string
  extensionVersion: string
  contributionId: string
  workspaceRoot?: string
  handleId: string
  absolutePath: string
  mimeType?: string
  fileIdentity?: ExtensionMediaFileIdentity
  expiresAt?: number
}

export type ExtensionMediaLease = {
  leaseId: string
  handleId: string
  url: string
  mimeType: string
  expiresAt: string
}

export type ExtensionMediaProtocolOptions = {
  sessions: ExtensionViewSessionRegistry
  protocolForPartition: (partition: string) => ProtocolHandler
  now?: () => number
  randomToken?: () => string
  leaseTtlMs?: number
  maxLeasesPerView?: number
  maxConcurrentStreamsPerLease?: number
  maxConcurrentStreamsTotal?: number
  maxRangeBytes?: number
  onDenied?: (detail: { extensionId?: string; sessionId?: string; code: string }) => void
}

export type PreparedMediaProtocol = {
  protocol: ProtocolHandler
  partition: string
  extensionId: string
  extensionVersion: string
}

export type ActiveLease = {
  leaseId: string
  handleId: string
  sessionId: string
  extensionId: string
  extensionVersion: string
  contributionId: string
  workspaceRoot?: string
  guestWebContentsId: number
  guestMainFrameProcessId: number
  guestMainFrameRoutingId: number
  canonicalPath: string
  mimeType: string
  identity: ExtensionMediaFileIdentity
  etag: string
  expiresAt: number
  activeReaders: number
  streams: Set<ReadStream>
  timer: ReturnType<typeof setTimeout>
  revoked: boolean
}

export type ParsedMediaByteRange = { start: number; end: number; length: number }

export class ExtensionMediaProtocolError extends Error {
  constructor(
    readonly code: string,
    readonly status: number = 404,
    readonly resourceSize?: number
  ) {
    super(code)
    this.name = 'ExtensionMediaProtocolError'
  }
}

export { KUN_MEDIA_PRIVILEGED_SCHEME } from '../privileged-schemes'

export function registerKunMediaSchemeAsPrivileged(protocol: SchemeRegistrar): void {
  protocol.registerSchemesAsPrivileged([KUN_MEDIA_PRIVILEGED_SCHEME])
}

/** Electron permits privileged-scheme registration only once before app ready. */
export function registerKunExtensionPlatformSchemesAsPrivileged(protocol: SchemeRegistrar,
  additional: Parameters<SchemeRegistrar['registerSchemesAsPrivileged']>[0] = []): void {
  protocol.registerSchemesAsPrivileged([
    KUN_EXTENSION_PRIVILEGED_SCHEME,
    KUN_MEDIA_PRIVILEGED_SCHEME,
    KUN_WORKSPACE_PREVIEW_PRIVILEGED_SCHEME,
    ...additional
  ])
}

export function positiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback
}
