import type { AdeHarnessModels, AdeHarnessRow, AdeHarnessTestRequest, AdeHarnessTestResult } from '@shared/ade-harnesses'
import type { KunHarnessEnabledProfileV1, KunHarnessSettingsV1 } from '@shared/app-settings'
import type { RuntimeRequestResult } from '@shared/kun-gui-api'

// Fixture-only wire contract: baseline copies must not import or overwrite
// production helpers that did not exist in the baseline checkout.
const harnessProfileKey = (profile: KunHarnessEnabledProfileV1): string => JSON.stringify([
  profile.harnessId, profile.credentialMode,
  profile.credentialMode === 'native-login' && (!profile.providerId?.trim() || profile.providerId.trim() === 'default')
    ? '' : profile.providerId?.trim() || 'default'
])

const devinModels: NonNullable<AdeHarnessModels['modelInfo']> = [
  { id: 'adaptive', displayName: 'Adaptive' },
  { id: 'swe-2-high', displayName: 'SWE-2' },
  { id: 'swe-1-7-lightning-medium', displayName: 'SWE-1.7 Lightning' },
  { id: 'claude-fable-5-1-medium', displayName: 'Claude Fable 5.1' },
  { id: 'claude-opus-5-5-medium', displayName: 'Claude Opus 5.5' },
  { id: 'gpt-6-astra-medium', displayName: 'GPT-6 Astra' },
  { id: 'gpt-6-sol-medium', displayName: 'GPT-6 Sol' },
  { id: 'gemini-3-8-flash-medium', displayName: 'Gemini 3.8 Flash' },
  { id: 'glm-5-2', displayName: 'GLM-5.2' },
  { id: 'kimi-k3-high', displayName: 'Kimi K3' },
  { id: 'fusion-gpt-6-astra-high-sidekick-swe-2-medium', displayName: 'Fusion (GPT-6 Astra High Thinking + SWE-2 Medium)', category: 'fusion' },
  { id: 'fusion-claude-opus-5-5-high-sidekick-swe-2-medium', displayName: 'Fusion (Claude Opus 5.5 High Thinking + SWE-2 Medium)', category: 'fusion' }
]
const fixtureRows: AdeHarnessRow[] = [
  ['kun', 'Kun', 'native-loop'], ['pi', 'Pi', 'pi-rpc'],
  ['deepseek-harness', 'DeepSeek Harness', 'acp'], ['claude-code', 'Claude Code', 'agent-sdk'],
  ['gemini-cli', 'Gemini CLI', 'acp'], ['devin', 'Devin', 'acp']
].map(([id, displayName, transport]) => ({
  definition: { id, displayName, transport: transport as AdeHarnessRow['definition']['transport'],
    credentialModes: id === 'kun' ? ['provider'] : id === 'deepseek-harness' || id === 'devin' ? ['native-login'] : ['native-login', 'kun-gateway'],
    permissionModes: id === 'devin' ? [{ id: 'normal', label: 'Ask', kunPermissionMode: 'ask-for-approval' },
      { id: 'bypass', label: 'Full access', kunPermissionMode: 'full-access' }] : [],
    modelSource: id === 'devin' ? 'probe' : 'static', staticModels: id === 'devin' ? [] : ['fixture-model'], builtin: true,
    availability: id === 'deepseek-harness' ? 'preview' : id === 'gemini-cli' ? 'retired' : 'active' },
  status: { harnessId: id, installed: 'yes', version: id === 'deepseek-harness' ? '0.2.0-rc.2' : '1.0.0',
    ready: 'yes', login: id === 'kun' ? 'not-required' : 'unknown', checkedAt: new Date().toISOString() }
}))
const response = (value: unknown): RuntimeRequestResult => ({ ok: true, status: 200, body: JSON.stringify(value) })

