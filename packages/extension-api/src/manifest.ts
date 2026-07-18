import { z } from 'zod'
import { AgentProfileDeclarationSchema } from './agent.js'
import { AuthenticationProviderDeclarationSchema } from './accounts.js'
import {
  ExtensionNameSchema,
  JsonObjectSchema,
  LocalIdSchema,
  PublisherSchema,
  RelativePathSchema,
  SemverRangeSchema,
  SemverSchema
} from './common.js'
import { PermissionSchema, permissionMatches } from './permissions.js'
import { ModelProviderDeclarationSchema } from './providers.js'
import { ExtensionToolDeclarationSchema } from './tools.js'

export const CURRENT_MANIFEST_VERSION = 1 as const
export const CURRENT_EXTENSION_API_VERSION = '1.2.0' as const
export const SUPPORTED_EXTENSION_API_VERSIONS = [CURRENT_EXTENSION_API_VERSION, '1.1.0', '1.0.0'] as const

export const ActivationEventSchema = z.union([
  z.literal('onStartup'),
  z.string().regex(/^on(?:View|Command|Tool|Provider|Authentication|AgentProfile):[a-z][a-z0-9-]*$/)
])
export type ActivationEvent = z.infer<typeof ActivationEventSchema>

const WhenExpressionSchema = z.string().min(1).max(2048)
const IconPathSchema = RelativePathSchema
const OrderSchema = z.number().int().min(-10_000).max(10_000).default(0)

export const CommandContributionSchema = z.strictObject({
  id: LocalIdSchema,
  title: z.string().min(1).max(128),
  category: z.string().min(1).max(128).optional(),
  description: z.string().max(2048).optional(),
  icon: IconPathSchema.optional(),
  inputSchema: JsonObjectSchema.optional(),
  outputSchema: JsonObjectSchema.optional(),
  enablement: WhenExpressionSchema.optional()
})
export type CommandContribution = z.infer<typeof CommandContributionSchema>

export const ViewContainerContributionSchema = z.strictObject({
  id: LocalIdSchema,
  title: z.string().min(1).max(128),
  icon: IconPathSchema.optional(),
  location: z.enum(['activity', 'leftSidebar', 'rightSidebar']),
  order: OrderSchema
})
export type ViewContainerContribution = z.infer<typeof ViewContainerContributionSchema>

export const ExternalBrowserSiteSchema = z.strictObject({
  id: LocalIdSchema,
  title: z.string().min(1).max(64),
  badge: z.string().min(1).max(4).optional(),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  url: z.string().min(1).max(2048).superRefine((value, context) => {
    try {
      const url = new URL(value)
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        (url.port && url.port !== '443')
      ) {
        context.addIssue({
          code: 'custom',
          message: 'External browser sites must use credential-free HTTPS URLs on the default port'
        })
      }
    } catch {
      context.addIssue({ code: 'custom', message: 'External browser site URL is invalid' })
    }
  })
})
export type ExternalBrowserSite = z.infer<typeof ExternalBrowserSiteSchema>

export const ExternalBrowserContributionSchema = z.strictObject({
  presentation: z.enum(['desktop', 'mobile']).default('desktop'),
  sites: z.array(ExternalBrowserSiteSchema).min(1).max(12)
})
export type ExternalBrowserContribution = z.infer<typeof ExternalBrowserContributionSchema>

export const ViewContributionSchema = z.strictObject({
  id: LocalIdSchema,
  title: z.string().min(1).max(128),
  entry: RelativePathSchema,
  icon: IconPathSchema.optional(),
  container: z.string().min(1).max(256).optional(),
  when: WhenExpressionSchema.optional(),
  showInRightRail: z.boolean().default(true),
  order: OrderSchema,
  multiple: z.boolean().default(false),
  localResourceRoots: z.array(RelativePathSchema).max(32).default([]),
  externalBrowser: ExternalBrowserContributionSchema.optional()
})
export type ViewContribution = z.infer<typeof ViewContributionSchema>

