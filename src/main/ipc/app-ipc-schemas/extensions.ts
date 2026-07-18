import {
  HostContentScriptDiagnosticSchema,
  JsonValueSchema,
  ManifestLocaleTagSchema,
  PermissionSchema
} from '@kun/extension-api'
import { z } from 'zod'
import {
  EXTENSION_HOST_SURFACES,
  EXTENSION_PROTECTED_OPERATION_KINDS
} from '../../../shared/extension-ipc'
import { MAX_PATH_LENGTH, MAX_URL_LENGTH, optionalTrimmedString, trimmedString } from './common'

export const MAX_EXTENSION_IPC_BODY_BYTES = 2 * 1024 * 1024
export const MAX_EXTENSION_CONFIGURATION_BODY_BYTES = 256 * 1024
export const MAX_EXTENSION_PERMISSION_COUNT = 256
export const MAX_EXTENSION_EVENT_LIMIT = 500
export const MAX_EXTENSION_CONFIGURATION_CONTRIBUTIONS = 256

export const extensionIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}\.[a-z0-9][a-z0-9-]{0,63}$/)
export const extensionVersionSchema = z.string().trim().min(1).max(128)
export const extensionContributionIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9-]{0,63}$/)
export const qualifiedExtensionContributionIdSchema = z
  .string()
  .trim()
  .regex(/^extension:[a-z0-9][a-z0-9-]{0,63}\.[a-z0-9][a-z0-9-]{0,63}\/[a-z][a-z0-9-]{0,63}$/)
const absoluteWorkspaceRootSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_PATH_LENGTH)
  .refine(isAbsolutePath, { message: 'workspaceRoot must be absolute.' })
export const extensionSessionIdSchema = z.string().trim().min(16).max(256)
export const extensionConsentRequestIdSchema = z.string().trim().min(16).max(256)
export const extensionPermissionListSchema = z
  .array(PermissionSchema)
  .max(MAX_EXTENSION_PERMISSION_COUNT)
  .superRefine((permissions, context) => {
    if (new Set(permissions).size !== permissions.length) {
      context.addIssue({ code: 'custom', message: 'permissions must not contain duplicates' })
    }
  })

export const extensionListRequestSchema = z
  .object({
    limit: z.number().int().min(1).max(500).optional(),
    cursor: extensionIdSchema.optional(),
    workspaceRoot: optionalTrimmedString(MAX_PATH_LENGTH),
    locale: ManifestLocaleTagSchema.optional()
  })
  .strict()
  .optional()

export const extensionWorkspaceRequestSchema = z
  .object({
    workspaceRoot: absoluteWorkspaceRootSchema.optional(),
    locale: ManifestLocaleTagSchema.optional()
  })
  .strict()
  .optional()

export const extensionListProviderModelsRequestSchema = z
  .object({
    extensionId: extensionIdSchema,
    extensionVersion: z.string().trim().min(1).max(64),
    providerId: extensionContributionIdSchema,
    accountId: z.string().trim().min(1).max(256),
    workspaceRoot: absoluteWorkspaceRootSchema.optional()
  })
  .strict()

export const extensionLoadConfigurationRequestSchema = z
  .object({
    contributionIds: z
      .array(qualifiedExtensionContributionIdSchema)
      .max(MAX_EXTENSION_CONFIGURATION_CONTRIBUTIONS),
    workspaceRoot: absoluteWorkspaceRootSchema.optional()
  })
  .strict()

export const extensionUpdateConfigurationRequestSchema = z
  .object({
    contributionId: qualifiedExtensionContributionIdSchema,
    key: z.string().min(1).max(256),
    value: JsonValueSchema,
    expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    workspaceRoot: absoluteWorkspaceRootSchema.optional()
  })
  .strict()

