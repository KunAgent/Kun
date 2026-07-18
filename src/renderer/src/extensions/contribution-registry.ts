import {
  ContributionIdSchema,
  ExtensionContributionsSchema,
  ExtensionIdSchema,
  PermissionSchema,
  SemverSchema,
  ViewContainerContributionSchema,
  ViewContributionSchema,
  qualifiedContributionId,
  type ActionContribution,
  type CommandContribution,
  type ContextMenuContribution,
  type ExtensionContributions,
  type HostContentScriptContribution,
  type NotificationContribution,
  type ResultPreviewContribution,
  type SettingsContribution,
  type ViewContainerContribution,
  type ViewContribution
} from '@kun/extension-api'
import { z } from 'zod'
import { BUILTIN_RIGHT_PANEL_IDS } from './contribution-ids'
import {
  evaluateWhenExpression,
  validateWhenExpression,
  type WorkbenchContext
} from './when-expression'

export const WORKBENCH_CONTRIBUTION_POINTS = [
  'commands',
  'views.containers',
  'views.leftSidebar',
  'views.rightSidebar',
  'views.auxiliaryPanel',
  'views.editorTab',
  'views.fullPage',
  'actions.topBar',
  'actions.composer',
  'actions.message',
  'message.resultPreviews',
  'settings',
  'contextMenus',
  'notifications',
  'hostContentScripts'
] as const

export type WorkbenchContributionPoint = (typeof WORKBENCH_CONTRIBUTION_POINTS)[number]

export type ContributionPayloadMap = {
  commands: CommandContribution
  'views.containers': ViewContainerContribution
  'views.leftSidebar': ViewContribution
  'views.rightSidebar': ViewContribution
  'views.auxiliaryPanel': ViewContribution
  'views.editorTab': ViewContribution
  'views.fullPage': ViewContribution
  'actions.topBar': ActionContribution
  'actions.composer': ActionContribution
  'actions.message': ActionContribution
  'message.resultPreviews': ResultPreviewContribution
  settings: SettingsContribution
  contextMenus: ContextMenuContribution
  notifications: NotificationContribution
  hostContentScripts: HostContentScriptContribution
}

export type ContributionOwner =
  | { kind: 'builtin' }
  | {
      kind: 'extension'
      extensionId: string
      extensionVersion: string
      grantedPermissions: readonly string[]
      source?: unknown
    }

export type RegisteredContribution<
  K extends WorkbenchContributionPoint = WorkbenchContributionPoint
> = K extends WorkbenchContributionPoint
  ? {
      id: string
      point: K
      payload: ContributionPayloadMap[K]
      owner: ContributionOwner
      order: number
      group: string
      workspaceTrusted: boolean
      enabled: boolean
      compatible: boolean
    }
  : never

const RightRailViewDiscoveryPayloadSchema = ViewContributionSchema.pick({
  id: true,
  title: true,
  icon: true,
  container: true,
  when: true,
  showInRightRail: true,
  order: true
})

const RightRailContainerDiscoveryPayloadSchema = ViewContainerContributionSchema.pick({
  id: true,
  title: true,
  icon: true,
  location: true,
  order: true
}).refine((container) => container.location === 'rightSidebar', {
  message: 'Discovery containers must target the right sidebar'
})

const RightRailDiscoverySchema = z.strictObject({
  views: z.array(RightRailViewDiscoveryPayloadSchema).max(128).default([]),
  containers: z.array(RightRailContainerDiscoveryPayloadSchema).max(64).default([])
}).default({ views: [], containers: [] })

type ExtensionContributionOwner = Extract<ContributionOwner, { kind: 'extension' }>

export type ExtensionRightRailViewLauncher = {
  id: string
  point: 'views.rightSidebar'
  payload: z.infer<typeof RightRailViewDiscoveryPayloadSchema>
  owner: ExtensionContributionOwner
  order: number
  group: string
  workspaceTrusted: false
  enabled: boolean
  compatible: boolean
}