export const ActionContributionSchema = z.strictObject({
  id: LocalIdSchema,
  command: z.string().min(1).max(256),
  title: z.string().min(1).max(128),
  icon: IconPathSchema.optional(),
  when: WhenExpressionSchema.optional(),
  group: z.string().min(1).max(128).optional(),
  order: OrderSchema
})
export type ActionContribution = z.infer<typeof ActionContributionSchema>

export const ResultPreviewContributionSchema = z.strictObject({
  id: LocalIdSchema,
  title: z.string().min(1).max(128),
  entry: RelativePathSchema,
  mimeTypes: z.array(z.string().min(1).max(128)).min(1).max(64),
  when: WhenExpressionSchema.optional(),
  localResourceRoots: z.array(RelativePathSchema).max(32).default([])
})
export type ResultPreviewContribution = z.infer<typeof ResultPreviewContributionSchema>

export const SettingsContributionSchema = z.strictObject({
  id: LocalIdSchema,
  title: z.string().min(1).max(128),
  properties: z.record(z.string().min(1).max(256), JsonObjectSchema),
  scope: z.enum(['global', 'workspace']).default('workspace'),
  order: OrderSchema
})
export type SettingsContribution = z.infer<typeof SettingsContributionSchema>

export const ContextMenuContributionSchema = z.strictObject({
  id: LocalIdSchema,
  location: z.enum(['workspace', 'editor', 'message', 'attachment', 'view']),
  command: z.string().min(1).max(256),
  when: WhenExpressionSchema.optional(),
  group: z.string().min(1).max(128).optional(),
  order: OrderSchema
})
export type ContextMenuContribution = z.infer<typeof ContextMenuContributionSchema>

export const NotificationContributionSchema = z.strictObject({
  id: LocalIdSchema,
  title: z.string().min(1).max(128),
  message: z.string().min(1).max(4096).optional(),
  severity: z.enum(['info', 'warning', 'error']).default('info'),
  actions: z
    .array(
      z.strictObject({
        id: LocalIdSchema,
        title: z.string().min(1).max(128),
        command: z.string().min(1).max(256)
      })
    )
    .max(4)
    .default([]),
  when: WhenExpressionSchema.optional()
})
export type NotificationContribution = z.infer<typeof NotificationContributionSchema>

export const HostSurfaceMatcherSchema = z.enum([
  'workbench:*',
  'workbench:code',
  'workbench:design',
  'workbench:write',
  'workbench:connect'
])
export type HostSurfaceMatcher = z.infer<typeof HostSurfaceMatcherSchema>

export const HostContentScriptContributionSchema = z.strictObject({
  id: LocalIdSchema,
  matches: z.array(HostSurfaceMatcherSchema).min(1).max(64),
  scripts: z.array(RelativePathSchema).min(1).max(32),
  styles: z.array(RelativePathSchema).max(32).default([]),
  runAt: z.enum(['documentStart', 'documentEnd']).default('documentEnd')
})
export type HostContentScriptContribution = z.infer<typeof HostContentScriptContributionSchema>

export const ExtensionContributionsSchema = z.strictObject({
  commands: z.array(CommandContributionSchema).max(512).default([]),
  'views.containers': z.array(ViewContainerContributionSchema).max(64).default([]),
  'views.leftSidebar': z.array(ViewContributionSchema).max(128).default([]),
  'views.rightSidebar': z.array(ViewContributionSchema).max(128).default([]),
  'views.auxiliaryPanel': z.array(ViewContributionSchema).max(128).default([]),
  'views.editorTab': z.array(ViewContributionSchema).max(128).default([]),
  'views.fullPage': z.array(ViewContributionSchema).max(128).default([]),
  'actions.topBar': z.array(ActionContributionSchema).max(128).default([]),
  'actions.composer': z.array(ActionContributionSchema).max(128).default([]),
  'actions.message': z.array(ActionContributionSchema).max(128).default([]),
  'message.resultPreviews': z.array(ResultPreviewContributionSchema).max(128).default([]),
  settings: z.array(SettingsContributionSchema).max(64).default([]),
  contextMenus: z.array(ContextMenuContributionSchema).max(256).default([]),
  notifications: z.array(NotificationContributionSchema).max(128).default([]),
  agentProfiles: z.array(AgentProfileDeclarationSchema).max(64).default([]),
  tools: z.array(ExtensionToolDeclarationSchema).max(512).default([]),
  modelProviders: z.array(ModelProviderDeclarationSchema).max(64).default([]),
  authentication: z.array(AuthenticationProviderDeclarationSchema).max(64).default([]),
  hostContentScripts: z.array(HostContentScriptContributionSchema).max(32).default([])
})
export type ExtensionContributions = z.infer<typeof ExtensionContributionsSchema>
export type ExtensionContributionsInput = z.input<typeof ExtensionContributionsSchema>