export const extensionInstallRequestSchema = z.discriminatedUnion('source', [
  z
    .object({
      source: z.literal('archive'),
      path: trimmedString(MAX_PATH_LENGTH),
      grantedPermissions: extensionPermissionListSchema.optional(),
      select: z.boolean().optional(),
      enable: z.boolean().optional(),
      consentRequestId: extensionConsentRequestIdSchema.optional()
    })
    .strict(),
  z
    .object({
      source: z.literal('development'),
      path: trimmedString(MAX_PATH_LENGTH),
      grantedPermissions: extensionPermissionListSchema.optional(),
      select: z.boolean().optional(),
      enable: z.boolean().optional(),
      consentRequestId: extensionConsentRequestIdSchema.optional()
    })
    .strict(),
  z
    .object({
      source: z.literal('index'),
      indexUrl: z.string().url().max(MAX_URL_LENGTH).refine((value) => value.startsWith('https://'), {
        message: 'Extension indexes must use HTTPS.'
      }),
      extensionId: extensionIdSchema,
      version: extensionVersionSchema,
      grantedPermissions: extensionPermissionListSchema.optional(),
      select: z.boolean().optional(),
      enable: z.boolean().optional(),
      consentRequestId: extensionConsentRequestIdSchema.optional()
    })
    .strict()
])

export const extensionScopedRequestSchema = z
  .object({
    extensionId: extensionIdSchema,
    workspaceRoot: optionalTrimmedString(MAX_PATH_LENGTH)
  })
  .strict()

export const extensionEnableRequestSchema = extensionScopedRequestSchema.extend({
  consentRequestId: extensionConsentRequestIdSchema.optional()
}).strict()

export const extensionRollbackRequestSchema = z
  .object({
    extensionId: extensionIdSchema,
    consentRequestId: extensionConsentRequestIdSchema.optional()
  })
  .strict()

export const extensionUninstallRequestSchema = z
  .object({
    extensionId: extensionIdSchema,
    version: extensionVersionSchema.optional(),
    consentRequestId: extensionConsentRequestIdSchema.optional()
  })
  .strict()

export const extensionReloadRequestSchema = extensionRollbackRequestSchema

export const extensionPermissionGrantRequestSchema = extensionScopedRequestSchema.extend({
  expectedVersion: extensionVersionSchema,
  permissions: extensionPermissionListSchema.nullable(),
  enableAfterApply: z.enum(['global', 'workspace']).optional(),
  consentRequestId: extensionConsentRequestIdSchema.optional()
}).strict().superRefine((request, context) => {
  if (request.enableAfterApply && !request.workspaceRoot) {
    context.addIssue({
      code: 'custom',
      path: ['workspaceRoot'],
      message: 'workspaceRoot is required when permissions are applied before enabling'
    })
  }
})

export const extensionCommandInvocationRequestSchema = z
  .object({
    commandId: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .regex(/^extension:[a-z0-9][a-z0-9-]{0,63}\.[a-z0-9][a-z0-9-]{0,63}\/[a-z][a-z0-9-]{0,63}$/),
    context: JsonValueSchema,
    workspaceRoot: z.string().trim().min(1).max(MAX_PATH_LENGTH).refine(isAbsolutePath, {
      message: 'workspaceRoot must be absolute.'
    }).optional()
  })
  .strict()

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value)
}

export const extensionViewSessionCreateRequestSchema = z
  .object({
    contributionId: qualifiedExtensionContributionIdSchema,
    workspaceRoot: absoluteWorkspaceRootSchema.optional(),
    retryHost: z.boolean().optional()
  })
  .strict()

export const extensionViewSessionRequestSchema = z
  .object({ sessionId: extensionSessionIdSchema })
  .strict()
export const extensionViewSessionDisposePayloadSchema = z.union([
  extensionSessionIdSchema,
  extensionViewSessionRequestSchema
])

const extensionExternalBrowserBoundsSchema = z.object({
  x: z.number().finite().min(-32_768).max(32_768),
  y: z.number().finite().min(-32_768).max(32_768),
  width: z.number().finite().min(0).max(32_768),
  height: z.number().finite().min(0).max(32_768),
  visible: z.boolean()
}).strict()

const extensionExternalBrowserSiteIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,63}$/)

export const extensionExternalBrowserControlSchema = z.discriminatedUnion('action', [
  z.object({
    sessionId: extensionSessionIdSchema,
    action: z.literal('mount'),
    siteId: extensionExternalBrowserSiteIdSchema,
    url: z.string().min(1).max(8_192),
    presentation: z.enum(['desktop', 'mobile']),
    bounds: extensionExternalBrowserBoundsSchema
  }).strict(),
  z.object({
    sessionId: extensionSessionIdSchema,
    action: z.literal('activate'),
    siteId: extensionExternalBrowserSiteIdSchema,
    url: z.string().min(1).max(8_192),
    presentation: z.enum(['desktop', 'mobile'])
  }).strict(),
  z.object({
    sessionId: extensionSessionIdSchema,
    action: z.literal('bounds'),
    bounds: extensionExternalBrowserBoundsSchema
  }).strict(),
  z.object({
    sessionId: extensionSessionIdSchema,
    action: z.literal('navigate'),
    url: z.string().min(1).max(8_192)
  }).strict(),
  z.object({
    sessionId: extensionSessionIdSchema,
    action: z.enum([
      'back',
      'forward',
      'reload',
      'zoomIn',
      'zoomOut',
      'zoomReset',
      'state'
    ])
  }).strict()
])

export const extensionViewMessageRequestSchema = extensionViewSessionRequestSchema.extend({
  channel: z.string().trim().min(1).max(128),
  payload: JsonValueSchema
}).strict()

export const extensionViewEventsRequestSchema = extensionViewSessionRequestSchema.extend({
  cursor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  limit: z.number().int().min(1).max(MAX_EXTENSION_EVENT_LIMIT).optional()
}).strict()

export const extensionNotificationIdSchema = z
  .string()
  .regex(/^notification_[0-9a-f-]{36}$/i)
export const extensionNotificationResponseRequestSchema = z
  .object({
    notificationId: extensionNotificationIdSchema,
    actionId: z.string().min(1).max(64).optional()
  })
  .strict()
export const extensionWorkbenchNotificationSchema = z
  .object({
    notificationId: extensionNotificationIdSchema,
    extensionId: extensionIdSchema,
    extensionVersion: extensionVersionSchema,
    sourceId: z.string().min(1).max(64),
    title: z.string().min(1).max(128),
    message: z.string().min(1).max(4096),
    severity: z.enum(['info', 'warning', 'error']),
    actions: z.array(z.object({
      id: z.string().min(1).max(64),
      title: z.string().min(1).max(128)
    }).strict()).max(4),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime()
  })
  .strict()
export const extensionNotificationSnapshotResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    notifications: z.array(extensionWorkbenchNotificationSchema).max(64)
  })
  .strict()

export const extensionGuestRequestSchema = z
  .object({
    sessionId: extensionSessionIdSchema,
    sessionNonce: z.string().trim().min(32).max(256),
    requestId: z.string().trim().min(8).max(256),
    method: z.string().trim().min(1).max(128),
    params: JsonValueSchema.optional(),
    timeoutMs: z.number().int().min(1).max(300_000).optional()
  })
  .strict()

export const extensionGuestNotificationSchema = extensionGuestRequestSchema
  .omit({ requestId: true })
  .strict()

export const extensionGuestCancelSchema = z
  .object({
    sessionId: extensionSessionIdSchema,
    sessionNonce: z.string().trim().min(32).max(256),
    requestId: z.string().trim().min(8).max(256)
  })
  .strict()

export const extensionListAccountsRequestSchema = z
  .object({
    extensionId: extensionIdSchema,
    providerId: z.string().trim().min(1).max(129).optional(),
    includeUnavailable: z.boolean().optional()
  })
  .strict()

