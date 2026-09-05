import { lazy, Suspense, useEffect } from 'react'
import { appWindowTitleForFlavor } from '@shared/app-environment'
import { MAX_APP_BADGE_COUNT } from '@shared/kun-gui-api'
import { resolveDesktopTitleBarMode } from '@shared/desktop-title-bar'
import { installSidebarActivityLifecycle } from './sidebar-activity-lifecycle'
import { useChatStore } from './store/chat-store'
import { supportsDesktopTitleBar, WindowsTitleBar } from './components/WindowsTitleBar'
import { MiniWindowOverlay } from './components/MiniWindowOverlay'
import { useWindowMiniMode } from './lib/use-window-mini-mode'
import { RuntimeStatusBanner } from './components/RuntimeStatusBanner'
import i18n from './i18n'
import { ExtensionWorkbenchLifecycle } from './extensions/ExtensionWorkbenchLifecycle'
import { ProtectedRendererSurface } from './extensions/ProtectedRendererSurface'
import { ExtensionSettingsServiceProvider } from './extensions/ExtensionSettingsServiceContext'
import { RuntimeExtensionSettingsService } from './extensions/runtime-extension-settings-service'
import { createInitialWorkbenchPreparer } from './initial-workbench-preparation'
import { DataMigrationActivityIndicator } from './components/DataMigrationActivityIndicator'
import {
  clearCurrentlyVisibleUnreadCompletions,
  persistUnreadCompletions,
  unreadCompletionCount
} from './store/unread-completions'

const extensionSettingsService = new RuntimeExtensionSettingsService()

type WorkbenchComponent = (typeof import('./components/Workbench'))['Workbench']
type SettingsViewComponent = (typeof import('./components/SettingsView'))['SettingsView']
type InitialSetupDialogComponent = (
  typeof import('./components/InitialSetupDialog')
)['InitialSetupDialog']

let preparedWorkbench: WorkbenchComponent | null = null
let preparedSettingsView: SettingsViewComponent | null = null
let preparedInitialSetupDialog: InitialSetupDialogComponent | null = null

const loadWorkbench = () =>
  import('./components/Workbench').then((module) => {
    preparedWorkbench = module.Workbench
    return { default: module.Workbench }
  })
const loadSettingsView = () =>
  import('./components/SettingsView').then((module) => {
    preparedSettingsView = module.SettingsView
    return { default: module.SettingsView }
  })
const loadInitialSetupDialog = () => import('./components/InitialSetupDialog').then((module) => {
  preparedInitialSetupDialog = module.InitialSetupDialog
  return { default: module.InitialSetupDialog }
})

const Workbench = lazy(loadWorkbench)
const SettingsView = lazy(loadSettingsView)
const InitialSetupDialog = lazy(loadInitialSetupDialog)

export const prepareInitialWorkbench = createInitialWorkbenchPreparer({
  boot: () => useChatStore.getState().boot(),
  getSnapshot: () => useChatStore.getState(),
  loadWorkbench,
  loadSettingsView,
  loadInitialSetupDialog
})

function RouteFallback(): React.ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-full min-h-0 items-center justify-center bg-ds-main text-ds-muted"
    >
      <div className="flex items-center gap-2 rounded-full border border-ds-border-muted bg-ds-card px-4 py-2 text-[13px] shadow-sm">
        <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden />
        <span>{i18n.t('loading')}</span>
      </div>
    </div>
  )
}