export const ManifestLocaleTagSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(
    /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/,
    'Expected a bounded BCP 47 language tag'
  )
export type ManifestLocaleTag = z.infer<typeof ManifestLocaleTagSchema>

const LocalizedTitleSchema = z.strictObject({
  title: z.string().min(1).max(128).optional()
})
const LocalizedDescriptionSchema = z.strictObject({
  description: z.string().max(2048).optional()
})
const LocalizedCommandSchema = LocalizedTitleSchema.extend({
  category: z.string().min(1).max(128).optional(),
  description: z.string().max(2048).optional()
}).strict()
const LocalizedNotificationSchema = LocalizedTitleSchema.extend({
  message: z.string().min(1).max(4096).optional(),
  actions: z.record(LocalIdSchema, LocalizedTitleSchema).superRefine((value, context) => {
    if (Object.keys(value).length > 4) {
      context.addIssue({ code: 'custom', message: 'Notification localization supports at most 4 actions' })
    }
  }).optional()
}).strict()
const LocalizedSettingPropertySchema = z.strictObject({
  title: z.string().min(1).max(128).optional(),
  description: z.string().max(2048).optional()
})
const LocalizedSettingsSchema = LocalizedTitleSchema.extend({
  properties: z.record(
    z.string().min(1).max(256),
    LocalizedSettingPropertySchema
  ).superRefine((value, context) => {
    if (Object.keys(value).length > 256) {
      context.addIssue({ code: 'custom', message: 'Settings localization supports at most 256 properties' })
    }
  }).optional()
}).strict()
const LocalizedModelSchema = z.strictObject({
  displayName: z.string().min(1).max(256).optional(),
  description: z.string().max(2048).optional()
})
const LocalizedModelProviderSchema = z.strictObject({
  displayName: z.string().min(1).max(128).optional(),
  models: z.record(z.string().min(1).max(256), LocalizedModelSchema).superRefine((value, context) => {
    if (Object.keys(value).length > 512) {
      context.addIssue({ code: 'custom', message: 'Provider localization supports at most 512 models' })
    }
  }).optional()
})
const LocalizedDisplayNameSchema = z.strictObject({
  displayName: z.string().min(1).max(128).optional()
})
const LocalizedAgentProfileSchema = LocalizedTitleSchema.extend({
  description: z.string().max(2048).optional()
}).strict()

function boundedLocalizationRecord<T extends z.ZodType>(
  valueSchema: T,
  maxEntries: number
) {
  return z.record(LocalIdSchema, valueSchema).superRefine((value, context) => {
    if (Object.keys(value).length > maxEntries) {
      context.addIssue({
        code: 'custom',
        message: `Localization map must contain at most ${maxEntries} entries`
      })
    }
  })
}

