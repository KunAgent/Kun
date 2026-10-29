import { useProductAnalyticsLifecycle } from './product-analytics/lifecycle'
import { lazy, Suspense, useEffect } from 'react'
import { useQuotaReminderNotifications } from './hooks/useQuotaReminderNotifications'
import { appWindowTitleForFlavor } from '@shared/app-environment'
import { resolveDesktopTitleBarMode, usesCustomDesktopTitleBar } from '@shared/desktop-title-bar'
import { installSidebarActivityLifecycle } from './sidebar-activity-lifecycle'
import { useChatStore } from './store/chat-store'
import { startBackgroundThreadSync } from './store/chat-background-sync'
import { RuntimeStatusToast } from './components/RuntimeStatusToast'
import { ToastDock } from './toast/ToastDock'
import i18n from './i18n'
import { ProtectedRendererSurface } from './extensions/ProtectedRendererSurface'
import { ExtensionSettingsServiceProvider } from './extensions/ExtensionSettingsServiceContext'
import { RuntimeExtensionSettingsService } from './extensions/runtime-extension-settings-service'
import { createInitialWorkbenchPreparer } from './initial-workbench-preparation'
import { DataMigrationActivityIndicator } from './components/DataMigrationActivityIndicator'
import { SpeakDownloadToast } from './components/SpeakDownloadToast'
import { WhatsNewHost } from './components/whats-new/WhatsNewHost'
import { AgentActivityToasts } from './components/ade/AgentActivityToasts'
import { MobilePairingDialog } from './components/remote/MobilePairingDialog'
import { useRoomEvents } from './components/rooms/useRoomEvents'
import { useWorkbenchDirectorySync } from './components/rooms/workbench-bridge-actions'
import { WorkbenchFlash } from './components/rooms/workbench-flash'
import { useRemoteSurface } from './mobile/use-remote-surface'
import { useRemoteReconnectRecovery } from './use-remote-reconnect-recovery'
import { clearCurrentlyVisibleUnreadCompletions } from './store/unread-completions'
import { startActivityFeed, stopActivityFeed, useActivityStore } from './store/activity-store'
import {
  startActivityNotifications,
  stopActivityNotifications
} from './store/activity-notifications'
import { appBadgeInputFromChatState, syncAppBadgeCount } from './store/app-badge'
import { useAdeEnabled } from './components/ade/use-ade-enabled'
import { KunLoader } from './components/KunLoader'

const extensionSettingsService = new RuntimeExtensionSettingsService()

const GuidedTourHost = lazy(() => import('./components/guided-tour/GuidedTourHost').then((module) => ({ default: module.GuidedTourHost })))
const DesktopShellChrome = lazy(() => import('./DesktopShellChrome').then((module) => ({ default: module.DesktopShellChrome })))

type WorkbenchComponent = (typeof import('./components/Workbench'))['Workbench']
type SettingsViewComponent = (typeof import('./components/SettingsView'))['SettingsView']
type InitialSetupDialogComponent = (
  typeof import('./components/InitialSetupDialog')
)['InitialSetupDialog']
type MobileAppShellComponent = (typeof import('./mobile/MobileAppShell'))['MobileAppShell']

let preparedWorkbench: WorkbenchComponent | null = null
let preparedSettingsView: SettingsViewComponent | null = null
let preparedInitialSetupDialog: InitialSetupDialogComponent | null = null
let preparedMobileAppShell: MobileAppShellComponent | null = null

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

const loadMobileAppShell = () => import('./mobile/MobileAppShell').then((module) => {
  preparedMobileAppShell = module.MobileAppShell
  return { default: module.MobileAppShell }
})

const Workbench = lazy(loadWorkbench)
const SettingsView = lazy(loadSettingsView)
const InitialSetupDialog = lazy(loadInitialSetupDialog)
const MobileAppShell = lazy(loadMobileAppShell)

export const prepareInitialWorkbench = createInitialWorkbenchPreparer({
  boot: () => useChatStore.getState().boot(),
  getSnapshot: () => useChatStore.getState(),
  loadWorkbench,
  loadSettingsView,
  loadInitialSetupDialog
})

export async function prepareInitialMobileApp(): Promise<void> {
  await useChatStore.getState().boot()
  await Promise.all([
    loadMobileAppShell(),
    useChatStore.getState().route === 'settings' ? loadSettingsView() : Promise.resolve()
  ])
}

function RouteFallback(): React.ReactElement {
  return <KunLoader fill label={i18n.t('loading')} />
}

