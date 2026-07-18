import type {
  ExtensionRightRailContainerEntry,
  ExtensionRightRailViewEntry,
  RegisteredContribution
} from './contribution-registry'
import { isExtensionContributionId } from './contribution-ids'

export type ExtensionWorkbenchViewPoint =
  | 'views.leftSidebar'
  | 'views.rightSidebar'
  | 'views.auxiliaryPanel'
  | 'views.editorTab'
  | 'views.fullPage'

export type ExtensionWorkbenchView = RegisteredContribution<ExtensionWorkbenchViewPoint>

export function isExtensionWorkbenchView(
  contribution: RegisteredContribution | undefined
): contribution is ExtensionWorkbenchView {
  return contribution !== undefined && [
    'views.leftSidebar',
    'views.rightSidebar',
    'views.auxiliaryPanel',
    'views.editorTab',
    'views.fullPage'
  ].includes(contribution.point)
}

export type ExtensionWorkbenchViewGroups = {
  leftSidebar: readonly RegisteredContribution<'views.leftSidebar'>[]
  rightSidebar: readonly RegisteredContribution<'views.rightSidebar'>[]
  auxiliaryPanel: readonly RegisteredContribution<'views.auxiliaryPanel'>[]
  editorTab: readonly RegisteredContribution<'views.editorTab'>[]
  fullPage: readonly RegisteredContribution<'views.fullPage'>[]
}

export type ExtensionRightContainerTarget = {
  container: ExtensionRightRailContainerEntry
  target: ExtensionRightRailViewEntry
}

export function resolveCommandOpenView(
  commandId: string,
  result: unknown,
  commands: readonly RegisteredContribution<'commands'>[],
  views: readonly ExtensionWorkbenchView[]
): ExtensionWorkbenchView | undefined {
  if (
    !result ||
    typeof result !== 'object' ||
    Array.isArray(result) ||
    !('action' in result) ||
    result.action !== 'open-view' ||
    !('viewId' in result) ||
    typeof result.viewId !== 'string'
  ) return undefined
  const command = commands.find((candidate) => candidate.id === commandId)
  if (command?.owner.kind !== 'extension') return undefined
  const extensionId = command.owner.extensionId
  return views.find((candidate) =>
    candidate.owner.kind === 'extension' &&
    candidate.owner.extensionId === extensionId &&
    candidate.payload.id === result.viewId
  )
}

export const EXTENSION_SURFACE_LAYOUT_STORAGE_KEY = 'kun.extension.surface-layout.v1'

export function readStoredExtensionSurfaceId(
  storage: Pick<Storage, 'getItem'>
): string | null {
  try {
    const raw = storage.getItem(EXTENSION_SURFACE_LAYOUT_STORAGE_KEY)
    return raw && isExtensionContributionId(raw) ? raw : null
  } catch {
    return null
  }
}

export function writeStoredExtensionSurfaceId(
  storage: Pick<Storage, 'setItem' | 'removeItem'>,
  contributionId: string | null
): void {
  try {
    if (contributionId && isExtensionContributionId(contributionId)) {
      storage.setItem(EXTENSION_SURFACE_LAYOUT_STORAGE_KEY, contributionId)
    } else {
      storage.removeItem(EXTENSION_SURFACE_LAYOUT_STORAGE_KEY)
    }
  } catch {
    // Layout persistence is best-effort; contribution visibility remains
    // controlled by the live registry and never trusts this value.
  }
}

function sameExtension(
  container: RegisteredContribution<'views.containers'>,
  view: ExtensionWorkbenchView
): boolean {
  return container.owner.kind === 'extension' &&
    view.owner.kind === 'extension' &&
    container.owner.extensionId === view.owner.extensionId
}

export function viewBelongsToContainer(
  container: RegisteredContribution<'views.containers'>,
  view: ExtensionWorkbenchView
): boolean {
  if (!sameExtension(container, view) || typeof view.payload.container !== 'string') return false
  return view.payload.container === container.payload.id || view.payload.container === container.id
}

export function firstViewForContainer(
  container: RegisteredContribution<'views.containers'>,
  groups: ExtensionWorkbenchViewGroups
): ExtensionWorkbenchView | undefined {
  const candidates = container.payload.location === 'leftSidebar'
    ? groups.leftSidebar
    : container.payload.location === 'rightSidebar'
      ? groups.rightSidebar
      : [
          ...groups.leftSidebar,
          ...groups.rightSidebar,
          ...groups.auxiliaryPanel,
          ...groups.editorTab,
          ...groups.fullPage
        ]
  return candidates.find((view) => viewBelongsToContainer(container, view))
}

export function firstRightRailEntryForContainer(
  container: ExtensionRightRailContainerEntry,
  views: readonly ExtensionRightRailViewEntry[]
): ExtensionRightRailViewEntry | undefined {
  if (container.owner.kind !== 'extension') return undefined
  const extensionId = container.owner.extensionId
  return views.find((view) => {
    if (view.owner.kind !== 'extension' || view.owner.extensionId !== extensionId) {
      return false
    }
    return view.payload.container === container.payload.id || view.payload.container === container.id
  })
}