export const ManifestContributionLocalizationsSchema = z.strictObject({
  commands: boundedLocalizationRecord(LocalizedCommandSchema, 512).optional(),
  'views.containers': boundedLocalizationRecord(LocalizedTitleSchema, 64).optional(),
  'views.leftSidebar': boundedLocalizationRecord(LocalizedTitleSchema, 128).optional(),
  'views.rightSidebar': boundedLocalizationRecord(LocalizedTitleSchema, 128).optional(),
  'views.auxiliaryPanel': boundedLocalizationRecord(LocalizedTitleSchema, 128).optional(),
  'views.editorTab': boundedLocalizationRecord(LocalizedTitleSchema, 128).optional(),
  'views.fullPage': boundedLocalizationRecord(LocalizedTitleSchema, 128).optional(),
  'actions.topBar': boundedLocalizationRecord(LocalizedTitleSchema, 128).optional(),
  'actions.composer': boundedLocalizationRecord(LocalizedTitleSchema, 128).optional(),
  'actions.message': boundedLocalizationRecord(LocalizedTitleSchema, 128).optional(),
  'message.resultPreviews': boundedLocalizationRecord(LocalizedTitleSchema, 128).optional(),
  settings: boundedLocalizationRecord(LocalizedSettingsSchema, 64).optional(),
  notifications: boundedLocalizationRecord(LocalizedNotificationSchema, 128).optional(),
  agentProfiles: boundedLocalizationRecord(LocalizedAgentProfileSchema, 64).optional(),
  tools: boundedLocalizationRecord(LocalizedDescriptionSchema, 512).optional(),
  modelProviders: boundedLocalizationRecord(LocalizedModelProviderSchema, 64).optional(),
  authentication: boundedLocalizationRecord(LocalizedDisplayNameSchema, 64).optional()
})
export type ManifestContributionLocalizations = z.infer<
  typeof ManifestContributionLocalizationsSchema
>

export const ManifestLocalizationSchema = z.strictObject({
  displayName: z.string().min(1).max(128).optional(),
  description: z.string().max(4096).optional(),
  contributes: ManifestContributionLocalizationsSchema.optional()
})
export type ManifestLocalization = z.infer<typeof ManifestLocalizationSchema>

export const ManifestLocalizationsSchema = z
  .record(ManifestLocaleTagSchema, ManifestLocalizationSchema)
  .superRefine((value, context) => {
    const entries = Object.entries(value)
    if (entries.length > 32) {
      context.addIssue({ code: 'custom', message: 'Manifest must contain at most 32 locale overlays' })
    }
    const normalized = new Set<string>()
    for (const [locale] of entries) {
      const key = locale.toLowerCase()
      if (normalized.has(key)) {
        context.addIssue({
          code: 'custom',
          path: [locale],
          message: `Duplicate locale overlay after case normalization: ${locale}`
        })
      }
      normalized.add(key)
    }
  })
export type ManifestLocalizations = z.infer<typeof ManifestLocalizationsSchema>

const BrowserOnlyContributionsSchema = ExtensionContributionsSchema.extend({
  commands: z.array(CommandContributionSchema).max(0).default([]),
  agentProfiles: z.array(AgentProfileDeclarationSchema).max(0).default([]),
  tools: z.array(ExtensionToolDeclarationSchema).max(0).default([]),
  modelProviders: z.array(ModelProviderDeclarationSchema).max(0).default([]),
  authentication: z.array(AuthenticationProviderDeclarationSchema).max(0).default([])
}).strict()

const ManifestCommonShape = {
  $schema: z.string().url().optional(),
  manifestVersion: z.literal(CURRENT_MANIFEST_VERSION),
  apiVersion: SemverSchema,
  name: ExtensionNameSchema,
  publisher: PublisherSchema,
  version: SemverSchema,
  displayName: z.string().min(1).max(128).optional(),
  description: z.string().max(4096).optional(),
  icon: IconPathSchema.optional(),
  localizations: ManifestLocalizationsSchema.optional(),
  license: z.string().min(1).max(128).optional(),
  homepage: z.string().url().optional(),
  engines: z.strictObject({ kun: SemverRangeSchema }),
  activationEvents: z.array(ActivationEventSchema).max(512),
  contributes: ExtensionContributionsSchema,
  permissions: z.array(PermissionSchema).max(256),
  stateSchemaVersion: z.number().int().nonnegative(),
  signature: z
    .strictObject({
      algorithm: z.enum(['ed25519']),
      keyId: z.string().min(1).max(256),
      value: z.string().min(1).max(16_384)
    })
    .optional()
}

