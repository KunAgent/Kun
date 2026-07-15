import { lazy, Suspense, useEffect } from 'react'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { installIssue781DocumentUsability } from './lib/issue-781-document-usability'
import { renderExtensionPanels, extensionRoutes } from './seam/index.js' // EXT-SEAM

const AppShell = lazy(() => import('./AppShell'))

function DocumentUsabilityLifecycle(): null {
  useEffect(() => installIssue781DocumentUsability(), [])
  return null
}

function StartupShell(): React.ReactElement {
  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-ds-main text-ds-muted">
      <div className="flex items-center gap-2 rounded-full border border-ds-border-muted bg-ds-card px-4 py-2 text-[13px] shadow-sm">
        <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden />
        <span>Loading Kun...</span>
      </div>
    </div>
  )
}

export default function App(): React.ReactElement {
  // EXT-SEAM: Extension panels and routes
  const extPanels = renderExtensionPanels()
  const extRoutes = extensionRoutes()

  return (
    <AppErrorBoundary>
      <DocumentUsabilityLifecycle />
      <Suspense fallback={<StartupShell />}>
        <AppShell />
        {/* EXT-SEAM: Render extension panels (Stage 0: empty, Stage 1+: will render expert panels) */}
        {extPanels}
      </Suspense>
    </AppErrorBoundary>
  )
}