export type ExtensionRightRailContainerLauncher = {
  id: string
  point: 'views.containers'
  payload: z.infer<typeof RightRailContainerDiscoveryPayloadSchema>
  owner: ExtensionContributionOwner
  order: number
  group: string
  workspaceTrusted: false
  enabled: boolean
  compatible: boolean
}

export type ExtensionRightRailViewEntry =
  | RegisteredContribution<'views.rightSidebar'>
  | ExtensionRightRailViewLauncher

export type ExtensionRightRailContainerEntry =
  | RegisteredContribution<'views.containers'>
  | ExtensionRightRailContainerLauncher

export type ContributionDiagnostic = {
  code:
    | 'CONTRIBUTION_DUPLICATE_ID'
    | 'CONTRIBUTION_INVALID_ID'
    | 'CONTRIBUTION_INVALID_WHEN'
    | 'CONTRIBUTION_PERMISSION_DENIED'
    | 'CONTRIBUTION_UNTRUSTED_WORKSPACE'
    | 'CONTRIBUTION_INCOMPATIBLE'
  message: string
  extensionId?: string
  extensionVersion?: string
  contributionId?: string
  point?: WorkbenchContributionPoint
}

const ExtensionWorkbenchRecordWireSchema = z.object({
  id: ExtensionIdSchema,
  version: SemverSchema,
  contributes: ExtensionContributionsSchema,
  rightRailDiscovery: RightRailDiscoverySchema,
  grantedPermissions: z.array(PermissionSchema).max(256),
  enabled: z.boolean().default(true),
  compatible: z.boolean().default(true),
  workspaceTrusted: z.boolean().optional(),
  trust: z.union([
    z.boolean(),
    z.object({ workspaceTrusted: z.boolean() })
  ]).optional(),
  source: z.unknown().optional(),
  diagnostics: z
    .array(
      z.object({
        code: z.string().min(1).max(128),
        message: z.string().min(1).max(4_096)
      })
    )
    .max(256)
    .default([])
})

export const ExtensionWorkbenchRecordSchema = ExtensionWorkbenchRecordWireSchema.transform(
  ({ trust, workspaceTrusted, ...record }) => ({
    ...record,
    workspaceTrusted:
      workspaceTrusted ??
      (typeof trust === 'boolean' ? trust : trust?.workspaceTrusted) ??
      false
  })
)

export type ExtensionWorkbenchRecord = z.infer<typeof ExtensionWorkbenchRecordSchema>

export const ExtensionWorkbenchSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative().default(0),
  workspaceRoot: z.string().max(4_096).optional(),
  extensions: z.array(ExtensionWorkbenchRecordSchema).max(1_024)
})

export type ExtensionWorkbenchSnapshot = z.infer<typeof ExtensionWorkbenchSnapshotSchema>

const REQUIRED_PERMISSIONS: Readonly<Record<WorkbenchContributionPoint, readonly string[]>> = {
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
  hostContentScripts: ['hostDom']
}

const BUILTIN_PANEL_DEFINITIONS: readonly [string, string][] = [
  [BUILTIN_RIGHT_PANEL_IDS.todo, 'Todo'],
  [BUILTIN_RIGHT_PANEL_IDS.plan, 'Plan'],
  [BUILTIN_RIGHT_PANEL_IDS.changes, 'Changes'],
  [BUILTIN_RIGHT_PANEL_IDS.browser, 'Preview'],
  [BUILTIN_RIGHT_PANEL_IDS.terminal, 'Terminal'],
  [BUILTIN_RIGHT_PANEL_IDS.files, 'Files'],
  [BUILTIN_RIGHT_PANEL_IDS.file, 'File preview'],
  [BUILTIN_RIGHT_PANEL_IDS.sideConversations, 'Branch conversations'],
  [BUILTIN_RIGHT_PANEL_IDS.sddAi, 'Requirement assistant'],
  [BUILTIN_RIGHT_PANEL_IDS.canvas, 'Whiteboard'],
  [BUILTIN_RIGHT_PANEL_IDS.subagents, 'Subagents']
]

function payloadWhen(payload: ContributionPayloadMap[WorkbenchContributionPoint]): string | undefined {
  if ('when' in payload && typeof payload.when === 'string') return payload.when
  if ('enablement' in payload && typeof payload.enablement === 'string') return payload.enablement
  return undefined
}

