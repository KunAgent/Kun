import { lazy, Suspense, useEffect } from 'react'
import { useChatStore } from './store/chat-store'
import { supportsDesktopTitleBar, WindowsTitleBar } from './components/WindowsTitleBar'
import { RuntimeStatusBanner } from './components/RuntimeStatusBanner'
import i18n from './i18n'
import { ExtensionWorkbenchLifecycle } from './extensions/ExtensionWorkbenchLifecycle'
import { ProtectedRendererSurface } from './extensions/ProtectedRendererSurface'
import { ExtensionSettingsServiceProvider } from './extensions/ExtensionSettingsServiceContext'
import { RuntimeExtensionSettingsService } from './extensions/runtime-extension-settings-service'
import { DataMigrationActivityIndicator } from './components/DataMigrationActivityIndicator'

const extensionSettingsService = new RuntimeExtensionSettingsService()

const Workbench = lazy(() =>
  import('./components/Workbench').then((module) => ({ default: module.Workbench }))
)
const SettingsView = lazy(() =>
  import('./components/SettingsView').then((module) => ({ default: module.SettingsView }))
)
const InitialSetupDialog = lazy(() =>
  import('./components/InitialSetupDialog').then((module) => ({
    default: module.InitialSetupDialog
  }))
)

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
  const boot = useChatStore((s) => s.boot)
  const initialSetupOpen = useChatStore((s) => s.initialSetupOpen)
  const platform = typeof window !== 'undefined' ? window.kunGui?.platform ?? 'unknown' : 'unknown'
  const hasDesktopTitleBar = supportsDesktopTitleBar(platform)

  useEffect(() => {
    let frame = 0
    const timer = window.setTimeout(() => {
      frame = window.requestAnimationFrame(() => {
        void boot()
      })
    }, 0)
    return () => {
      window.clearTimeout(timer)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [boot])

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
                <SettingsView />
              </ProtectedRendererSurface>
            ) : <Workbench />}
          </Suspense>
        </div>
        <ExtensionWorkbenchLifecycle />
        {initialSetupOpen ? (
          <ProtectedRendererSurface
            kind="account-credentials"
            restoreTarget="initial-setup"
            fallback={null}
          >
            <Suspense fallback={null}>
              <InitialSetupDialog />
            </Suspense>
          </ProtectedRendererSurface>
        ) : null}
      </div>
    </ExtensionSettingsServiceProvider>
  )
}
