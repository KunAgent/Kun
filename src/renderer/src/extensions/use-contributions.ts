import { useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from 'react'
import type { AppRoute } from '../store/chat-store-types'
import {
  workbenchContributionRegistry,
  type ExtensionRightRailContainerEntry,
  type ExtensionRightRailViewEntry,
  type RegisteredContribution,
  type WorkbenchContributionPoint
} from './contribution-registry'
import {
  workbenchContributionLoadCoordinator,
  type ExtensionContributionLoadContext
} from './contribution-load-coordinator'
import { extensionWorkbenchClient } from './extension-workbench-client'
import type { WorkbenchContext } from './when-expression'

export type ExtensionContributionLoadState =
  | { status: 'idle' }
  | { status: 'loading' | 'ready'; workspaceRoot: string; locale: string }
  | { status: 'error'; workspaceRoot: string; locale: string; message: string }

let contributionLoadState: ExtensionContributionLoadState = { status: 'idle' }
const contributionLoadListeners = new Set<() => void>()

function setContributionLoadState(next: ExtensionContributionLoadState): void {
  contributionLoadState = next
  for (const listener of contributionLoadListeners) listener()
}

export function useExtensionContributionLoadState(): ExtensionContributionLoadState {
  return useSyncExternalStore(
    (listener) => {
      contributionLoadListeners.add(listener)
      return () => contributionLoadListeners.delete(listener)
    },
    () => contributionLoadState,
    () => contributionLoadState
  )
}

/**
 * Keeps async Workbench guards pinned to the latest context React actually
 * committed. React may abandon a concurrent render, so assigning this ref
 * during render would leak a workspace/locale that never became visible.
 */
export function useCommittedExtensionContributionLoadContext(
  context: ExtensionContributionLoadContext
): RefObject<ExtensionContributionLoadContext> {
  const committedContextRef = useRef(context)
  useLayoutEffect(() => {
    committedContextRef.current = context
  }, [context])
  return committedContextRef
}

export async function refreshExtensionContributionSnapshot(
  workspaceRoot: string,
  locale?: string,
  options: { clear?: boolean; signal?: AbortSignal } = {}
): Promise<'applied' | 'superseded'> {
  if (options.signal?.aborted) return 'superseded'
  const loadContext = { workspaceRoot, locale: locale ?? '' }
  const token = workbenchContributionLoadCoordinator.begin(loadContext)
  if (!workbenchContributionLoadCoordinator.isCurrent(token)) return 'superseded'
  setContributionLoadState({ status: 'loading', workspaceRoot, locale: loadContext.locale })
  if (options.clear ?? false) {
    workbenchContributionRegistry.replaceExtensions({
      schemaVersion: 1,
      revision: 0,
      ...(workspaceRoot ? { workspaceRoot } : {}),
      extensions: []
    })
  }
  try {
    const snapshot = await extensionWorkbenchClient.loadContributions(
      workspaceRoot || undefined,
      locale
    )
    if (options.signal?.aborted || !workbenchContributionLoadCoordinator.isCurrent(token)) {
      return 'superseded'
    }
    workbenchContributionRegistry.replaceExtensions(snapshot)
    setContributionLoadState({ status: 'ready', workspaceRoot, locale: loadContext.locale })
    return 'applied'
  } catch (error) {
    if (options.signal?.aborted || !workbenchContributionLoadCoordinator.isCurrent(token)) {
      return 'superseded'
    }
    setContributionLoadState({
      status: 'error',
      workspaceRoot,
      locale: loadContext.locale,
      message: error instanceof Error ? error.message : String(error)
    })
    throw error
  }
}

export function isExtensionContributionSnapshotReady(
  state: ExtensionContributionLoadState,
  workspaceRoot: string,
  locale: string
): boolean {
  return state.status === 'ready' &&
    state.workspaceRoot === workspaceRoot &&
    state.locale === locale
}

export function workbenchContextForRoute(
  route: AppRoute,
  workspaceRoot: string,
  extra: WorkbenchContext = {}
): WorkbenchContext {
  return {
    workspaceOpen: Boolean(workspaceRoot),
    'workbench.mode': route === 'chat' ? 'code' : route,
    'workbench.code': route === 'chat',
    'workbench.design': route === 'design',
    'workbench.write': route === 'write',
    'workbench.connect': route === 'claw',
    'workbench.settings': route === 'settings',
    ...extra
  }
}

export function useExtensionContributionBootstrap(
  workspaceRoot: string,
  refreshKey?: unknown,
  locale?: string
): ExtensionContributionLoadState {
  const state = useExtensionContributionLoadState()

  useLayoutEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    workbenchContributionLoadCoordinator.updateContext({
      workspaceRoot,
      locale: locale ?? ''
    })
    const load = async (): Promise<void> => {
      try {
        if (cancelled) return
        await refreshExtensionContributionSnapshot(workspaceRoot, locale, {
          clear: true,
          signal: controller.signal
        })
      } catch {
        if (cancelled) return
        // Older runtimes do not expose the endpoint. Built-ins remain usable,
        // and a later runtime-ready/change event retries discovery.
      }
    }
    void load()
    const onChanged = (): void => void load()
    window.addEventListener('kun:extensions-changed', onChanged)
    return () => {
      cancelled = true
      controller.abort()
      window.removeEventListener('kun:extensions-changed', onChanged)
    }
  }, [locale, refreshKey, workspaceRoot])

  return state
}

export function useWorkbenchContributions<K extends WorkbenchContributionPoint>(
  point: K,
  context: WorkbenchContext,
  ready = true
): RegisteredContribution<K>[] {
  useSyncExternalStore(
    workbenchContributionRegistry.subscribe,
    workbenchContributionRegistry.getRevision,
    workbenchContributionRegistry.getRevision
  )
  return ready ? workbenchContributionRegistry.list(point, context) : []
}

export function useExtensionRightRailViewEntries(
  context: WorkbenchContext,
  ready = true
): ExtensionRightRailViewEntry[] {
  useSyncExternalStore(
    workbenchContributionRegistry.subscribe,
    workbenchContributionRegistry.getRevision,
    workbenchContributionRegistry.getRevision
  )
  return ready ? workbenchContributionRegistry.listRightRailViewEntries(context) : []
}

export function useExtensionRightRailContainerEntries(
  context: WorkbenchContext,
  ready = true
): ExtensionRightRailContainerEntry[] {
  useSyncExternalStore(
    workbenchContributionRegistry.subscribe,
    workbenchContributionRegistry.getRevision,
    workbenchContributionRegistry.getRevision
  )
  return ready ? workbenchContributionRegistry.listRightRailContainerEntries(context) : []
}
