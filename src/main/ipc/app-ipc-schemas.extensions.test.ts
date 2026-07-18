import { describe, expect, it } from 'vitest'
import {
  extensionCompleteAccountSessionRequestSchema,
  extensionConsentRequestSchema,
  extensionGuestRequestSchema,
  extensionInstallRequestSchema,
  extensionListProviderModelsRequestSchema,
  extensionLoadConfigurationRequestSchema,
  extensionNotificationResponseRequestSchema,
  extensionNotificationSnapshotResponseSchema,
  extensionPermissionGrantRequestSchema,
  extensionSetProviderBindingRequestSchema,
  extensionSyncHostContentScriptsRequestSchema,
  extensionUpdateConfigurationRequestSchema,
  extensionWorkspaceRequestSchema,
  extensionViewSessionCreateRequestSchema
} from './app-ipc-schemas/extensions'

describe('extension IPC schemas', () => {
  it('requires HTTPS for custom extension indexes', () => {
    const base = {
      source: 'index' as const,
      extensionId: 'acme.example',
      version: '1.0.0',
      grantedPermissions: []
    }
    expect(extensionInstallRequestSchema.safeParse({ ...base, indexUrl: 'http://example.com/index.json' }).success).toBe(false)
    expect(extensionInstallRequestSchema.safeParse({ ...base, indexUrl: 'https://example.com/index.json' }).success).toBe(true)
  })

  it('rejects identity-shaped fields and unknown paths outside fixed operations', () => {
    expect(extensionViewSessionCreateRequestSchema.safeParse({
      contributionId: 'extension:acme.example/issues',
      path: '/v1/usage'
    }).success).toBe(false)
    expect(extensionViewSessionCreateRequestSchema.safeParse({
      contributionId: 'extension:acme.example/issues',
      workspaceRoot: ''
    }).success).toBe(false)
    expect(extensionViewSessionCreateRequestSchema.safeParse({
      contributionId: 'extension:acme.example/issues',
      workspaceRoot: 'relative/workspace'
    }).success).toBe(false)
    expect(extensionViewSessionCreateRequestSchema.safeParse({
      contributionId: 'extension:acme.example/issues',
      workspaceRoot: '/workspace'
    }).success).toBe(true)
    expect(extensionGuestRequestSchema.safeParse({
      sessionId: '1234567890abcdef',
      sessionNonce: 'x'.repeat(32),
      requestId: 'request-1',
      method: 'ui.getTheme',
      params: {},
      extensionId: 'other.example'
    }).success).toBe(false)
  })

  it('accepts only strict absolute-workspace requests for trusted workbench reads', () => {
    expect(extensionWorkspaceRequestSchema.safeParse(undefined).success).toBe(true)
    expect(extensionWorkspaceRequestSchema.safeParse({}).success).toBe(true)
    expect(extensionWorkspaceRequestSchema.safeParse({ workspaceRoot: '/workspace' }).success).toBe(true)
    expect(extensionWorkspaceRequestSchema.safeParse({
      workspaceRoot: '/workspace',
      locale: 'zh-CN'
    }).success).toBe(true)
    expect(extensionWorkspaceRequestSchema.safeParse({ workspaceRoot: 'C:\\workspace' }).success).toBe(true)
    expect(extensionWorkspaceRequestSchema.safeParse({ workspaceRoot: '\\\\server\\share' }).success).toBe(true)
    expect(extensionWorkspaceRequestSchema.safeParse({ workspaceRoot: 'relative/workspace' }).success).toBe(false)
    expect(extensionWorkspaceRequestSchema.safeParse({ locale: 'zh_CN' }).success).toBe(false)
    expect(extensionWorkspaceRequestSchema.safeParse({
      workspaceRoot: '/workspace',
      path: '/v1/usage'
    }).success).toBe(false)
  })

  it('requires an explicit expected version for workspace permission mutations', () => {
    const request = {
      extensionId: 'acme.example',
      expectedVersion: '1.2.3',
      permissions: ['ui.views'],
      workspaceRoot: '/workspace'
    }
    expect(extensionPermissionGrantRequestSchema.safeParse(request).success).toBe(true)
    expect(extensionPermissionGrantRequestSchema.safeParse({
      ...request,
      expectedVersion: undefined,
      extensionVersion: '1.2.3'
    }).success).toBe(false)
    expect(extensionPermissionGrantRequestSchema.safeParse({
      ...request,
      enableAfterApply: 'global'
    }).success).toBe(true)
    expect(extensionPermissionGrantRequestSchema.safeParse({
      extensionId: 'acme.example',
      expectedVersion: '1.2.3',
      permissions: ['ui.views'],
      enableAfterApply: 'global'
    }).success).toBe(false)
  })

  it('bounds trusted model-provider discovery inputs', () => {
    const request = {
      extensionId: 'acme.example',
      extensionVersion: 'v'.repeat(64),
      providerId: 'models',
      accountId: 'a'.repeat(256),
      workspaceRoot: '/workspace'
    }
    expect(extensionListProviderModelsRequestSchema.safeParse(request).success).toBe(true)
    expect(extensionListProviderModelsRequestSchema.safeParse({
      ...request,
      extensionVersion: 'v'.repeat(65)
    }).success).toBe(false)
    expect(extensionListProviderModelsRequestSchema.safeParse({
      ...request,
      accountId: 'a'.repeat(257)
    }).success).toBe(false)
    expect(extensionListProviderModelsRequestSchema.safeParse({
      ...request,
      providerId: 'Models'
    }).success).toBe(false)
    expect(extensionListProviderModelsRequestSchema.safeParse({
      ...request,
      workspaceRoot: './workspace'
    }).success).toBe(false)
    expect(extensionListProviderModelsRequestSchema.safeParse({
      ...request,
      path: '/v1/extensions'
    }).success).toBe(false)
  })

  it('bounds trusted configuration load and update inputs', () => {
    const contributionId = 'extension:acme.example/general'
    expect(extensionLoadConfigurationRequestSchema.safeParse({
      contributionIds: Array.from(
        { length: 256 },
        (_, index) => `extension:acme.example/setting${index}`
      ),
      workspaceRoot: '/workspace'
    }).success).toBe(true)
    expect(extensionLoadConfigurationRequestSchema.safeParse({
      contributionIds: Array.from(
        { length: 257 },
        (_, index) => `extension:acme.example/setting${index}`
      )
    }).success).toBe(false)
    expect(extensionLoadConfigurationRequestSchema.safeParse({
      contributionIds: [contributionId],
      workspaceRoot: 'relative',
      method: 'DELETE'
    }).success).toBe(false)

    const update = {
      contributionId,
      key: 'mode',
      value: { nested: ['safe', true, null] },
      expectedRevision: 0,
      workspaceRoot: '/workspace'
    }
    expect(extensionUpdateConfigurationRequestSchema.safeParse(update).success).toBe(true)
    expect(extensionUpdateConfigurationRequestSchema.safeParse({
      ...update,
      expectedRevision: -1
    }).success).toBe(false)
    expect(extensionUpdateConfigurationRequestSchema.safeParse({
      ...update,
      expectedRevision: Number.MAX_SAFE_INTEGER + 1
    }).success).toBe(false)
    expect(extensionUpdateConfigurationRequestSchema.safeParse({
      ...update,
      key: 'k'.repeat(257)
    }).success).toBe(false)
    expect(extensionUpdateConfigurationRequestSchema.safeParse({
      ...update,
      value: undefined
    }).success).toBe(false)
    expect(extensionUpdateConfigurationRequestSchema.safeParse({
      ...update,
      path: '/v1/usage'
    }).success).toBe(false)
  })

  it('models protected surfaces explicitly for fail-closed Main rejection', () => {
    expect(extensionSyncHostContentScriptsRequestSchema.parse({
      surface: null,
      protectedSurface: 'extension-permissions',
      descriptors: [{ extensionId: 'acme.example', contributionId: 'extension:acme.example/dom' }]
    })).toMatchObject({ protectedSurface: 'extension-permissions' })
    expect(extensionSyncHostContentScriptsRequestSchema.safeParse({
      surface: 'workbench:settings',
      descriptors: []
    }).success).toBe(false)
  })

  it('keeps OAuth callback material out of renderer IPC payloads', () => {
    expect(extensionCompleteAccountSessionRequestSchema.safeParse({
      extensionId: 'acme.example',
      extensionVersion: '1.2.3',
      sessionId: 'account-session-123456',
      workspaceRoot: '/workspace'
    }).success).toBe(true)
    expect(extensionCompleteAccountSessionRequestSchema.safeParse({
      extensionId: 'acme.example',
      extensionVersion: '1.2.3',
      sessionId: 'account-session-123456',
      callbackUrl: 'https://callback.example/?code=secret'
    }).success).toBe(false)
  })

  it('requires provider disclosure to be generated by the binding handler', () => {
    const binding = {
      extensionId: 'acme.example',
      extensionVersion: '1.2.3',
      providerId: 'models',
      accountId: 'account-123',
      modelId: 'model-a',
      workspaceRoot: '/workspace'
    }
    expect(extensionSetProviderBindingRequestSchema.safeParse(binding).success).toBe(true)
    expect(extensionSetProviderBindingRequestSchema.safeParse({
      ...binding,
      consentRequestId: 'renderer-authored-consent-token'
    }).success).toBe(false)
    expect(extensionConsentRequestSchema.safeParse({
      extensionId: 'acme.example',
      extensionVersion: '1.2.3',
      operationKind: 'provider.bind',
      parameters: binding,
      title: 'Harmless action',
      message: 'Misleading renderer-authored disclosure'
    }).success).toBe(false)
  })

  it('bounds workbench notification snapshots and response identities', () => {
    const notification = {
      notificationId: 'notification_12345678-1234-1234-1234-123456789abc',
      extensionId: 'acme.example',
      extensionVersion: '1.2.3',
      sourceId: 'notice',
      title: 'Notice',
      message: 'Bounded text',
      severity: 'info',
      actions: [{ id: 'open', title: 'Open' }],
      createdAt: '2026-07-11T00:00:00.000Z',
      expiresAt: '2026-07-11T00:01:00.000Z'
    }
    expect(extensionNotificationSnapshotResponseSchema.safeParse({
      schemaVersion: 1,
      notifications: [notification]
    }).success).toBe(true)
    expect(extensionNotificationSnapshotResponseSchema.safeParse({
      schemaVersion: 1,
      notifications: [{ ...notification, secret: 'leak' }]
    }).success).toBe(false)
    expect(extensionNotificationResponseRequestSchema.safeParse({
      notificationId: notification.notificationId,
      actionId: 'open'
    }).success).toBe(true)
    expect(extensionNotificationResponseRequestSchema.safeParse({
      notificationId: '../spoofed',
      actionId: 'open'
    }).success).toBe(false)
  })
})
