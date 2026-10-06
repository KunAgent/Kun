import { useEffect, useState } from 'react'
import { normalizeWorkspaceRoot } from '../../lib/workspace-path'
import { ADE_PROJECT_DEFAULTS_REFRESH_EVENT } from '../../lib/ade-project-defaults-refresh'
import { composerReasoningEffortForSelection, isNativeAgentRoute } from '../../store/chat-store-helpers'
import { useChatStore } from '../../store/chat-store'
import type { ChatState } from '../../store/chat-store-types'
import type { AdeProjectDefaultsSnapshot } from '@shared/ade-project-defaults'
import type { AppSettingsV1 } from '@shared/app-settings'
import { getKunRuntimeSettings } from '@shared/app-settings-kun-defaults'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { useHarnessStore } from '../../store/harness-store'
import { SETTINGS_CHANGED_EVENT } from '../../lib/keyboard-shortcut-settings'
import { resolveCodeDefaultAgentRoute, type CodeDefaultAgentSettings } from './code-default-agent-route'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import i18n from '../../i18n'

export function codeProjectDefaultsPatch(
  state: ChatState,
  snapshot: AdeProjectDefaultsSnapshot,
  projectPath: string,
  defaults?: { settings: CodeDefaultAgentSettings; rows: AdeHarnessRow[]; catalogLoaded: boolean }
): Partial<ChatState> {
  if (state.activeThreadId || normalizeWorkspaceRoot(state.workspaceRoot) !== projectPath) return {}
  const route = snapshot.value.route
  const userSelectedRoute = state.composerRouteExplicitWorkspaceRoot === projectPath
  const collaboration = state.composerProjectCollaborationExplicitWorkspaceRoot === projectPath
    ? state.composerCollaborationEnabled === true : snapshot.value.collaborationEnabled === true
  const defaultResult = defaults && !route && !userSelectedRoute ? resolveCodeDefaultAgentRoute({
    ...defaults, groups: state.composerModelGroups, currentModel: state.composerModel,
    currentProviderId: state.composerProviderId, collaboration
  }) : undefined
  // An initial or failed catalog lookup is not evidence that saved providers
  // disappeared. Keep the draft selection until a completed catalog can decide.
  const waitingForCatalog = defaultResult?.error === 'provider' && state.composerModelCatalogStatus !== 'ready'
  const resolved = waitingForCatalog ? undefined : defaultResult
  const waitingMessage = waitingForCatalog ? i18n.t(state.composerModelCatalogStatus === 'error'
    ? 'common:composerModelsUnavailableHint' : 'common:composerModelsLoading') : undefined
  const routeError = resolved?.error ? i18n.t('common:codeDefaultAgentUnavailable', {
    agent: defaults?.rows.find((row) => row.definition.id === resolved.route.harnessId)?.definition.displayName
      ?? resolved.route.harnessId,
    reason: i18n.t(`common:codeDefaultAgentReason.${resolved.error}`)
  }) : undefined
  const previousError = state.composerProjectDefaults?.routeError
  return {
    ...(state.composerIsolationExplicitWorkspaceRoot !== projectPath ? {
      composerIsolation: snapshot.value.isolation === 'worktree' ? 'worktree' as const : 'local' as const,
      composerWorktreeStartFrom: snapshot.value.isolation === 'worktree'
        ? { kind: 'default-branch' as const } : undefined
    } : {}),
    composerProjectDefaults: {
      workspaceRoot: projectPath,
      revision: snapshot.revision,
      value: snapshot.value,
      ...(routeError || waitingMessage ? { routeError: routeError ?? waitingMessage } : {})
    },
    ...(routeError ? { error: routeError } : previousError && state.error === previousError ? { error: null } : {}),
    ...(waitingForCatalog && defaultResult ? {
      composerHarnessId: defaultResult.route.harnessId,
      composerCredentialMode: defaultResult.route.credentialMode
    } : {}),
    ...(resolved ? {
      composerHarnessId: resolved.route.harnessId,
      composerCredentialMode: resolved.route.credentialMode,
      composerModel: resolved.route.model,
      composerProviderId: resolved.route.providerId,
      composerReasoningEffort: composerReasoningEffortForSelection(
        state.composerModelGroups, resolved.route.model, resolved.route.providerId,
        { nativeAgent: isNativeAgentRoute(resolved.route.harnessId, resolved.route.credentialMode) }
      )
    } : {}),
    ...(route && !userSelectedRoute ? {
      composerHarnessId: route.harnessId,
      composerCredentialMode: route.credentialMode ?? '',
      composerModel: route.model,
      composerProviderId: route.providerId ?? '',
      composerReasoningEffort: composerReasoningEffortForSelection(
        state.composerModelGroups, route.model, route.providerId ?? '',
        { nativeAgent: isNativeAgentRoute(route.harnessId, route.credentialMode) }
      )
    } : {}),
    ...(snapshot.value.collaborationEnabled !== undefined &&
      state.composerProjectCollaborationExplicitWorkspaceRoot !== projectPath
      ? { composerCollaborationEnabled: snapshot.value.collaborationEnabled }
      : {}),
    ...(!resolved && snapshot.value.collaborationEnabled === true && !route && !userSelectedRoute
      ? { composerHarnessId: 'kun', composerCredentialMode: '' } : {})
  }
}