const StructuralExtensionManifestSchema = z.union([
  z.strictObject({ ...ManifestCommonShape, main: RelativePathSchema, browser: RelativePathSchema.optional() }),
  z.strictObject({
    ...ManifestCommonShape,
    contributes: BrowserOnlyContributionsSchema,
    main: z.never().optional(),
    browser: RelativePathSchema
  })
])

export const MANIFEST_CONTRIBUTION_PERMISSION_REQUIREMENTS = {
  commands: ['commands.register'],
  'views.containers': ['ui.views'],
  'views.leftSidebar': ['ui.views', 'webview'],
  'views.rightSidebar': ['ui.views', 'webview'],
  'views.auxiliaryPanel': ['ui.views', 'webview'],
  'views.editorTab': ['ui.views', 'webview'],
  'views.fullPage': ['ui.views', 'webview'],
  'actions.topBar': ['ui.actions'],
  'actions.composer': ['ui.actions'],
  'actions.message': ['ui.actions'],
  'message.resultPreviews': ['ui.views', 'webview'],
  settings: ['ui.actions'],
  contextMenus: ['ui.actions'],
  notifications: ['ui.notifications'],
  agentProfiles: ['agent.run'],
  tools: ['tools.register'],
  modelProviders: ['providers.register'],
  authentication: [],
  hostContentScripts: ['hostDom']
} as const satisfies Record<keyof ExtensionContributions, readonly string[]>

