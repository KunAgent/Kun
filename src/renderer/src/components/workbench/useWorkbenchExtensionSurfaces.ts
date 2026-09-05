import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RightPanelMode } from '../chat/WorkbenchTopBar'
import { isExtensionContributionId, type RightPanelContributionId } from '../../extensions/contribution-ids'
import {
  isExtensionContributionSnapshotReady,
  refreshExtensionContributionSnapshot,
  useExtensionContributionLoadState,
  useExtensionRightRailViewEntries,
  useWorkbenchContributions,
  workbenchContextForRoute
} from '../../extensions/use-contributions'
import {
  sameExtensionContributionLoadContext,
  type ExtensionContributionLoadContext
} from '../../extensions/contribution-load-coordinator'
import {
  extensionWorkbenchClient,
  ExtensionWorkbenchClientError,
  type ExtensionManagementEntry,
  type ExtensionManagementVersion
} from '../../extensions/extension-workbench-client'
import {
  isExtensionWorkbenchView,
  readStoredExtensionSurfaceId,
  type ExtensionWorkbenchView,
  writeStoredExtensionSurfaceId
} from '../../extensions/ExtensionWorkbenchSurfaces'
import {
  workbenchContributionRegistry,
  type ExtensionRightRailViewEntry
} from '../../extensions/contribution-registry'
import { readBrowserStorageItem, removeBrowserStorageItem, writeBrowserStorageItem } from '../../lib/browser-storage'
import type { useWorkbenchChatStoreState } from './useWorkbenchChatStoreState'
import type { ComposerTaskSurface } from '../chat/FloatingComposerTaskSurfacePicker'
import { resolveCodeRightToolClick } from './useWorkbenchRightTools'

type WorkbenchState = ReturnType<typeof useWorkbenchChatStoreState>
const extensionSurfaceLayoutStorage = {
  getItem: readBrowserStorageItem,
  setItem: writeBrowserStorageItem,
  removeItem: removeBrowserStorageItem
}

function selectedExtensionVersion(entry: ExtensionManagementEntry): ExtensionManagementVersion | undefined {
  if (entry.useDevelopment) return entry.development
  return entry.versions.find((version) => version.version === entry.selectedVersion)
}

type Params = {
  t: (key: string, options?: Record<string, unknown>) => string
  language: string
  route: WorkbenchState['route']
  taskSurface: ComposerTaskSurface
  extensionWorkspaceRoot: string
  extensionContributionLoadContext: ExtensionContributionLoadContext
  extensionContributionLoadContextRef: { current: ExtensionContributionLoadContext }
  leftSidebarCollapsed: boolean
  rightPanelMode: RightPanelMode | null
  codeRightTabs: { tabs: RightPanelContributionId[] }
  setRoute: WorkbenchState['setRoute']
  setError: WorkbenchState['setError']
  setRightPanelMode: (mode: RightPanelMode | null) => void
  toggleLeftSidebar: () => void
  openRightPanelTab: (id: RightPanelContributionId) => void
  closeRightPanelTab: (id: RightPanelContributionId) => void
}