/** Apply a displayed project route to an unsent Code draft without overwriting user choices. */
export function useCodeProjectDefaults({
  enabled,
  activeThreadId,
  workspaceRoot
}: {
  enabled: boolean
  activeThreadId: string | null
  workspaceRoot: string
}): void {
  const selectedProjectRoot = useChatStore((state) => state.workspaceRoot)
  // The Code worktree pool may change the execution path without changing the
  // selected source project whose defaults the user is viewing.
  const projectPath = normalizeWorkspaceRoot(selectedProjectRoot || workspaceRoot)
  const draftRevision = useChatStore((state) => state.adeDraftRevision)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [settings, setSettings] = useState<CodeDefaultAgentSettings | null>(null)
  const rows = useHarnessStore((state) => state.rows)
  const catalogLoaded = useHarnessStore((state) => state.rowsLoadedAt !== undefined)
  const groups = useChatStore((state) => state.composerModelGroups)
  const modelCatalogStatus = useChatStore((state) => state.composerModelCatalogStatus)
  const draftCollaboration = useChatStore((state) => state.composerCollaborationEnabled)
  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || typeof window.kunGui?.getSettings !== 'function') return
    let cancelled = false
    let settingsChanged = false
    const apply = (value: AppSettingsV1): void => {
      if (!cancelled) setSettings(getKunRuntimeSettings(value))
    }
    void rendererRuntimeClient.getSettings().then((value) => {
      if (!settingsChanged) apply(value)
    }).catch(() => undefined)
    const changed = (event: Event): void => {
      const value = (event as CustomEvent<AppSettingsV1>).detail
      if (value) { settingsChanged = true; apply(value) }
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, changed)
    return () => { cancelled = true; window.removeEventListener(SETTINGS_CHANGED_EVENT, changed) }
  }, [enabled])
  useEffect(() => {
    if (typeof window === 'undefined') return
    const refresh = (event: Event): void => {
      const changedPath = (event as CustomEvent<string>).detail
      if (normalizeWorkspaceRoot(changedPath) === projectPath) setRefreshNonce((value) => value + 1)
    }
    window.addEventListener(ADE_PROJECT_DEFAULTS_REFRESH_EVENT, refresh)
    return () => window.removeEventListener(ADE_PROJECT_DEFAULTS_REFRESH_EVENT, refresh)
  }, [projectPath])
  useEffect(() => {
    if (!enabled || activeThreadId || !projectPath ||
      typeof window === 'undefined' ||
      typeof window.kunGui?.getAdeProjectDefaults !== 'function') return
    let cancelled = false
    void window.kunGui.getAdeProjectDefaults({ projectPath }).then((snapshot) => {
      if (cancelled) return
      useChatStore.setState((state) => state.adeDraftRevision !== draftRevision ? {}
        : codeProjectDefaultsPatch(state, snapshot, projectPath,
          settings ? { settings, rows, catalogLoaded } : undefined))
    }).catch(() => {
      // Older desktop/remote bridges retain the existing Code selection.
    })
    return () => { cancelled = true }
  }, [enabled, activeThreadId, projectPath, draftRevision, refreshNonce, settings, rows, catalogLoaded, groups, modelCatalogStatus, draftCollaboration])
}
