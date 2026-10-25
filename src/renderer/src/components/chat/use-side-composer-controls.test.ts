// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withHarnessReadiness } from '@shared/test-support/harness-readiness'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { SideComposerConfig } from '../../store/side-composer-config'
import { aliasCredentialGroupKey, credentialGroupKey } from '../../lib/ade-composer-harness'

const fixture = vi.hoisted(() => ({
  groups: [{ providerId: 'api', label: 'API', modelIds: ['kun-model'] }],
  rows: [] as AdeHarnessRow[],
  models: { codex: { models: ['native-model'], loading: false } },
  providers: { codex: { groups: [{ providerId: 'api', label: 'API', models: ['routed-model'] }], loading: false } },
  defaults: { codex: { credentialMode: 'native-login', permissionMode: 'full-access' } }
}))
vi.mock('../../store/chat-store', () => ({ useChatStore: (selector: Function) => selector({ composerModelGroups: fixture.groups }) }))
vi.mock('../../store/harness-store', async (load) => ({
  ...await load<typeof import('../../store/harness-store')>(),
  useHarnessStore: Object.assign((selector: Function) => selector({ rows: fixture.rows, rowsLoading: false,
    models: fixture.models, providerGroups: fixture.providers }), {
    getState: () => ({ models: fixture.models, providerGroups: fixture.providers })
  }),
  loadHarnesses: vi.fn(), loadHarnessModels: vi.fn(), loadHarnessProviderGroups: vi.fn()
}))
vi.mock('../../lib/harness-defaults', () => ({ useHarnessDefaults: () => fixture.defaults }))
import { useSideComposerControls } from './use-side-composer-controls'

let root: ReturnType<typeof createRoot>
let controls: ReturnType<typeof useSideComposerControls>
const apply = vi.fn()
const initial: SideComposerConfig = { harnessId: 'kun', model: 'kun-model', providerId: 'api',
  reasoningEffort: 'high', fastMode: false, approvalPolicy: 'on-request', sandboxMode: 'workspace-write', approvalReviewer: 'user' }
function Probe({ config = initial, id = 'branch-a' }: { config?: SideComposerConfig; id?: string }) {
  controls = useSideComposerControls({ ...config, threadId: id, workspaceRoot: '/repo', enabled: true,
    hasUserMessages: true, onApply: apply })
  return null
}
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  apply.mockClear()
  fixture.rows = [withHarnessReadiness({ definition: { id: 'codex', displayName: 'Codex',
    transport: 'codex-app-server', credentialModes: ['native-login', 'provider', 'kun-gateway'], permissionModes: [],
    modelSource: 'probe', staticModels: [], builtin: true },
    status: { harnessId: 'codex', installed: 'yes', login: 'signed-in', checkedAt: '' } }, [
      { harnessId: 'codex', credentialMode: 'native-login' },
      { harnessId: 'codex', credentialMode: 'provider', providerId: 'api' }
    ])]
  root = createRoot(document.createElement('div'))
})
afterEach(async () => { await act(async () => root.unmount()) })

describe('branch Agent controls', () => {
  it('selects a ready Agent without applying its more permissive global default', async () => {
    await act(async () => root.render(createElement(Probe)))
    act(() => controls.selectHarness('codex'))
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ harnessId: 'codex', model: 'native-model',
      credentialMode: 'native-login', approvalPolicy: 'on-request', sandboxMode: 'workspace-write' }))
  })
  it('decodes provider sentinels and explicitly clears a previous gateway', async () => {
    const config = { ...initial, harnessId: 'codex', credentialMode: 'native-login' as const,
      model: 'native-model', providerId: '' }
    await act(async () => root.render(createElement(Probe, { config })))
    act(() => controls.onModelChange('routed-model', 'ade-cred:provider:api'))
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'api', model: 'routed-model',
      credentialMode: 'provider', gatewayBinding: undefined, reasoningEffort: 'auto' }))
    expect(controls.modelProviderId).toBe(credentialGroupKey('native-login'))
  })
  it('rejects raw or unavailable external routes instead of sending a sentinel as providerId', async () => {
    await act(async () => root.render(createElement(Probe, { config: { ...initial, harnessId: 'codex',
      credentialMode: 'provider', model: 'routed-model' } })))
    act(() => controls.onModelChange('routed-model', 'api'))
    act(() => controls.onModelChange('not-supported', 'ade-cred:provider:api'))
    expect(apply).not.toHaveBeenCalled()
    expect(controls.selectionReady).toBe(true)
  })
  it('shows an unready gateway without silently switching to Kun and does not mutate on branch navigation', async () => {
    const gatewayBinding = { main: { routeId: 'missing', allowedConnectionIds: ['c'] } }
    const config = { ...initial, harnessId: 'codex', credentialMode: 'kun-gateway' as const, gatewayBinding }
    await act(async () => root.render(createElement(Probe, { config })))
    expect(controls.modelProviderId).toBe(aliasCredentialGroupKey(gatewayBinding))
    expect(controls.selectionReady).toBe(false)
    await act(async () => root.render(createElement(Probe, { config: initial, id: 'branch-b' })))
    expect(controls.harnessId).toBe('kun')
    expect(apply).not.toHaveBeenCalled()
  })
})