export default function AppShell(): React.ReactElement {
  useProductAnalyticsLifecycle()
  useRoomEvents()
  useRemoteReconnectRecovery()
  const route = useChatStore((s) => s.route)
  const surface = useRemoteSurface()
  useQuotaReminderNotifications(surface === 'desktop')
  // Only the desktop knows the user's real workspaces; a phone must never overwrite them.
  useWorkbenchDirectorySync(surface === 'desktop')
  const { enabled: adeEnabled } = useAdeEnabled()
  const initialSetupOpen = useChatStore((s) => s.initialSetupOpen)
  const platform = typeof window !== 'undefined' ? window.kunGui?.platform ?? 'unknown' : 'unknown'
  const appEnvironment = typeof window !== 'undefined' ? window.kunGui?.appEnvironment : undefined
  const desktopTitleBarMode = typeof window !== 'undefined'
    ? window.kunGui?.desktopTitleBarMode ?? resolveDesktopTitleBarMode(platform, false)
    : resolveDesktopTitleBarMode(platform, false)
  const hasDesktopTitleBar = surface === 'desktop' && usesCustomDesktopTitleBar(platform, desktopTitleBarMode)
  const WorkbenchView = preparedWorkbench ?? Workbench
  const SettingsRouteView = preparedSettingsView ?? SettingsView
  const InitialSetupView = preparedInitialSetupDialog ?? InitialSetupDialog
  const MobileApp = preparedMobileAppShell ?? MobileAppShell

  useEffect(() => installSidebarActivityLifecycle(useChatStore), [])
  useEffect(() => startBackgroundThreadSync(), [])

  // The ADE activity feed is app-level: while the lab flag is on it
  // stays live across routes so worker completions and waits still notify —
  // and badge counts stay fresh — after the user leaves the ADE view. The
  // Mission Control popout owns its own window's feed; the mobile surface
  // runs the same feed but keeps local notifications desktop-only.
  useEffect(() => {
    if (!adeEnabled) return
    startActivityFeed()
    if (surface === 'desktop') startActivityNotifications()
    return () => {
      stopActivityFeed()
      stopActivityNotifications()
    }
  }, [adeEnabled, surface])

  useEffect(() => {
    // Streaming updates touch unrelated state many times a second; only the
    // inputs that can change the attention list are worth a recompute.
    let lastInputs: unknown[] = []
    const syncBadge = (): void => {
      const state = useChatStore.getState()
      const rows = useActivityStore.getState().rows
      const inputs = [state.threads, state.unreadThreadIds, state.awaitingUserInputThreadIds,
        state.watchTurnCompletion, state.scheduledThreadActivities, state.activeThreadId, state.busy, rows]
      if (inputs.length === lastInputs.length && inputs.every((value, index) => value === lastInputs[index])) return
      lastInputs = inputs
      // Dock badge = the same "needs you" list the sidebar panel renders.
      syncAppBadgeCount(appBadgeInputFromChatState(state, rows))
    }
    const clearVisible = (): void => {
      const state = useChatStore.getState()
      const unreadThreadIds = clearCurrentlyVisibleUnreadCompletions(state.unreadThreadIds, state)
      if (unreadThreadIds !== state.unreadThreadIds) useChatStore.setState({ unreadThreadIds })
    }
    const onAttentionChanged = (): void => clearVisible()
    // Threads, archive flags, pending inputs and background work can all change
    // the list without touching the unread registry, so recompute on any store
    // change; the badge itself skips duplicate writes.
    const unsubscribe = useChatStore.subscribe((state) => {
      const visibleCleared = clearCurrentlyVisibleUnreadCompletions(state.unreadThreadIds, state)
      if (visibleCleared !== state.unreadThreadIds) {
        useChatStore.setState({ unreadThreadIds: visibleCleared })
        return
      }
      syncBadge()
    })
    const unsubscribeActivity = useActivityStore.subscribe(
      (state, prevState) => {
        if (state.rows === prevState.rows) return
        syncBadge()
      }
    )

    clearVisible()
    syncBadge()
    window.addEventListener('focus', onAttentionChanged)
    window.addEventListener('blur', onAttentionChanged)
    document.addEventListener('visibilitychange', onAttentionChanged)
    return () => {
      unsubscribe()
      unsubscribeActivity()
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
        {surface === 'desktop' ? <Suspense fallback={hasDesktopTitleBar
          ? <div className="ds-windows-titlebar" aria-hidden />
          : null}>
          <DesktopShellChrome platform={platform} titleBar={hasDesktopTitleBar} />
        </Suspense> : null}
        <div className="flex min-h-0 flex-1 flex-col">
          <DataMigrationActivityIndicator />
          <Suspense fallback={<RouteFallback />}>
            {route === 'settings' && surface !== 'mobile' ? (
              <ProtectedRendererSurface
                kind="account-credentials"
                restoreTarget="settings"
                fallback={<RouteFallback />}
              >
                <SettingsRouteView />
              </ProtectedRendererSurface>
            ) : surface === 'mobile' ? <MobileApp /> : <WorkbenchView />}
          </Suspense>
        </div>
        <ToastDock />
        <RuntimeStatusToast />
        <SpeakDownloadToast />
        {surface === 'desktop' ? <AgentActivityToasts /> : null}
        {surface === 'desktop' && !window.kunGui?.isRemoteWeb ? <MobilePairingDialog /> : null}
        {surface === 'desktop' ? <WhatsNewHost /> : null}
        {surface === 'desktop' && !initialSetupOpen ? <Suspense fallback={null}><GuidedTourHost /></Suspense> : null}
        <WorkbenchFlash />
        {initialSetupOpen ? (
          surface === 'mobile' ? (
            <div className="kun-mobile-setup-hint" role="alertdialog" aria-modal="true">
              <div className="kun-mobile-setup-hint-card">
                <h2>{i18n.t('mobileSetupRequiredTitle')}</h2>
                <p>{i18n.t('mobileSetupRequiredBody')}</p>
                <button
                  type="button"
                  className="kun-mobile-button"
                  onClick={() => useChatStore.getState().closeInitialSetup()}
                >
                  {i18n.t('mobileSetupRequiredDismiss')}
                </button>
              </div>
            </div>
          ) : (
            <ProtectedRendererSurface
              kind="account-credentials"
              restoreTarget="initial-setup"
              fallback={null}
            >
              <Suspense fallback={null}>
                <InitialSetupView />
              </Suspense>
            </ProtectedRendererSurface>
          )
        ) : null}
      </div>
    </ExtensionSettingsServiceProvider>
  )
}
