import type { ModelProviderSettingsV1 } from '@shared/app-settings'
import type { GatewayCredentialStatus } from '@shared/kun-gui-api'
import { useEffect, useState } from 'react'

function gatewayCredentialBridge(): typeof window.kunGui.gatewayCredential | undefined {
  if (typeof window === 'undefined') return undefined
  const bridge = window.kunGui?.gatewayCredential
  return typeof bridge === 'function' ? bridge.bind(window.kunGui) : undefined
}

export function useGatewayCredentialControls(
  settings: ModelProviderSettingsV1,
  onChange: (next: ModelProviderSettingsV1) => void,
  onError: (message: string) => void
): {
  credential: GatewayCredentialStatus
  pending: boolean
  update(action: 'ensure' | 'copy' | 'rotate' | 'revoke'): Promise<void>
  setEnabled(enabled: boolean): Promise<void>
} {
  const [credential, setCredential] = useState<GatewayCredentialStatus>({ configured: false })
  const [pending, setPending] = useState(false)

  const update = async (action: 'ensure' | 'copy' | 'rotate' | 'revoke'): Promise<void> => {
    setPending(true)
    onError('')
    try {
      const bridge = gatewayCredentialBridge()
      if (!bridge) throw new Error('Gateway credential controls are unavailable')
      const result = await bridge(action)
      if (!result.ok) throw new Error(`Gateway credential ${action} failed (${result.status})`)
      setCredential(result.credential)
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    } finally {
      setPending(false)
    }
  }

  const setEnabled = async (enabled: boolean): Promise<void> => {
    if (enabled && !credential.configured) {
      setPending(true)
      try {
        const bridge = gatewayCredentialBridge()
        if (!bridge) throw new Error('Gateway credential controls are unavailable')
        const result = await bridge('ensure')
        if (!result.ok) throw new Error(`Gateway credential ensure failed (${result.status})`)
        setCredential(result.credential)
      } catch (error) {
        onError(error instanceof Error ? error.message : String(error))
        return
      } finally {
        setPending(false)
      }
    }
    onChange({ ...settings, localGateway: { ...settings.localGateway, enabled } })
  }

  useEffect(() => {
    const bridge = gatewayCredentialBridge()
    if (!bridge) return
    let mounted = true
    void bridge('status').then((result) => {
      if (mounted && result.ok) setCredential(result.credential)
    }).catch(() => undefined)
    return () => { mounted = false }
  }, [])

  return { credential, pending, update, setEnabled }
}
