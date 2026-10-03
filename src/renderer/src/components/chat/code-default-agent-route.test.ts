import { withHarnessReadiness } from '@shared/test-support/harness-readiness'
import { describe, expect, it } from 'vitest'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import { resolveCodeDefaultAgentRoute, type CodeDefaultAgentSettings } from './code-default-agent-route'
import { codeProjectDefaultsPatch } from './use-code-project-defaults'
import { useChatStore } from '../../store/chat-store'
import { captureCodeDraftComposer } from '../../store/chat-store-ade-send-snapshot'
import { codeDefaultRouteError } from '../../store/chat-store-code-default-route'

const codex = withHarnessReadiness({
  definition: { builtin: true, id: 'codex', displayName: 'Codex', transport: 'codex-app-server',
    credentialModes: ['native-login'], modelSource: 'probe', staticModels: [], permissionModes: [] },
  status: { harnessId: 'codex', checkedAt: '2026-09-30T00:00:00Z', installed: 'yes', ready: 'yes', login: 'signed-in' }
} as AdeHarnessRow)
const cursor = withHarnessReadiness({ ...codex, definition: { ...codex.definition, id: 'cursor', transport: 'cursor-sdk',
  credentialModes: ['provider'] } } as AdeHarnessRow)
const groups: ModelProviderModelGroup[] = [
  { providerId: 'deepseek', label: 'DeepSeek', kind: 'http', modelIds: ['deepseek-chat'] },
  { providerId: 'cursor-account', label: 'Cursor', kind: 'cursor-sdk', modelIds: ['auto'] }
]
const settings: CodeDefaultAgentSettings = {
  model: 'deepseek-chat', providerId: 'deepseek', harnesses: {
    defaultHarnessId: 'codex', disabledIds: [], defaults: {}, enabledProfiles: [...codex.enabledProfiles!, ...cursor.enabledProfiles!]
  }
}
const input = { settings, rows: [codex, cursor], catalogLoaded: true, groups,
  currentModel: 'deepseek-chat', currentProviderId: 'deepseek', collaboration: false }
const project = { project: { key: '/repo', sourcePath: '/repo', kind: 'git' as const },
  value: {}, revision: `ade-project-v1:${'a'.repeat(64)}` }
const base = () => ({ ...useChatStore.getState(), activeThreadId: null, route: 'chat' as const,
  workspaceRoot: '/repo', composerRouteExplicitWorkspaceRoot: '', composerCollaborationEnabled: false,
  composerProjectCollaborationExplicitWorkspaceRoot: '', composerModelGroups: groups,
  composerModelCatalogStatus: 'ready' as const,
  composerModel: 'deepseek-chat', composerProviderId: 'deepseek' })