export const ExtensionManifestSchema = StructuralExtensionManifestSchema.superRefine(
  (manifest, context) => {
    const required = requiredManifestPermissions(manifest)
    for (const permission of required) {
      if (!manifest.permissions.includes(permission as never)) {
        context.addIssue({
          code: 'custom',
          path: ['permissions'],
          message: `Permission ${permission} is required by the declared entrypoints or contributions`
        })
      }
    }
    if (
      manifest.permissions.includes('webview.external') &&
      !manifest.permissions.some((permission) => permission.startsWith('network:'))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['permissions'],
        message: 'Permission webview.external requires at least one network:<hostname> grant'
      })
    }

    const declaredExternalViews = [
      ...manifest.contributes['views.leftSidebar'],
      ...manifest.contributes['views.rightSidebar'],
      ...manifest.contributes['views.auxiliaryPanel'],
      ...manifest.contributes['views.editorTab'],
      ...manifest.contributes['views.fullPage']
    ].filter((view) => view.externalBrowser !== undefined)
    for (const view of declaredExternalViews) {
      if (!manifest.permissions.includes('webview.external')) {
        context.addIssue({
          code: 'custom',
          path: ['permissions'],
          message: `Permission webview.external is required by View ${view.id}`
        })
      }
      const siteIds = new Set<string>()
      for (const site of view.externalBrowser!.sites) {
        if (siteIds.has(site.id)) {
          context.addIssue({
            code: 'custom',
            path: ['contributes'],
            message: `External browser View ${view.id} has duplicate site id ${site.id}`
          })
        }
        siteIds.add(site.id)
        let hostname: string
        try {
          hostname = new URL(site.url).hostname.toLowerCase()
        } catch {
          continue
        }
        const requiredPermission = `network:${hostname}`
        if (!manifest.permissions.some((permission) =>
          permissionMatches(permission, requiredPermission))) {
          context.addIssue({
            code: 'custom',
            path: ['permissions'],
            message: `External browser site ${site.id} requires a network grant for ${hostname}`
          })
        }
      }
    }

    const activationEvents = new Set(manifest.activationEvents)
    const startupActivated = activationEvents.has('onStartup')
    const viewContributions = [
      ...manifest.contributes['views.leftSidebar'],
      ...manifest.contributes['views.rightSidebar'],
      ...manifest.contributes['views.auxiliaryPanel'],
      ...manifest.contributes['views.editorTab'],
      ...manifest.contributes['views.fullPage'],
      ...manifest.contributes['message.resultPreviews']
    ]
    const activationTargets = [
      { kind: 'onView', entries: viewContributions },
      { kind: 'onCommand', entries: manifest.contributes.commands },
      { kind: 'onTool', entries: manifest.contributes.tools },
      { kind: 'onProvider', entries: manifest.contributes.modelProviders },
      { kind: 'onAuthentication', entries: manifest.contributes.authentication },
      { kind: 'onAgentProfile', entries: manifest.contributes.agentProfiles }
    ] as const
    for (const target of activationTargets) {
      for (const entry of target.entries) {
        const event = `${target.kind}:${entry.id}`
        if (!startupActivated && !activationEvents.has(event)) {
          context.addIssue({
            code: 'custom',
            path: ['activationEvents'],
            message: `Activation event ${event} is required by the declared contribution`
          })
        }
      }
    }

    const targetIds: ReadonlyMap<string, Set<string>> = new Map(activationTargets.map(({ kind, entries }) => [
      kind,
      new Set(entries.map(({ id }) => id))
    ]))
    manifest.activationEvents.forEach((event, index) => {
      if (event === 'onStartup') return
      const separator = event.indexOf(':')
      const kind = event.slice(0, separator)
      const id = event.slice(separator + 1)
      if (!targetIds.get(kind)?.has(id)) {
        context.addIssue({
          code: 'custom',
          path: ['activationEvents', index],
          message: `Activation event ${event} does not reference a declared contribution`
        })
      }
    })

    const idCollections = [
      ['commands', manifest.contributes.commands],
      ['views.containers', manifest.contributes['views.containers']],
      ['views', viewContributions],
      ['actions.topBar', manifest.contributes['actions.topBar']],
      ['actions.composer', manifest.contributes['actions.composer']],
      ['actions.message', manifest.contributes['actions.message']],
      ['settings', manifest.contributes.settings],
      ['contextMenus', manifest.contributes.contextMenus],
      ['notifications', manifest.contributes.notifications],
      ['agentProfiles', manifest.contributes.agentProfiles],
      ['tools', manifest.contributes.tools],
      ['modelProviders', manifest.contributes.modelProviders],
      ['authentication', manifest.contributes.authentication],
      ['hostContentScripts', manifest.contributes.hostContentScripts]
    ] as const
    const workbenchCollections = new Set([
      'commands',
      'views.containers',
      'views',
      'actions.topBar',
      'actions.composer',
      'actions.message',
      'settings',
      'contextMenus',
      'notifications',
      'hostContentScripts'
    ])
    const workbenchIds = new Map<string, string>()
    for (const [collection, entries] of idCollections) {
      const seen = new Set<string>()
      for (const entry of entries) {
        const duplicateInCollection = seen.has(entry.id)
        if (duplicateInCollection) {
          context.addIssue({
            code: 'custom',
            path: ['contributes', collection],
            message: `Duplicate contribution id: ${entry.id}`
          })
        }
        if (!duplicateInCollection && workbenchCollections.has(collection)) {
          const previousCollection = workbenchIds.get(entry.id)
          if (previousCollection !== undefined) {
            context.addIssue({
              code: 'custom',
              path: ['contributes', collection],
              message: `Duplicate workbench contribution id: ${entry.id} (already declared in ${previousCollection})`
            })
          } else {
            workbenchIds.set(entry.id, collection)
          }
        }
        seen.add(entry.id)
      }
    }

    const authenticationIds = new Set(
      manifest.contributes.authentication.map(({ id }) => id)
    )
    manifest.contributes.modelProviders.forEach((provider, index) => {
      if (
        provider.authenticationProviderId &&
        !authenticationIds.has(provider.authenticationProviderId)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['contributes', 'modelProviders', index, 'authenticationProviderId'],
          message: `Authentication contribution is not declared: ${provider.authenticationProviderId}`
        })
      }
    })

    validateManifestLocalizationReferences(manifest, context)
  }
)
export type ExtensionManifest = z.infer<typeof ExtensionManifestSchema>
export type ExtensionManifestInput = z.input<typeof ExtensionManifestSchema>

