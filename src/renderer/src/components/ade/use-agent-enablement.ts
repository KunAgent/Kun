import { useEffect, useRef, useState } from 'react'
import type { AdeHarnessRow, AdeHarnessTestResult } from '@shared/ade-harnesses'
import type { KunHarnessSettingsV1 } from '@shared/app-settings'
import { harnessProfileEnabled, harnessProfileKey, selectedHarnessProfile } from '@shared/harness-enablement'
import { getProvider } from '../../agent/registry'
import { registerAgentEnablementCancellation } from './agent-enablement-cancellation'
import { waitForAgentSettings } from './agent-enablement-settings'
import { loadHarnesses } from '../../store/harness-store'

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
  const fingerprint = JSON.stringify({ profileKey, definition: row.definition,
    command: row.status.resolvedCommand, version: row.status.version, network: row.status.networkFingerprint,
    binary: settings.binaryPaths[row.definition.id], defaults: settings.defaults[row.definition.id],
    custom: settings.custom.find((entry) => entry.id === row.definition.id) })
  const current = useRef({ fingerprint, settings, patch })
  current.current = { fingerprint, settings, patch }
  const generation = useRef(0)
  const active = useRef<AbortController | null>(null)
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<AdeHarnessTestResult | null>(null)
  const [error, setError] = useState('')
  const cancel = (): void => {
    generation.current += 1
    active.current?.abort()
    active.current = null
    setChecking(false)
    setResult(null)
    setError('')
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
    if (profile.credentialMode !== 'native-login' && !profile.providerId) {
      setError('agentEnablement.chooseProvider'); return
    }
    const controller = new AbortController()
    active.current = controller
    const epoch = ++generation.current
    const captured = fingerprint
    setChecking(true)
    setResult(null)
    setError('')
    let timer: ReturnType<typeof setTimeout> | undefined
    let timedOut = false
    try {
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true
          controller.abort()
          reject(new Error('agentEnablement.timeout'))
        }, AGENT_ENABLEMENT_TIMEOUT_MS)
      })
      const operation = async (): Promise<AdeHarnessTestResult> => {
        if (input.beforeCheck) {
          if (!await input.beforeCheck()) throw new Error('agentEnablement.settingsUnavailable')
          await waitForAgentSettings(settings, controller.signal)
        }
        controller.signal.throwIfAborted()
        if (generation.current !== epoch || current.current.fingerprint !== captured) throw new Error('agentEnablement.cancelled')
        return test(row.definition.id, {
        level: 'handshake', credentialMode: profile.credentialMode,
        ...(profile.providerId ? { providerId: profile.providerId } : {}),
        ...(settings.defaults[row.definition.id]?.model ? { model: settings.defaults[row.definition.id]!.model } : {}),
        timeoutMs: AGENT_ENABLEMENT_TIMEOUT_MS - 5_000
      }, { signal: controller.signal })
      }
      const checked = await Promise.race([operation(), deadline])
      if (generation.current !== epoch || current.current.fingerprint !== captured || controller.signal.aborted) return
      setResult(checked)
      if (!checked.ok || checked.harnessId !== profile.harnessId || checked.readiness?.usable !== true ||
        checked.readiness.profileKey !== profileKey) {
        setError(checked.readiness?.detail || checked.handshake?.detail || checked.detect.status.message || 'agentEnablement.failed')
        return
      }
      const latest = current.current
      latest.patch({
        enabledProfiles: [...(latest.settings.enabledProfiles ?? []).filter((entry) => harnessProfileKey(entry) !== profileKey), profile],
        disabledIds: latest.settings.disabledIds.filter((id) => id !== profile.harnessId)
      })
      void loadHarnesses(true)
    } catch (cause) {
      if (generation.current === epoch && current.current.fingerprint === captured) {
        setError(timedOut ? 'agentEnablement.timeout' : cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      if (timer) clearTimeout(timer)
      if (active.current === controller) active.current = null
      if (generation.current === epoch) setChecking(false)
    }
  }
  return { profile, enabled, checking, result, error, enable, disable, cancel }
}