function contributionGroup(
  point: WorkbenchContributionPoint,
  payload: ContributionPayloadMap[WorkbenchContributionPoint]
): string {
  if ('group' in payload && typeof payload.group === 'string') return payload.group
  if ('container' in payload && typeof payload.container === 'string') return payload.container
  if (point === 'views.containers' && 'location' in payload) return String(payload.location)
  if (point === 'contextMenus' && 'location' in payload) return String(payload.location)
  return point
}

function contributionOrder(payload: ContributionPayloadMap[WorkbenchContributionPoint]): number {
  return 'order' in payload && typeof payload.order === 'number' ? payload.order : 0
}

function referencedCommands(payload: ContributionPayloadMap[WorkbenchContributionPoint]): string[] {
  const commands: string[] = []
  if ('command' in payload && typeof payload.command === 'string') commands.push(payload.command)
  if ('actions' in payload && Array.isArray(payload.actions)) {
    for (const action of payload.actions) {
      if (action && typeof action === 'object' && 'command' in action && typeof action.command === 'string') {
        commands.push(action.command)
      }
    }
  }
  return commands
}

function commandReferenceAllowed(extensionId: string, command: string): boolean {
  return !command.startsWith('extension:') || command.startsWith(`extension:${extensionId}/`)
}

function extensionLocalContributions(
  contributes: ExtensionContributions
): Array<{
  point: WorkbenchContributionPoint
  payload: ContributionPayloadMap[WorkbenchContributionPoint]
}> {
  return WORKBENCH_CONTRIBUTION_POINTS.flatMap((point) =>
    (contributes[point] as ContributionPayloadMap[typeof point][]).map((payload) => ({
      point,
      payload
    }))
  )
}

function compareContributions(
  left: { group: string; order: number; id: string },
  right: { group: string; order: number; id: string }
): number {
  return left.group.localeCompare(right.group) || left.order - right.order || left.id.localeCompare(right.id)
}

export class ContributionRegistry {
  private contributions = new Map<string, RegisteredContribution>()
  private rightRailViewLaunchers = new Map<string, ExtensionRightRailViewLauncher>()
  private rightRailContainerLaunchers = new Map<string, ExtensionRightRailContainerLauncher>()
  private diagnostics: ContributionDiagnostic[] = []
  private readonly listeners = new Set<() => void>()
  private revision = 0