export function requiredManifestPermissions(
  manifest: z.infer<typeof StructuralExtensionManifestSchema>
): string[] {
  const required = new Set<string>()
  if (manifest.browser) required.add('webview')
  for (const [key, permissions] of Object.entries(MANIFEST_CONTRIBUTION_PERMISSION_REQUIREMENTS)) {
    if (manifest.contributes[key as keyof ExtensionContributions].length === 0) continue
    for (const permission of permissions) required.add(permission)
  }
  return [...required].sort()
}

export function parseExtensionManifest(value: unknown): ExtensionManifest {
  return ExtensionManifestSchema.parse(value)
}

/**
 * Resolves only declared display copy. Identity, activation, permissions,
 * executable paths, schemas and instructions always remain base-manifest data.
 */
export function resolveExtensionManifestLocale(
  manifest: ExtensionManifest,
  requestedLocale: string | undefined
): ExtensionManifest {
  const localization = findManifestLocalization(manifest.localizations ?? {}, requestedLocale)
  if (!localization) return manifest
  const localized = structuredClone(manifest)
  if (localization.displayName !== undefined) localized.displayName = localization.displayName
  if (localization.description !== undefined) localized.description = localization.description

  const contributionLocalizations = localization.contributes
  applyEntryLocalizations(localized.contributes.commands, contributionLocalizations?.commands)
  applyEntryLocalizations(localized.contributes['views.containers'], contributionLocalizations?.['views.containers'])
  applyEntryLocalizations(localized.contributes['views.leftSidebar'], contributionLocalizations?.['views.leftSidebar'])
  applyEntryLocalizations(localized.contributes['views.rightSidebar'], contributionLocalizations?.['views.rightSidebar'])
  applyEntryLocalizations(localized.contributes['views.auxiliaryPanel'], contributionLocalizations?.['views.auxiliaryPanel'])
  applyEntryLocalizations(localized.contributes['views.editorTab'], contributionLocalizations?.['views.editorTab'])
  applyEntryLocalizations(localized.contributes['views.fullPage'], contributionLocalizations?.['views.fullPage'])
  applyEntryLocalizations(localized.contributes['actions.topBar'], contributionLocalizations?.['actions.topBar'])
  applyEntryLocalizations(localized.contributes['actions.composer'], contributionLocalizations?.['actions.composer'])
  applyEntryLocalizations(localized.contributes['actions.message'], contributionLocalizations?.['actions.message'])
  applyEntryLocalizations(
    localized.contributes['message.resultPreviews'],
    contributionLocalizations?.['message.resultPreviews']
  )
  applyEntryLocalizations(localized.contributes.agentProfiles, contributionLocalizations?.agentProfiles)
  applyEntryLocalizations(localized.contributes.tools, contributionLocalizations?.tools)
  applyEntryLocalizations(localized.contributes.authentication, contributionLocalizations?.authentication)

  for (const setting of localized.contributes.settings) {
    const overlay = contributionLocalizations?.settings?.[setting.id]
    if (!overlay) continue
    if (overlay.title !== undefined) setting.title = overlay.title
    for (const [key, propertyOverlay] of Object.entries(overlay.properties ?? {})) {
      const property = setting.properties[key]
      if (property) setting.properties[key] = { ...property, ...propertyOverlay }
    }
  }
  for (const notification of localized.contributes.notifications) {
    const overlay = contributionLocalizations?.notifications?.[notification.id]
    if (!overlay) continue
    if (overlay.title !== undefined) notification.title = overlay.title
    if (overlay.message !== undefined) notification.message = overlay.message
    for (const action of notification.actions) {
      const actionOverlay = overlay.actions?.[action.id]
      if (actionOverlay?.title !== undefined) action.title = actionOverlay.title
    }
  }
  for (const provider of localized.contributes.modelProviders) {
    const overlay = contributionLocalizations?.modelProviders?.[provider.id]
    if (!overlay) continue
    if (overlay.displayName !== undefined) provider.displayName = overlay.displayName
    for (const model of provider.models) {
      const modelOverlay = overlay.models?.[model.id]
      if (!modelOverlay) continue
      if (modelOverlay.displayName !== undefined) model.displayName = modelOverlay.displayName
      if (modelOverlay.description !== undefined) model.description = modelOverlay.description
    }
  }
  return localized
}