export function useWorkbenchExtensionSurfaces({
  t,
  language,
  route,
  taskSurface,
  extensionWorkspaceRoot,
  extensionContributionLoadContext,
  extensionContributionLoadContextRef,
  leftSidebarCollapsed,
  rightPanelMode,
  codeRightTabs,
  setRoute,
  setError,
  setRightPanelMode,
  toggleLeftSidebar,
  openRightPanelTab,
  closeRightPanelTab
}: Params) {
  const contributionContext = useMemo(
    () => workbenchContextForRoute(route, extensionWorkspaceRoot, {}, taskSurface),
    [extensionWorkspaceRoot, route, taskSurface]
  )
  const contributionLoadState = useExtensionContributionLoadState()
  const extensionContributionSnapshotReady = isExtensionContributionSnapshotReady(
    contributionLoadState,
    extensionWorkspaceRoot,
    language
  )
  const extensionLeftSidebarItems = useWorkbenchContributions(
    'views.leftSidebar', contributionContext, extensionContributionSnapshotReady
  ).filter((contribution) => contribution.owner.kind === 'extension')
  const extensionRightPanelItems = useWorkbenchContributions(
    'views.rightSidebar', contributionContext, extensionContributionSnapshotReady
  ).filter((contribution) => contribution.owner.kind === 'extension')
  const extensionRightRailItems = useExtensionRightRailViewEntries(
    contributionContext, extensionContributionSnapshotReady
  )
  const extensionAuxiliaryPanelItems = useWorkbenchContributions(
    'views.auxiliaryPanel', contributionContext, extensionContributionSnapshotReady
  ).filter((contribution) => contribution.owner.kind === 'extension')
  const extensionEditorTabItems = useWorkbenchContributions(
    'views.editorTab', contributionContext, extensionContributionSnapshotReady
  ).filter((contribution) => contribution.owner.kind === 'extension')
  const extensionFullPageItems = useWorkbenchContributions(
    'views.fullPage', contributionContext, extensionContributionSnapshotReady
  ).filter((contribution) => contribution.owner.kind === 'extension')
  const extensionTopBarActions = useWorkbenchContributions(
    'actions.topBar', contributionContext, extensionContributionSnapshotReady)
  const extensionComposerActions = useWorkbenchContributions(
    'actions.composer', contributionContext, extensionContributionSnapshotReady)
  const extensionMessageActions = useWorkbenchContributions(
    'actions.message', contributionContext, extensionContributionSnapshotReady)
  const extensionCommands = useWorkbenchContributions(
    'commands', contributionContext, extensionContributionSnapshotReady)
  const extensionHostContextMenus = useWorkbenchContributions(
    'contextMenus', contributionContext, extensionContributionSnapshotReady
  ).filter((contribution) => ['workspace', 'editor', 'view'].includes(contribution.payload.location))
  const extensionMessageContextMenus = useWorkbenchContributions(
    'contextMenus', contributionContext, extensionContributionSnapshotReady
  ).filter((contribution) => contribution.payload.location === 'message')
  const extensionAttachmentContextMenus = useWorkbenchContributions(
    'contextMenus', contributionContext, extensionContributionSnapshotReady
  ).filter((contribution) => contribution.payload.location === 'attachment')
  const extensionResultPreviews = useWorkbenchContributions(
    'message.resultPreviews', contributionContext, extensionContributionSnapshotReady
  )
  const messageContributionsForSurface = useCallback((surface: ComposerTaskSurface) => {
    if (!extensionContributionSnapshotReady) return null
    const context = workbenchContextForRoute(route, extensionWorkspaceRoot, {}, surface)
    return {
      actions: workbenchContributionRegistry.list('actions.message', context),
      contextMenus: workbenchContributionRegistry.list('contextMenus', context)
        .filter((item) => item.payload.location === 'message'),
      attachmentContextMenus: workbenchContributionRegistry.list('contextMenus', context)
        .filter((item) => item.payload.location === 'attachment'),
      resultPreviews: workbenchContributionRegistry.list('message.resultPreviews', context)
    }
  }, [extensionContributionSnapshotReady, extensionWorkspaceRoot, route])

  const [activeExtensionSurfaceId, setActiveExtensionSurfaceId] = useState<string | null>(() =>
    readStoredExtensionSurfaceId(extensionSurfaceLayoutStorage))
  const [workspaceContextMenu, setWorkspaceContextMenu] = useState<{
    position: { x: number; y: number }
    location: 'workspace' | 'editor' | 'view'
    contributionId?: string
  } | null>(null)
  const extensionAuthorizationInFlightRef = useRef<{
    extensionId: string
    context: ExtensionContributionLoadContext
  } | null>(null)

  const selectExtensionSurface = useCallback((contributionId: string | null): void => {
    setActiveExtensionSurfaceId(contributionId)
    writeStoredExtensionSurfaceId(extensionSurfaceLayoutStorage, contributionId)
  }, [])
  const extensionSurfaceItems = useMemo<ExtensionWorkbenchView[]>(() => [
    ...extensionLeftSidebarItems,
    ...extensionRightPanelItems,
    ...extensionAuxiliaryPanelItems,
    ...extensionEditorTabItems,
    ...extensionFullPageItems
  ], [
    extensionAuxiliaryPanelItems,
    extensionEditorTabItems,
    extensionFullPageItems,
    extensionLeftSidebarItems,
    extensionRightPanelItems
  ])
  const activeExtensionRightPanel = rightPanelMode && isExtensionContributionId(rightPanelMode)
    ? extensionRightPanelItems.find((contribution) => contribution.id === rightPanelMode)
    : undefined
  const activeExtensionSurface = activeExtensionSurfaceId
    ? extensionSurfaceItems.find((contribution) => contribution.id === activeExtensionSurfaceId)
    : undefined
  const activeExtensionLeftSidebar = activeExtensionSurface?.point === 'views.leftSidebar'
    ? activeExtensionSurface : undefined
  const activeExtensionAuxiliaryPanel = activeExtensionSurface?.point === 'views.auxiliaryPanel'
    ? activeExtensionSurface : undefined
  const activeExtensionCenterView = activeExtensionSurface?.point === 'views.editorTab' ||
    activeExtensionSurface?.point === 'views.fullPage' ? activeExtensionSurface : undefined

  const openExtensionSurface = useCallback((view: ExtensionWorkbenchView): void => {
    if (view.point === 'views.rightSidebar') {
      selectExtensionSurface(null)
      setRoute('chat')
      if (isExtensionContributionId(view.id)) openRightPanelTab(view.id)
      return
    }
    if (view.point === 'views.leftSidebar' && leftSidebarCollapsed) toggleLeftSidebar()
    setRightPanelMode(null)
    selectExtensionSurface(view.id)
  }, [leftSidebarCollapsed, openRightPanelTab, selectExtensionSurface, setRoute, setRightPanelMode, toggleLeftSidebar])

  /**
   * Returns whether the selection actually opened a View or started permission
   * review, so callers such as the command palette can report an unavailable
   * target instead of silently doing nothing.
   */
  const selectRightRailExtension = useCallback((entry: ExtensionRightRailViewEntry): boolean => {
    const runnable = workbenchContributionRegistry.get(entry.id, contributionContext)
    if (isExtensionWorkbenchView(runnable) && runnable.point === 'views.rightSidebar') {
      if (
        isExtensionContributionId(entry.id) &&
        resolveCodeRightToolClick(entry.id, rightPanelMode) === 'collapse'
      ) {
        setRightPanelMode(null)
      } else {
        openExtensionSurface(runnable)
      }
      return true
    }
    if (entry.owner.kind !== 'extension' || entry.workspaceTrusted || !extensionWorkspaceRoot) {
      return false
    }

    const extensionId = entry.owner.extensionId
    const loadContext = extensionContributionLoadContext
    const currentAuthorization = extensionAuthorizationInFlightRef.current
    if (currentAuthorization && sameExtensionContributionLoadContext(currentAuthorization.context, loadContext)) return true
    const authorization = { extensionId, context: loadContext }
    extensionAuthorizationInFlightRef.current = authorization
    const contextIsCurrent = (): boolean => sameExtensionContributionLoadContext(
      loadContext, extensionContributionLoadContextRef.current
    )
    void (async () => {
      try {
        const extensions = await extensionWorkbenchClient.listExtensions(loadContext.workspaceRoot, loadContext.locale)
        if (!contextIsCurrent()) return
        const extension = extensions.find((candidate) => candidate.id === extensionId)
        const selected = extension ? selectedExtensionVersion(extension) : undefined
        if (!selected) throw new Error(t('extensionRailVersionUnavailable'))
        await extensionWorkbenchClient.setPermissions(
          extensionId, selected.version, selected.grantedPermissions, loadContext.workspaceRoot
        )
        if (!contextIsCurrent()) return
        const outcome = await refreshExtensionContributionSnapshot(loadContext.workspaceRoot, loadContext.locale)
        if (outcome !== 'applied' || !contextIsCurrent()) return
        const authorized = workbenchContributionRegistry.get(entry.id, contributionContext)
        if (!isExtensionWorkbenchView(authorized) || authorized.point !== 'views.rightSidebar') {
          throw new Error(t('extensionRailRequiredPermissionsMissing'))
        }
        openExtensionSurface(authorized)
      } catch (error) {
        if (!contextIsCurrent()) return
        if (error instanceof ExtensionWorkbenchClientError && error.code === 'EXTENSION_CONSENT_DENIED') return
        setError(t('extensionRailAuthorizationFailed', {
          detail: error instanceof Error ? error.message : String(error)
        }))
      } finally {
        if (extensionAuthorizationInFlightRef.current === authorization) {
          extensionAuthorizationInFlightRef.current = null
        }
      }
    })()
    return true
  }, [
    contributionContext, extensionContributionLoadContext, extensionContributionLoadContextRef,
    extensionWorkspaceRoot, openExtensionSurface, rightPanelMode, setError, setRightPanelMode, t
  ])

  const openManagedExtensionView = useCallback(async (contributionId: string): Promise<void> => {
    let contribution = workbenchContributionRegistry.get(contributionId, contributionContext)
    if (!isExtensionWorkbenchView(contribution)) {
      const loadContext = extensionContributionLoadContext
      const outcome = await refreshExtensionContributionSnapshot(loadContext.workspaceRoot, loadContext.locale)
      if (outcome !== 'applied' || !sameExtensionContributionLoadContext(
        loadContext, extensionContributionLoadContextRef.current
      )) return
      contribution = workbenchContributionRegistry.get(contributionId, contributionContext)
    }
    if (!isExtensionWorkbenchView(contribution)) {
      const diagnostics = workbenchContributionRegistry.getDiagnostics().filter((diagnostic) =>
        diagnostic.contributionId === contributionId ||
        contributionId.startsWith(`extension:${diagnostic.extensionId ?? ''}/`)
      )
      const detail = diagnostics[0]?.message
      throw new Error(detail
        ? t('extensionViewOpenFailedDetail', { detail })
        : t('extensionViewOpenFailed'))
    }
    openExtensionSurface(contribution)
  }, [
    contributionContext, extensionContributionLoadContext, extensionContributionLoadContextRef,
    openExtensionSurface, t
  ])

  useEffect(() => {
    setActiveExtensionSurfaceId(readStoredExtensionSurfaceId(extensionSurfaceLayoutStorage))
  }, [extensionWorkspaceRoot])
  useEffect(() => {
    if (!extensionContributionSnapshotReady) return
    const availableIds = new Set(extensionRightPanelItems.map((contribution) => contribution.id))
    for (const id of codeRightTabs.tabs) {
      if (isExtensionContributionId(id) && !availableIds.has(id)) closeRightPanelTab(id)
    }
  }, [closeRightPanelTab, codeRightTabs.tabs, extensionContributionSnapshotReady, extensionRightPanelItems])
  useEffect(() => {
    if (extensionContributionSnapshotReady && activeExtensionSurfaceId && !activeExtensionSurface) {
      selectExtensionSurface(null)
    }
  }, [activeExtensionSurface, activeExtensionSurfaceId, extensionContributionSnapshotReady, selectExtensionSurface])

  return {
    activeExtensionAuxiliaryPanel, activeExtensionCenterView, activeExtensionLeftSidebar,
    activeExtensionRightPanel, activeExtensionSurface, contributionContext,
    extensionAttachmentContextMenus, extensionCommands, extensionComposerActions,
    extensionContributionSnapshotReady, extensionHostContextMenus, extensionLeftSidebarItems,
    extensionMessageActions, extensionMessageContextMenus, extensionResultPreviews,
    messageContributionsForSurface,
    extensionRightPanelItems, extensionRightRailItems, extensionTopBarActions,
    extensionSurfaceItems,
    openExtensionSurface, openManagedExtensionView, selectRightRailExtension,
    selectExtensionSurface,
    workspaceContextMenu, setWorkspaceContextMenu
  }
}
