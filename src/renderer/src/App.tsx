import { lazy, Suspense, useEffect } from 'react'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { KunLoader } from './components/KunLoader'
import { installIssue781DocumentUsability } from './lib/issue-781-document-usability'
import { subscribeModelConnectionWatch } from './lib/model-connection-watch'
import { useChatStore } from './store/chat-store'
import { normalizeWorkspaceRoot } from './lib/workspace-path'
import { ensureCodexReferenceWatcher } from './history-reference/codex-reference-watcher'
import { currentRemoteSurface } from './mobile/use-remote-surface'

type AppShellModule = typeof import('./AppShell')
let preparedAppShell: AppShellModule['default'] | null = null
const loadAppShellModule = (): Promise<AppShellModule> => import('./AppShell').then((module) => {
  preparedAppShell = module.default
  return module
})
const LazyAppShell = lazy(loadAppShellModule)

export async function prepareWorkbenchApp(): Promise<void> {
  const appShell = await loadAppShellModule()
  if (currentRemoteSurface() === 'mobile') await appShell.prepareInitialMobileApp()
  else await appShell.prepareInitialWorkbench()
}

function DocumentUsabilityLifecycle(): null {
  useEffect(() => { ensureCodexReferenceWatcher() }, [])
  useEffect(() => installIssue781DocumentUsability(), [])
  return null
}

function SharedModelConnectionsLifecycle(): null {
  useEffect(() => {
    let disposed = false
    let modelCatalogLoaded = false
    let lastAppliedRevision = 0
    const stop = subscribeModelConnectionWatch(async (snapshot) => {
      if (disposed) return
      const changed = !modelCatalogLoaded || snapshot.revision > lastAppliedRevision
      if (!changed) return
      const state = useChatStore.getState()
      await state.loadComposerModels()
      if (disposed) return
      const current = useChatStore.getState()
      const currentWorkspace = normalizeWorkspaceRoot(current.workspaceRoot)
      if (!current.activeThreadId && (
        (Boolean(current.composerHarnessId) && current.composerHarnessId !== 'kun') ||
        (currentWorkspace && ((current.composerProjectDefaults?.workspaceRoot === currentWorkspace &&
          Boolean(current.composerProjectDefaults.value.route)) ||
        current.composerRouteExplicitWorkspaceRoot === currentWorkspace))
      )) {
        lastAppliedRevision = snapshot.revision
        modelCatalogLoaded = true
        return
      }
      if (
        !useChatStore.getState().activeThreadId &&
        typeof snapshot.defaultProviderId === 'string' &&
        typeof snapshot.defaultModel === 'string' &&
        snapshot.defaultProviderId.trim() &&
        snapshot.defaultModel.trim()
      ) {
        const latest = useChatStore.getState()
        const model = snapshot.defaultModel.trim()
        const providerId = snapshot.defaultProviderId.trim()
        if (latest.composerModel !== model || latest.composerProviderId !== providerId) {
          latest.setComposerModel(model, providerId, 'settings')
        }
      } else if (
        !useChatStore.getState().activeThreadId &&
        (
          typeof snapshot.defaultProviderId !== 'string' ||
          !snapshot.defaultProviderId.trim() ||
          typeof snapshot.defaultModel !== 'string' ||
          !snapshot.defaultModel.trim()
        )
      ) {
        const latest = useChatStore.getState()
        if (latest.composerModel || latest.composerProviderId) {
          latest.setComposerModel('', '', 'settings')
        }
      }
      lastAppliedRevision = snapshot.revision
      modelCatalogLoaded = true
    })
    return () => {
      disposed = true
      stop()
    }
  }, [])
  return null
}

function StartupShell(): React.ReactElement {
  return <KunLoader fill label="Loading Kun..." />
}

export default function App(): React.ReactElement {
  const AppShell = preparedAppShell ?? LazyAppShell
  return (
    <AppErrorBoundary>
      <DocumentUsabilityLifecycle />
      <SharedModelConnectionsLifecycle />
      <Suspense fallback={<StartupShell />}>
        <AppShell />
      </Suspense>
    </AppErrorBoundary>
  )
}