export const extensionCreateAccountSessionRequestSchema = z
  .object({
    extensionId: extensionIdSchema,
    extensionVersion: extensionVersionSchema,
    providerId: z.string().trim().min(1).max(129),
    authenticationProviderId: z.string().trim().min(1).max(129),
    label: z.string().trim().min(1).max(128).optional(),
    scopes: z.array(z.string().trim().min(1).max(256)).max(128).optional(),
    workspaceRoot: optionalTrimmedString(MAX_PATH_LENGTH)
  })
  .strict()

export const extensionAccountSessionRequestSchema = z
  .object({
    extensionId: extensionIdSchema,
    sessionId: extensionSessionIdSchema
  })
  .strict()

export const extensionCompleteAccountSessionRequestSchema = extensionAccountSessionRequestSchema.extend({
  extensionVersion: extensionVersionSchema,
  workspaceRoot: optionalTrimmedString(MAX_PATH_LENGTH)
}).strict()

export const extensionDeleteAccountRequestSchema = z
  .object({
    extensionId: extensionIdSchema,
    extensionVersion: extensionVersionSchema,
    accountId: z.string().trim().min(1).max(256),
    providerId: z.string().trim().min(1).max(129),
    workspaceRoot: optionalTrimmedString(MAX_PATH_LENGTH),
    consentRequestId: extensionConsentRequestIdSchema.optional()
  })
  .strict()

export const extensionRenameAccountRequestSchema = extensionDeleteAccountRequestSchema
  .omit({ consentRequestId: true })
  .strict()

export const extensionReplaceApiKeyAccountRequestSchema = extensionRenameAccountRequestSchema

export const extensionCreateApiKeyAccountRequestSchema = z
  .object({
    extensionId: extensionIdSchema,
    extensionVersion: extensionVersionSchema,
    providerId: z.string().trim().min(1).max(129),
    authenticationProviderId: z.string().trim().min(1).max(129),
    label: z.string().trim().min(1).max(128).optional(),
    workspaceRoot: optionalTrimmedString(MAX_PATH_LENGTH)
  })
  .strict()

export const extensionSetProviderBindingRequestSchema = z
  .object({
    extensionId: extensionIdSchema,
    extensionVersion: extensionVersionSchema,
    providerId: extensionContributionIdSchema,
    accountId: z.string().trim().min(1).max(256),
    modelId: z.string().trim().min(1).max(256),
    workspaceRoot: optionalTrimmedString(MAX_PATH_LENGTH)
  })
  .strict()

export const extensionConsentRequestSchema = z
  .object({
    extensionId: extensionIdSchema,
    extensionVersion: extensionVersionSchema,
    operationKind: z.enum(EXTENSION_PROTECTED_OPERATION_KINDS).refine(
      (value) => value !== 'provider.bind',
      { message: 'Provider binding disclosure is authored only by Electron Main.' }
    ),
    parameters: JsonValueSchema,
    workspaceRoot: optionalTrimmedString(MAX_PATH_LENGTH),
    title: trimmedString(200),
    message: trimmedString(2_000),
    detail: z.string().max(8_000).optional()
  })
  .strict()

export const extensionSyncHostContentScriptsRequestSchema = z
  .object({
    surface: z.enum(EXTENSION_HOST_SURFACES).nullable(),
    protectedSurface: z.string().trim().min(1).max(128).optional(),
    workspaceRoot: optionalTrimmedString(MAX_PATH_LENGTH),
    descriptors: z
      .array(
        z
          .object({
            extensionId: extensionIdSchema,
            contributionId: qualifiedExtensionContributionIdSchema
          })
      )
      .max(32)
  })
  .strict()

export const extensionHostContentScriptBridgeRequestSchema = z
  .object({
    bindingId: z.string().regex(/^content_script_[0-9a-f-]{36}$/i),
    nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    method: z.literal('reportDiagnostic'),
    diagnostic: HostContentScriptDiagnosticSchema
  })
  .strict()
