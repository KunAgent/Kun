import { useEffect, useRef, useState } from 'react'
import type { AdeHarnessRow, AdeHarnessTestResult } from '@shared/ade-harnesses'
import type { KunHarnessSettingsV1 } from '@shared/app-settings'
import { harnessProfileEnabled, harnessProfileKey, selectedHarnessProfile } from '@shared/harness-enablement'
import { getProvider } from '../../agent/registry'
import { registerAgentEnablementCancellation } from './agent-enablement-cancellation'
import { AGENT_SETTINGS_TIMEOUT_MS, waitForAgentSettings } from './agent-enablement-settings'
import { loadHarnesses } from '../../store/harness-store'
import { AgentEnablementError, abortableAgentOperation, agentConfigurationKey, agentReadinessFailure } from './agent-enablement-operation'

export const AGENT_ENABLEMENT_TIMEOUT_MS = 60_000

/** A settings mutation is admitted only by the current, finite, explicit check. */
export function useAgentEnablement(input: {
  row: AdeHarnessRow
  settings: KunHarnessSettingsV1
  patch: (patch: Partial<KunHarnessSettingsV1>) => void
  beforeCheck?: () => Promise<boolean>
}) {
  const { row, settings, patch } = input
  const profile = selectedHarnessProfile(row, settings)
  const profileKey = harnessProfileKey(profile)
  const enabled = harnessProfileEnabled(settings, profile)
  const fingerprint = agentConfigurationKey({ profileKey, definition: row.definition,
    network: row.status.networkFingerprint,
    binary: settings.binaryPaths[row.definition.id], defaults: settings.defaults[row.definition.id],
    custom: settings.custom.find((entry) => entry.id === row.definition.id) })
  const current = useRef({ fingerprint, settings, patch })
  current.current = { fingerprint, settings, patch }
  const generation = useRef(0)
  const active = useRef<AbortController | null>(null)
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<AdeHarnessTestResult | null>(null)
  const [error, setError] = useState('')
  const [errorDetail, setErrorDetail] = useState('')
  const [phase, setPhase] = useState<'preparing' | 'checking' | 'activating'>('preparing')
  const cancel = (): void => {
    generation.current += 1
    active.current?.abort()
    active.current = null
    setChecking(false)
    setResult(null)
    setError('')
    setErrorDetail('')
  }
  useEffect(() => { cancel() }, [fingerprint])
  useEffect(() => registerAgentEnablementCancellation(cancel), [])
  useEffect(() => () => {
    generation.current += 1
    active.current?.abort()
    active.current = null
  }, [])

  const disable = (): void => {
    cancel()
    const latest = current.current
    latest.patch({ enabledProfiles: (latest.settings.enabledProfiles ?? []).filter((entry) =>
      harnessProfileKey(entry) !== profileKey) })
  }

  const enable = async (): Promise<void> => {
    // Synchronous lock covers duplicate clicks before React has re-rendered.
    if (active.current) return
    const test = getProvider().testHarness
    if (!test) { setError('agentEnablement.unavailable'); return }
    if (profile.credentialMode !== 'native-login' && !profile.providerId && !profile.gatewayBinding) {
      setError('agentEnablement.chooseProvider'); return
    }
    const controller = new AbortController()
    active.current = controller
    const epoch = ++generation.current
    const captured = fingerprint
    setChecking(true)
    setResult(null)
    setError('')
    setErrorDetail('')
    const assertCurrent = (): void => {
      controller.signal.throwIfAborted()
      if (generation.current !== epoch || current.current.fingerprint !== captured) throw new Error('agentEnablement.cancelled')
    }
    const stage = async <T,>(next: typeof phase, timeoutMs: number, operation: () => Promise<T>): Promise<T> => {
      assertCurrent()
      setPhase(next)
      const timer = setTimeout(() => controller.abort(new AgentEnablementError(
        next === 'checking' ? 'agentEnablement.timeout' : 'agentEnablement.settingsTimeout'
      )), timeoutMs)
      try { return await abortableAgentOperation(operation(), controller.signal) }
      finally { clearTimeout(timer) }
    }
    try {
      await stage('preparing', AGENT_SETTINGS_TIMEOUT_MS, async () => {
        if (input.beforeCheck && !await input.beforeCheck()) throw new AgentEnablementError('agentEnablement.saveFailed')
        assertCurrent()
        await waitForAgentSettings(settings, controller.signal, { harnessId: profile.harnessId })
      })
      const checked = await stage('checking', AGENT_ENABLEMENT_TIMEOUT_MS, () => test(row.definition.id, {
        level: 'handshake', credentialMode: profile.credentialMode,
        ...(profile.providerId ? { providerId: profile.providerId } : {}),
        ...(profile.gatewayBinding ? { gatewayBinding: profile.gatewayBinding } : {}),
        ...(settings.defaults[row.definition.id]?.model ? { model: settings.defaults[row.definition.id]!.model } : {}),
        timeoutMs: AGENT_ENABLEMENT_TIMEOUT_MS - 5_000
      }, { signal: controller.signal }))
      assertCurrent()
      setResult(checked)
      if (!checked.ok || checked.harnessId !== profile.harnessId || checked.readiness?.usable !== true ||
        checked.readiness.profileKey !== profileKey) {
        const failure = agentReadinessFailure(checked)
        setError(failure.message)
        setErrorDetail(failure.detail)
        return
      }
      const latest = current.current
      const activation = {
        enabledProfiles: [...(latest.settings.enabledProfiles ?? []).filter((entry) => harnessProfileKey(entry) !== profileKey), profile],
        disabledIds: latest.settings.disabledIds.filter((id) => id !== profile.harnessId)
      }
      await stage('activating', AGENT_SETTINGS_TIMEOUT_MS, async () => {
        latest.patch(activation)
        if (input.beforeCheck && !await input.beforeCheck()) throw new AgentEnablementError('agentEnablement.saveFailed')
        assertCurrent()
        await waitForAgentSettings({ ...latest.settings, ...activation }, controller.signal, {
          harnessId: profile.harnessId, enabledProfile: profile
        })
        assertCurrent()
        await loadHarnesses(true)
      })
    } catch (cause) {
      if (generation.current === epoch && current.current.fingerprint === captured) {
        setError(cause instanceof AgentEnablementError ? cause.message : 'agentEnablement.failed')
        setErrorDetail(cause instanceof AgentEnablementError ? cause.detail : cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      if (active.current === controller) active.current = null
      if (generation.current === epoch) setChecking(false)
    }
  }
  return { profile, enabled, checking, phase, result, error, errorDetail, enable, disable, cancel }
}
