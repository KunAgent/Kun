import { lazy, Suspense, useEffect } from 'react'
import { useChatStore } from './store/chat-store'

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
  return <div className="h-full bg-ds-main" />
}

export default function AppShell(): React.ReactElement {
  const route = useChatStore((s) => s.route)
  const boot = useChatStore((s) => s.boot)
  const initialSetupOpen = useChatStore((s) => s.initialSetupOpen)

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
    <div className="h-full min-h-0 bg-transparent">
      <Suspense fallback={<RouteFallback />}>
        {route === 'settings' ? <SettingsView /> : <Workbench />}
      </Suspense>
      {initialSetupOpen ? (
        <Suspense fallback={null}>
          <InitialSetupDialog />
        </Suspense>
      ) : null}
    </div>
  )
}
