import { lazy, Suspense, useEffect } from 'react'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { installIssue781DocumentUsability } from './lib/issue-781-document-usability'
import { useChatStore } from './store/chat-store'
import { KUN_MODEL_CONNECTIONS_PATH } from '@shared/kun-endpoints'

type AppShellModule = typeof import('./AppShell')
let preparedAppShell: AppShellModule['default'] | null = null
const loadAppShellModule = (): Promise<AppShellModule> => import('./AppShell').then((module) => {
  preparedAppShell = module.default
  return module
})
const LazyAppShell = lazy(loadAppShellModule)

export async function prepareWorkbenchApp(): Promise<void> {
  const appShell = await loadAppShellModule()
  await appShell.prepareInitialWorkbench()
}

function DocumentUsabilityLifecycle(): null {
  useEffect(() => installIssue781DocumentUsability(), [])
  return null
}

function SharedModelConnectionsLifecycle(): null {
  useEffect(() => {
    if (typeof window.kunGui?.runtimeRequest !== 'function') return
    let disposed = false
    let revision = 0
    let modelCatalogLoaded = false
    let timer: number | undefined
    const poll = async (): Promise<void> => {
      try {
        const previousRevision = revision
        const result = await window.kunGui.runtimeRequest(
          revision === 0
            ? KUN_MODEL_CONNECTIONS_PATH
            : `${KUN_MODEL_CONNECTIONS_PATH}/events?since_revision=${revision}&wait_ms=25000`,
          'GET'
        )
        if (!result.ok) throw new Error(`model connection sync failed (HTTP ${result.status})`)
        const parsed = JSON.parse(result.body) as {
          revision?: unknown
          snapshot?: { revision?: unknown; defaultProviderId?: unknown; defaultModel?: unknown }
        }
        const snapshot = (parsed.snapshot ?? parsed) as {
          revision?: unknown
          defaultProviderId?: unknown
          defaultModel?: unknown
        }
        if (!Number.isInteger(snapshot.revision)) throw new Error('invalid model connection revision')
        revision = Number(snapshot.revision)
        const changed = !modelCatalogLoaded || revision > previousRevision
        if (!disposed && changed) {
          const state = useChatStore.getState()
          await state.loadComposerModels()
          if (disposed) return
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
              latest.setComposerModel(model, providerId)
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
              latest.setComposerModel('', '')
            }
          }
          modelCatalogLoaded = true
        }
      } catch {
        // The runtime lifecycle has its own connection UI. Keep this watcher
        // quiet and retry so a crash/replacement or a transient catalog read
        // does not leave the composer permanently without configured models.
      } finally {
        if (!disposed) timer = window.setTimeout(poll, modelCatalogLoaded ? 0 : 2_000)
      }
    }
    void poll()
    return () => {
      disposed = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [])
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