/** Deterministic offline transport only; production settings and picker own all decisions. */
export function createAgentEnablementSmokeRuntime(settings: () => KunHarnessSettingsV1) {
  let outcome: 'success' | 'failure' | 'pending' = 'success'
  const proofs = new Map<string, KunHarnessEnabledProfileV1 & { expiresAt: string; fingerprint: string }>()
  const pending = new Set<(ok: boolean) => void>()
  const calls = { tests: 0 }
  const fingerprint = (): string => JSON.stringify({ defaults: settings().defaults, paths: settings().binaryPaths, custom: settings().custom })
  const rows = (): AdeHarnessRow[] => fixtureRows.filter((row) => row.definition.availability !== 'retired').map((row) => {
    const enabledProfiles = (settings().enabledProfiles ?? []).filter((entry) => entry.harnessId === row.definition.id && !settings().disabledIds.includes(entry.harnessId))
    return { ...row, enabled: row.definition.id === 'kun' || enabledProfiles.length > 0, enabledProfiles,
      readyProfiles: [...proofs.values()].filter((proof) => proof.harnessId === row.definition.id && proof.fingerprint === fingerprint()) }
  })
  return {
    calls, rows,
    restart(): void { proofs.clear() },
    reset(): void { outcome = 'success'; proofs.clear(); calls.tests = 0 },
    setOutcome(value: typeof outcome): void { outcome = value },
    resolvePending(ok: boolean): void { for (const resolve of pending) resolve(ok); pending.clear() },
    async request(path: string, method = 'GET', body?: string): Promise<RuntimeRequestResult | null> {
      const url = new URL(path, 'http://fixture.invalid')
      if (url.pathname === '/v1/harnesses') return response({ harnesses: rows().filter((row) => url.searchParams.get('include_disabled') === 'true' || row.enabled) })
      const match = /^\/v1\/harnesses\/([^/]+)\/(test|models|probe)$/.exec(url.pathname)
      if (!match) return null
      const row = rows().find((entry) => entry.definition.id === match[1])
      if (!row) return null
      if (match[2] === 'models' && match[1] === 'devin') return response({ harnessId: 'devin', models: devinModels.map((model) => model.id), modelInfo: devinModels })
      if (match[2] === 'models') return response({ harnessId: match[1], models: ['fixture-model'],
        groups: [{ providerId: 'fixture-provider', label: 'Offline provider', models: ['fixture-model'] }] })
      if (match[2] === 'probe') return response(row)
      if (method !== 'POST') return null
      calls.tests += 1
      const request = JSON.parse(body ?? '{}') as AdeHarnessTestRequest
      const profile: KunHarnessEnabledProfileV1 = { harnessId: match[1], credentialMode: request.credentialMode ?? 'native-login',
        ...(request.providerId ? { providerId: request.providerId } : {}) }
      const captured = fingerprint()
      const ok = outcome === 'pending' ? await new Promise<boolean>((resolve) => pending.add(resolve)) : outcome === 'success'
      const key = harnessProfileKey(profile)
      if (ok && captured === fingerprint()) proofs.set(key, { ...profile, expiresAt: new Date(Date.now() + 300_000).toISOString(), fingerprint: captured })
      const result: AdeHarnessTestResult = {
        harnessId: profile.harnessId, transport: row.definition.transport, level: request.level, ok, durationMs: 25,
        detect: { ok: true, durationMs: 5, status: row.status },
        handshake: { ok, supported: true, durationMs: 20, protocol: row.definition.transport },
        readiness: { profileKey: key, usable: ok, authentication: 'unverified', checkedAt: new Date().toISOString(),
          ...(ok ? {} : { detail: 'Connection check failed. Review the command and credential configuration, then retry.' }),
          checks: ['installation', 'configuration', 'credentials', 'protocol'].map((id) => ({
            id: id as 'installation' | 'configuration' | 'credentials' | 'protocol', ok: ok || id !== 'protocol' })) }
      }
      return response(result)
    }
  }
}
