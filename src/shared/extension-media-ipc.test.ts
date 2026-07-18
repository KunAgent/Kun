import { describe, expect, it } from 'vitest'
import {
  ExtensionMediaDiagnosticsSchema,
  ExtensionMediaLeaseCreationResultSchema,
  ExtensionMediaLeaseRegistrationSchema,
  ExtensionMediaPickFilesIpcRequestSchema,
  ExtensionMediaSelectionRegistrationRequestSchema,
  ExtensionMediaViewBindingSchema
} from './extension-media-ipc'

const binding = {
  sessionId: 'view_12345678-1234-1234-1234-123456789abc',
  runtimeSessionId: 'view_12345678-1234-1234-1234-123456789abc',
  sessionNonce: 'a'.repeat(32),
  extensionId: 'acme.video',
  extensionVersion: '1.1.0',
  contributionId: 'extension:acme.video/editor',
  workspaceRoot: '/workspace/project',
  senderWebContentsId: 42,
  senderMainFrameProcessId: 7,
  senderMainFrameRoutingId: 11
}

describe('extension media IPC contracts', () => {
  it('binds protected operations to the complete authenticated View identity', () => {
    expect(ExtensionMediaViewBindingSchema.parse(binding)).toEqual(binding)
    expect(ExtensionMediaViewBindingSchema.safeParse({
      ...binding,
      contributionId: 'extension:other.video/editor'
    }).success).toBe(true)
    expect(ExtensionMediaViewBindingSchema.safeParse({
      ...binding,
      senderWebContentsId: 0
    }).success).toBe(false)
  })

  it('keeps paths and operation tokens out of renderer picker requests', () => {
    const input = {
      sessionId: binding.sessionId,
      sessionNonce: binding.sessionNonce,
      request: { multiple: true, maxFiles: 4, filters: [] }
    }
    expect(ExtensionMediaPickFilesIpcRequestSchema.parse(input)).toMatchObject(input)
    expect(ExtensionMediaPickFilesIpcRequestSchema.safeParse({
      ...input,
      absolutePath: '/tmp/forged.mp4'
    }).success).toBe(false)
    expect(ExtensionMediaPickFilesIpcRequestSchema.safeParse({
      ...input,
      operationToken: 'x'.repeat(32)
    }).success).toBe(false)
  })

  it('accepts raw selections only on the protected Main-to-runtime contract', () => {
    expect(ExtensionMediaSelectionRegistrationRequestSchema.parse({
      operationToken: 't'.repeat(32),
      binding,
      mode: 'read',
      selections: [{ absolutePath: '/tmp/source.mp4', displayName: 'source.mp4' }]
    }).selections[0]).toMatchObject({ displayName: 'source.mp4' })
    expect(ExtensionMediaSelectionRegistrationRequestSchema.safeParse({
      operationToken: 'short',
      binding,
      mode: 'read',
      selections: [{ absolutePath: 'relative.mp4', displayName: 'source.mp4' }]
    }).success).toBe(false)
  })

  it('separates the private lease registration from the public opaque result', () => {
    const registration = ExtensionMediaLeaseRegistrationSchema.parse({
      binding,
      handleId: 'media_handle_0000000001',
      absolutePath: '/tmp/source.mp4',
      mimeType: 'video/mp4',
      fileIdentity: { byteSize: 100, modifiedAtMs: 1234, device: 1, inode: 2 },
      expiresAt: '2026-07-13T00:00:00.000Z'
    })
    expect(registration.absolutePath).toBe('/tmp/source.mp4')
    const result = ExtensionMediaLeaseCreationResultSchema.parse({
      leaseId: 'media_lease_0000000001',
      handleId: registration.handleId,
      url: 'kun-media://lease/media_lease_0000000001',
      mimeType: registration.mimeType,
      expiresAt: registration.expiresAt
    })
    expect(result).not.toHaveProperty('absolutePath')
    expect(ExtensionMediaLeaseCreationResultSchema.safeParse({
      ...result,
      absolutePath: registration.absolutePath
    }).success).toBe(false)
  })

  it('keeps diagnostics count-only and schema bounded', () => {
    const diagnostics = ExtensionMediaDiagnosticsSchema.parse({
      scheme: 'kun-media',
      preparedViewCount: 1,
      activeLeaseCount: 2,
      activeStreamCount: 0,
      limits: {
        leaseTtlMs: 60_000,
        leasesPerView: 16,
        concurrentStreamsPerLease: 2,
        concurrentStreamsTotal: 8,
        rangeBytes: 64 * 1024 * 1024
      },
      deniedByCode: { MEDIA_RANGE_INVALID: 1 }
    })
    expect(JSON.stringify(diagnostics)).not.toContain('/tmp')
  })
})