function findManifestLocalization(
  localizations: ManifestLocalizations,
  requestedLocale: string | undefined
): ManifestLocalization | undefined {
  const requested = requestedLocale?.trim().replace(/_/g, '-').toLowerCase()
  if (!requested) return undefined
  const byNormalizedLocale = new Map(
    Object.entries(localizations).map(([locale, value]) => [locale.toLowerCase(), value])
  )
  let candidate = requested
  while (candidate) {
    const match = byNormalizedLocale.get(candidate)
    if (match) return match
    const separator = candidate.lastIndexOf('-')
    if (separator < 0) break
    candidate = candidate.slice(0, separator)
  }
  return undefined
}

function applyEntryLocalizations(
  entries: Array<{ id: string }>,
  overlays: Record<string, Record<string, unknown>> | undefined
): void {
  if (!overlays) return
  for (const entry of entries) {
    const overlay = overlays[entry.id]
    if (overlay) Object.assign(entry, overlay)
  }
}

function validateManifestLocalizationReferences(
  manifest: z.infer<typeof StructuralExtensionManifestSchema>,
  context: z.RefinementCtx
): void {
  const contributionPoints = Object.keys(ManifestContributionLocalizationsSchema.shape) as Array<
    keyof ManifestContributionLocalizations
  >
  for (const [locale, localization] of Object.entries(manifest.localizations ?? {})) {
    for (const point of contributionPoints) {
      const declared = new Set(manifest.contributes[point].map(({ id }) => id))
      for (const localizedId of Object.keys(localization.contributes?.[point] ?? {})) {
        if (!declared.has(localizedId)) {
          context.addIssue({
            code: 'custom',
            path: ['localizations', locale, 'contributes', point, localizedId],
            message: `Localization references an undeclared ${point} contribution: ${localizedId}`
          })
        }
      }
    }

    for (const [settingId, settingOverlay] of Object.entries(localization.contributes?.settings ?? {})) {
      const setting = manifest.contributes.settings.find(({ id }) => id === settingId)
      if (!setting) continue
      for (const propertyKey of Object.keys(settingOverlay.properties ?? {})) {
        if (!(propertyKey in setting.properties)) {
          context.addIssue({
            code: 'custom',
            path: ['localizations', locale, 'contributes', 'settings', settingId, 'properties', propertyKey],
            message: `Localization references an undeclared setting property: ${propertyKey}`
          })
        }
      }
    }
    for (const [notificationId, notificationOverlay] of Object.entries(
      localization.contributes?.notifications ?? {}
    )) {
      const notification = manifest.contributes.notifications.find(({ id }) => id === notificationId)
      if (!notification) continue
      const actionIds = new Set(notification.actions.map(({ id }) => id))
      for (const actionId of Object.keys(notificationOverlay.actions ?? {})) {
        if (!actionIds.has(actionId)) {
          context.addIssue({
            code: 'custom',
            path: ['localizations', locale, 'contributes', 'notifications', notificationId, 'actions', actionId],
            message: `Localization references an undeclared notification action: ${actionId}`
          })
        }
      }
    }
    for (const [providerId, providerOverlay] of Object.entries(
      localization.contributes?.modelProviders ?? {}
    )) {
      const provider = manifest.contributes.modelProviders.find(({ id }) => id === providerId)
      if (!provider) continue
      const modelIds = new Set(provider.models.map(({ id }) => id))
      for (const modelId of Object.keys(providerOverlay.models ?? {})) {
        if (!modelIds.has(modelId)) {
          context.addIssue({
            code: 'custom',
            path: ['localizations', locale, 'contributes', 'modelProviders', providerId, 'models', modelId],
            message: `Localization references an undeclared provider model: ${modelId}`
          })
        }
      }
    }
  }
}