  constructor() {
    this.installBuiltins()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getRevision = (): number => this.revision

  list<K extends WorkbenchContributionPoint>(
    point: K,
    context: WorkbenchContext = {}
  ): RegisteredContribution<K>[] {
    return [...this.contributions.values()]
      .filter((item): item is RegisteredContribution<K> => item.point === point)
      .filter((item) => this.isVisible(item, context))
      .sort(compareContributions)
  }

  /**
   * Returns runnable right-sidebar Views plus inert authorization launchers.
   * Launchers never participate in get/has/layout resolution and therefore
   * cannot be used to create a View Session before workspace review.
   */
  listRightRailViewEntries(context: WorkbenchContext = {}): ExtensionRightRailViewEntry[] {
    const entries = new Map<string, ExtensionRightRailViewEntry>()
    for (const launcher of this.rightRailViewLaunchers.values()) {
      if (
        launcher.enabled &&
        launcher.compatible &&
        launcher.payload.showInRightRail &&
        evaluateWhenExpression(launcher.payload.when, context)
      ) entries.set(launcher.id, launcher)
    }
    for (const contribution of this.list('views.rightSidebar', context)) {
      if (contribution.owner.kind === 'extension' && contribution.payload.showInRightRail) {
        entries.set(contribution.id, contribution)
      }
    }
    return [...entries.values()].sort(compareContributions)
  }

  listRightRailContainerEntries(
    context: WorkbenchContext = {}
  ): ExtensionRightRailContainerEntry[] {
    const entries = new Map<string, ExtensionRightRailContainerEntry>()
    for (const launcher of this.rightRailContainerLaunchers.values()) {
      if (launcher.enabled && launcher.compatible) entries.set(launcher.id, launcher)
    }
    for (const contribution of this.list('views.containers', context)) {
      if (
        contribution.owner.kind === 'extension' &&
        contribution.payload.location === 'rightSidebar'
      ) entries.set(contribution.id, contribution)
    }
    return [...entries.values()].sort(compareContributions)
  }

  get(id: string, context: WorkbenchContext = {}): RegisteredContribution | undefined {
    const contribution = this.contributions.get(id)
    return contribution && this.isVisible(contribution, context) ? contribution : undefined
  }

  has(id: string, context: WorkbenchContext = {}): boolean {
    return this.get(id, context) !== undefined
  }

  getDiagnostics(): readonly ContributionDiagnostic[] {
    return this.diagnostics
  }

  replaceExtensions(snapshot: ExtensionWorkbenchSnapshot): void {
    const parsed = ExtensionWorkbenchSnapshotSchema.parse(snapshot)
    const next = new Map(
      [...this.contributions].filter(([, contribution]) => contribution.owner.kind === 'builtin')
    )
    const nextRightRailViews = new Map<string, ExtensionRightRailViewLauncher>()
    const nextRightRailContainers = new Map<string, ExtensionRightRailContainerLauncher>()
    const diagnostics: ContributionDiagnostic[] = []

    for (const extension of [...parsed.extensions].sort((a, b) => a.id.localeCompare(b.id))) {
      const staged: RegisteredContribution[] = []
      const stagedRightRailViews: ExtensionRightRailViewLauncher[] = []
      const stagedRightRailContainers: ExtensionRightRailContainerLauncher[] = []
      const localIds = new Set<string>()
      let rejected = false

      for (const { point, payload } of extensionLocalContributions(extension.contributes)) {
        const id = qualifiedContributionId(extension.id, payload.id)
        if (!ContributionIdSchema.safeParse(id).success) {
          diagnostics.push({
            code: 'CONTRIBUTION_INVALID_ID',
            message: `Invalid contribution identity: ${id}`,
            extensionId: extension.id,
            extensionVersion: extension.version,
            contributionId: id,
            point
          })
          rejected = true
          continue
        }
        if (localIds.has(payload.id) || next.has(id)) {
          diagnostics.push({
            code: 'CONTRIBUTION_DUPLICATE_ID',
            message: `Duplicate contribution identity: ${id}`,
            extensionId: extension.id,
            extensionVersion: extension.version,
            contributionId: id,
            point
          })
          rejected = true
          continue
        }
        localIds.add(payload.id)
        const invalidWhen = validateWhenExpression(payloadWhen(payload))
        if (invalidWhen) {
          diagnostics.push({
            code: 'CONTRIBUTION_INVALID_WHEN',
            message: `${id}: ${invalidWhen}`,
            extensionId: extension.id,
            extensionVersion: extension.version,
            contributionId: id,
            point
          })
          rejected = true
          continue
        }
        const missingPermissions = REQUIRED_PERMISSIONS[point].filter(
          (permission) => !extension.grantedPermissions.includes(permission as never)
        )
        if (missingPermissions.length > 0) {
          diagnostics.push({
            code: 'CONTRIBUTION_PERMISSION_DENIED',
            message: `${id} is hidden because these permissions are not granted: ${missingPermissions.join(', ')}`,
            extensionId: extension.id,
            extensionVersion: extension.version,
            contributionId: id,
            point
          })
        }
        if (!extension.workspaceTrusted) {
          diagnostics.push({
            code: 'CONTRIBUTION_UNTRUSTED_WORKSPACE',
            message: `${id} is hidden in the current untrusted workspace`,
            extensionId: extension.id,
            extensionVersion: extension.version,
            contributionId: id,
            point
          })
        }
        if (!extension.compatible) {
          diagnostics.push({
            code: 'CONTRIBUTION_INCOMPATIBLE',
            message: `${id} is incompatible with the running Kun version`,
            extensionId: extension.id,
            extensionVersion: extension.version,
            contributionId: id,
            point
          })
        }
        const foreignCommand = referencedCommands(payload).find(
          (command) => !commandReferenceAllowed(extension.id, command)
        )
        if (foreignCommand) {
          diagnostics.push({
            code: 'CONTRIBUTION_INVALID_ID',
            message: `${id} references a private command owned by another extension: ${foreignCommand}`,
            extensionId: extension.id,
            extensionVersion: extension.version,
            contributionId: id,
            point
          })
          rejected = true
          continue
        }
        staged.push({
          id,
          point,
          payload,
          owner: {
            kind: 'extension',
            extensionId: extension.id,
            extensionVersion: extension.version,
            grantedPermissions: extension.grantedPermissions,
            source: extension.source
          },
          order: contributionOrder(payload),
          group: contributionGroup(point, payload),
          workspaceTrusted: extension.workspaceTrusted,
          enabled: extension.enabled,
          compatible: extension.compatible
        } as RegisteredContribution)
      }

      // Untrusted workspaces receive only bounded, inert Host chrome. This
      // metadata is kept outside the executable contribution registry.
      if (!extension.workspaceTrusted) {
        for (const payload of extension.rightRailDiscovery.views) {
          const id = qualifiedContributionId(extension.id, payload.id)
          const invalidWhen = validateWhenExpression(payload.when)
          if (
            !ContributionIdSchema.safeParse(id).success ||
            localIds.has(payload.id) ||
            next.has(id) ||
            nextRightRailViews.has(id) ||
            nextRightRailContainers.has(id)
          ) {
            diagnostics.push({
              code: localIds.has(payload.id) ? 'CONTRIBUTION_DUPLICATE_ID' : 'CONTRIBUTION_INVALID_ID',
              message: `Invalid or duplicate right-rail launcher identity: ${id}`,
              extensionId: extension.id,
              extensionVersion: extension.version,
              contributionId: id,
              point: 'views.rightSidebar'
            })
            rejected = true
            continue
          }
          if (invalidWhen) {
            diagnostics.push({
              code: 'CONTRIBUTION_INVALID_WHEN',
              message: `${id}: ${invalidWhen}`,
              extensionId: extension.id,
              extensionVersion: extension.version,
              contributionId: id,
              point: 'views.rightSidebar'
            })
            rejected = true
            continue
          }
          localIds.add(payload.id)
          stagedRightRailViews.push({
            id,
            point: 'views.rightSidebar',
            payload,
            owner: {
              kind: 'extension',
              extensionId: extension.id,
              extensionVersion: extension.version,
              grantedPermissions: [],
              source: extension.source
            },
            order: payload.order,
            group: payload.container ?? 'views.rightSidebar',
            workspaceTrusted: false,
            enabled: extension.enabled,
            compatible: extension.compatible
          })
        }
        for (const payload of extension.rightRailDiscovery.containers) {
          const id = qualifiedContributionId(extension.id, payload.id)
          if (
            !ContributionIdSchema.safeParse(id).success ||
            localIds.has(payload.id) ||
            next.has(id) ||
            nextRightRailViews.has(id) ||
            nextRightRailContainers.has(id)
          ) {
            diagnostics.push({
              code: localIds.has(payload.id) ? 'CONTRIBUTION_DUPLICATE_ID' : 'CONTRIBUTION_INVALID_ID',
              message: `Invalid or duplicate right-rail container launcher identity: ${id}`,
              extensionId: extension.id,
              extensionVersion: extension.version,
              contributionId: id,
              point: 'views.containers'
            })
            rejected = true
            continue
          }
          localIds.add(payload.id)
          stagedRightRailContainers.push({
            id,
            point: 'views.containers',
            payload,
            owner: {
              kind: 'extension',
              extensionId: extension.id,
              extensionVersion: extension.version,
              grantedPermissions: [],
              source: extension.source
            },
            order: payload.order,
            group: payload.location,
            workspaceTrusted: false,
            enabled: extension.enabled,
            compatible: extension.compatible
          })
        }
      }

      // Do not expose a partially registered manifest when any identity or
      // expression is ambiguous. Other extensions and all built-ins survive.
      if (rejected) continue
      for (const contribution of staged) next.set(contribution.id, contribution)
      for (const launcher of stagedRightRailViews) nextRightRailViews.set(launcher.id, launcher)
      for (const launcher of stagedRightRailContainers) {
        nextRightRailContainers.set(launcher.id, launcher)
      }
    }

    this.contributions = next
    this.rightRailViewLaunchers = nextRightRailViews
    this.rightRailContainerLaunchers = nextRightRailContainers
    this.diagnostics = diagnostics
    this.emit()
  }

  removeExtension(extensionId: string): void {
    let changed = false
    for (const [id, contribution] of this.contributions) {
      if (contribution.owner.kind !== 'extension' || contribution.owner.extensionId !== extensionId) continue
      this.contributions.delete(id)
      changed = true
    }
    for (const [id, launcher] of this.rightRailViewLaunchers) {
      if (launcher.owner.extensionId !== extensionId) continue
      this.rightRailViewLaunchers.delete(id)
      changed = true
    }
    for (const [id, launcher] of this.rightRailContainerLaunchers) {
      if (launcher.owner.extensionId !== extensionId) continue
      this.rightRailContainerLaunchers.delete(id)
      changed = true
    }
    if (changed) this.emit()
  }

  sanitizeLayoutIds(ids: readonly string[], context: WorkbenchContext = {}): string[] {
    const result: string[] = []
    const seen = new Set<string>()
    for (const id of ids) {
      if (seen.has(id) || !this.has(id, context)) continue
      seen.add(id)
      result.push(id)
    }
    return result
  }

  resolveLayoutId(
    requested: string | null | undefined,
    fallback: string | null,
    context: WorkbenchContext = {}
  ): string | null {
    if (requested && this.has(requested, context)) return requested
    return fallback && this.has(fallback, context) ? fallback : null
  }

  private installBuiltins(): void {
    for (const [id, title] of BUILTIN_PANEL_DEFINITIONS) {
      this.contributions.set(id, {
        id,
        point: 'views.rightSidebar',
        payload: {
          id: id.slice('builtin:'.length),
          title,
          entry: `builtin/${id.slice('builtin:'.length)}`,
          showInRightRail: true,
          order: 0,
          multiple: false,
          localResourceRoots: []
        },
        owner: { kind: 'builtin' },
        order: 0,
        group: 'builtin',
        workspaceTrusted: true,
        enabled: true,
        compatible: true
      })
    }
  }

  private isVisible(contribution: RegisteredContribution, context: WorkbenchContext): boolean {
    if (!contribution.enabled || !contribution.compatible || !contribution.workspaceTrusted) return false
    if (contribution.owner.kind === 'extension') {
      const required = REQUIRED_PERMISSIONS[contribution.point]
      if (!required.every((permission) => contribution.owner.kind === 'extension' && contribution.owner.grantedPermissions.includes(permission))) {
        return false
      }
    }
    return evaluateWhenExpression(payloadWhen(contribution.payload), context)
  }

  private emit(): void {
    this.revision += 1
    for (const listener of this.listeners) listener()
  }
}

export const workbenchContributionRegistry = new ContributionRegistry()

export function extensionResourceUrl(extensionId: string, relativePath: string): string {
  const safeId = ExtensionIdSchema.parse(extensionId)
  const segments = relativePath.split('/').map((segment) => encodeURIComponent(segment))
  return `kun-extension://${safeId}/${segments.join('/')}`
}

export function extensionHostIconUrl(extensionId: string, relativePath: string): string {
  return `${extensionResourceUrl(extensionId, relativePath)}?kunHostResource=icon`
}

export function resolveContributionCommand(
  contribution: RegisteredContribution,
  command: string
): string {
  if (command.startsWith('builtin:')) return command
  if (contribution.owner.kind === 'builtin') return command.startsWith('extension:') ? '' : command
  const prefix = `extension:${contribution.owner.extensionId}/`
  if (command.startsWith('extension:')) return command.startsWith(prefix) ? command : ''
  return `${prefix}${command}`
}