export default function AppShell(): React.ReactElement {
  const route = useChatStore((s) => s.route)
  const initialSetupOpen = useChatStore((s) => s.initialSetupOpen)
  const platform = typeof window !== 'undefined' ? window.kunGui?.platform ?? 'unknown' : 'unknown'
  const appEnvironment = typeof window !== 'undefined' ? window.kunGui?.appEnvironment : undefined
  const desktopTitleBarMode = typeof window !== 'undefined'
    ? window.kunGui?.desktopTitleBarMode ?? resolveDesktopTitleBarMode(platform, false)
    : resolveDesktopTitleBarMode(platform, false)
  const hasDesktopTitleBar = supportsDesktopTitleBar(platform, desktopTitleBarMode)
  const miniWindowMode = useWindowMiniMode()
  const WorkbenchView = preparedWorkbench ?? Workbench
  const SettingsRouteView = preparedSettingsView ?? SettingsView
  const InitialSetupView = preparedInitialSetupDialog ?? InitialSetupDialog

  useEffect(() => installSidebarActivityLifecycle(useChatStore), [])

  useEffect(() => {
    let previousUnread = useChatStore.getState().unreadThreadIds
    const syncBadge = (unread: typeof previousUnread): void => {
      const normalized = persistUnreadCompletions(unread)
      const count = Math.min(unreadCompletionCount(normalized), MAX_APP_BADGE_COUNT)
      if (typeof window.kunGui?.setAppBadgeCount !== 'function') return
      void window.kunGui.setAppBadgeCount(count).catch((error: unknown) => {
        void window.kunGui?.logError?.('app-badge', 'Failed to update unread completion badge', {
          message: error instanceof Error ? error.message : String(error),
          count
        }).catch(() => undefined)
      })
    }
    const clearVisible = (): void => {
      const state = useChatStore.getState()
      const unreadThreadIds = clearCurrentlyVisibleUnreadCompletions(state.unreadThreadIds, state)
      if (unreadThreadIds !== state.unreadThreadIds) useChatStore.setState({ unreadThreadIds })
    }
    const onAttentionChanged = (): void => clearVisible()
    const unsubscribe = useChatStore.subscribe((state) => {
      const visibleCleared = clearCurrentlyVisibleUnreadCompletions(state.unreadThreadIds, state)
      if (visibleCleared !== state.unreadThreadIds) {
        useChatStore.setState({ unreadThreadIds: visibleCleared })
        return
      }
      if (state.unreadThreadIds === previousUnread) return
      previousUnread = state.unreadThreadIds
      syncBadge(previousUnread)
    })

    clearVisible()
    previousUnread = useChatStore.getState().unreadThreadIds
    syncBadge(previousUnread)
    window.addEventListener('focus', onAttentionChanged)
    window.addEventListener('blur', onAttentionChanged)
    document.addEventListener('visibilitychange', onAttentionChanged)
    return () => {
      unsubscribe()
      window.removeEventListener('focus', onAttentionChanged)
      window.removeEventListener('blur', onAttentionChanged)
      document.removeEventListener('visibilitychange', onAttentionChanged)
    }
  }, [])

  useEffect(() => {
    if (!appEnvironment?.flavor || typeof document === 'undefined') return
    document.title = appWindowTitleForFlavor(appEnvironment.flavor)
  }, [appEnvironment?.flavor])

  return (
    <ExtensionSettingsServiceProvider service={extensionSettingsService}>
      <div className={hasDesktopTitleBar ? 'ds-windows-app-frame flex h-full min-h-0 flex-col bg-ds-main' : 'flex h-full min-h-0 flex-col bg-transparent'}>
        {hasDesktopTitleBar ? <WindowsTitleBar platform={platform} /> : null}
        <div className="flex min-h-0 flex-1 flex-col">
          <RuntimeStatusBanner />
          <DataMigrationActivityIndicator />
          <Suspense fallback={<RouteFallback />}>
            {route === 'settings' ? (
              <ProtectedRendererSurface
                kind="account-credentials"
                restoreTarget="settings"
                fallback={<RouteFallback />}
              >
                <SettingsRouteView />
              </ProtectedRendererSurface>
            ) : <WorkbenchView />}
          </Suspense>
        </div>
        {miniWindowMode ? <MiniWindowOverlay /> : null}
        <ExtensionWorkbenchLifecycle />
        {initialSetupOpen ? (
          <ProtectedRendererSurface
            kind="account-credentials"
            restoreTarget="initial-setup"
            fallback={null}
          >
            <Suspense fallback={null}>
              <InitialSetupView />
            </Suspense>
          </ProtectedRendererSurface>
        ) : null}
      </div>
    </ExtensionSettingsServiceProvider>
  )
}