describe('new Code default Agent route', () => {
  it('keeps a saved Kun selection while the initial model catalog is pending or failed', () => {
    const defaults = { ...input, settings: { ...settings, model: 'step-5-preview',
      providerId: 'stepfun-token-plan', harnesses: { ...settings.harnesses!, defaultHarnessId: 'kun' } } }
    for (const status of ['idle', 'loading', 'error'] as const) {
      const state = { ...base(), composerModelGroups: [], composerModelCatalogStatus: status,
        composerModel: 'step-5-preview', composerProviderId: 'stepfun-token-plan' }
      const patch = codeProjectDefaultsPatch(state, project, '/repo', defaults)
      expect(patch.composerModel).toBeUndefined()
      expect(patch.composerProviderId).toBeUndefined()
      expect(patch.error).toBeUndefined()
      expect(patch.composerProjectDefaults?.routeError).toBeTruthy()
      expect(patch.composerProjectDefaults?.routeError).not.toContain('Default Agent')
      expect(codeDefaultRouteError({ ...state, ...patch })).toBe(patch.composerProjectDefaults?.routeError)
      expect({ ...state, ...patch }).toMatchObject({ composerModel: 'step-5-preview',
        composerProviderId: 'stepfun-token-plan' })
    }
  })

  it('pins a provider-backed external default while loading, without silently sending through Kun', () => {
    const patch = codeProjectDefaultsPatch({ ...base(), composerModelGroups: [],
      composerModelCatalogStatus: 'loading' }, project, '/repo', { ...input, settings: {
        ...settings, harnesses: { ...settings.harnesses!, defaultHarnessId: 'cursor' }
      } })
    expect(patch).toMatchObject({ composerHarnessId: 'cursor', composerCredentialMode: 'provider' })
    expect(patch.error).toBeUndefined()
    expect(codeDefaultRouteError({ ...base(), ...patch })).toBeTruthy()
  })

  it('resolves a loaded catalog and still rejects a confirmed missing provider', () => {
    const defaults = { ...input, settings: { ...settings,
      harnesses: { ...settings.harnesses!, defaultHarnessId: 'kun' } } }
    const pending = { ...base(), composerModelGroups: [], composerModelCatalogStatus: 'loading' as const }
    const waiting = codeProjectDefaultsPatch(pending, project, '/repo', defaults)
    const ready = { ...pending, ...waiting, composerModelGroups: groups, composerModelCatalogStatus: 'ready' as const }
    expect(codeProjectDefaultsPatch(ready, project, '/repo', defaults)).toMatchObject({
      composerProviderId: 'deepseek', composerModel: 'deepseek-chat'
    })
    const missing = codeProjectDefaultsPatch({ ...ready, composerModelGroups: [] }, project, '/repo', defaults)
    expect(missing.composerProjectDefaults?.routeError).toBeTruthy()
    expect(codeDefaultRouteError({ ...ready, ...missing })).toBe(missing.error)
  })

  it('selects Codex native login and freezes the whole choice without carrying Kun credentials', () => {
    const patch = codeProjectDefaultsPatch(base(), project, '/repo', input)
    expect(patch).toMatchObject({ composerHarnessId: 'codex', composerCredentialMode: 'native-login',
      composerModel: '', composerProviderId: '' })
    expect(captureCodeDraftComposer({ ...base(), ...patch })).toMatchObject({
      composerHarnessId: 'codex', composerCredentialMode: 'native-login', composerProviderId: ''
    })
    const custom = resolveCodeDefaultAgentRoute({ ...input, settings: { ...settings,
      harnesses: { ...settings.harnesses!, defaults: { codex: { credentialMode: 'native-login', model: 'gpt-5' } } }
    } })
    expect(custom.route.model).toBe('gpt-5')
  })

  it('honors explicit picks, then project routes, and leaves open or replaced tasks untouched', () => {
    const explicit = codeProjectDefaultsPatch({ ...base(), composerRouteExplicitWorkspaceRoot: '/repo' }, project, '/repo', input)
    expect(explicit.composerHarnessId).toBeUndefined()
    const projectRoute = { harnessId: 'kun', model: 'project-model', providerId: 'deepseek', credentialMode: 'provider' as const }
    expect(codeProjectDefaultsPatch(base(), { ...project, value: { route: projectRoute } }, '/repo', input))
      .toMatchObject({ composerHarnessId: 'kun', composerModel: 'project-model' })
    expect(codeProjectDefaultsPatch({ ...base(), activeThreadId: 'existing' }, project, '/repo', input)).toEqual({})
    expect(codeProjectDefaultsPatch({ ...base(), workspaceRoot: '/other' }, project, '/repo', input)).toEqual({})
  })

  it('keeps collaboration on Kun and never enables it merely because a default Agent changed', () => {
    const state = { ...base(), composerCollaborationEnabled: true, composerProjectCollaborationExplicitWorkspaceRoot: '/repo' }
    expect(codeProjectDefaultsPatch(state, project, '/repo', input))
      .toMatchObject({ composerHarnessId: 'kun', composerProviderId: 'deepseek' })
    expect(codeProjectDefaultsPatch(base(), project, '/repo', input).composerCollaborationEnabled).toBeUndefined()
  })

  it('resolves the Cursor account instead of the unrelated default HTTP provider', () => {
    const result = resolveCodeDefaultAgentRoute({ ...input, settings: { ...settings,
      harnesses: { ...settings.harnesses!, defaultHarnessId: 'cursor' }
    } })
    expect(result).toEqual({ route: { harnessId: 'cursor', credentialMode: 'provider', model: 'auto', providerId: 'cursor-account' } })
  })

  it('keeps unavailable defaults visible and returns a blocking error instead of switching Agent', () => {
    for (const variant of [
      { ...input, catalogLoaded: false },
      { ...input, rows: [] },
      { ...input, settings: { ...settings, harnesses: { ...settings.harnesses!, disabledIds: ['codex'] } } },
      { ...input, settings: { ...settings, harnesses: { ...settings.harnesses!, defaults: { codex: { credentialMode: 'provider' as const } } } } }
    ]) {
      const patch = codeProjectDefaultsPatch(base(), project, '/repo', variant)
      expect(patch.composerHarnessId).toBe('codex')
      expect(patch.composerProjectDefaults?.routeError).toBeTruthy()
      expect(patch.error).toBe(patch.composerProjectDefaults?.routeError)
      expect(codeDefaultRouteError({ ...base(), ...patch })).toBe(patch.error)
      expect(codeDefaultRouteError({ ...base(), ...patch, composerRouteExplicitWorkspaceRoot: '/repo' })).toBeUndefined()
      expect(codeDefaultRouteError({ ...base(), ...patch, activeThreadId: 'old-thread' })).toBeUndefined()
    }
    const incompatible = resolveCodeDefaultAgentRoute({ ...input, settings: { ...settings,
      harnesses: { ...settings.harnesses!, defaultHarnessId: 'cursor', defaults: { cursor: { providerId: 'deepseek' } } }
    } })
    expect(incompatible.route.harnessId).toBe('cursor')
    expect(incompatible.error).toBe('provider')
  })
})
