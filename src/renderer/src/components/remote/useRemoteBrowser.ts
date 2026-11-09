import { useCallback, useEffect, useState } from 'react'
import type { RemoteAccessConfigPatch, RemoteAccessStatus, RemoteTailscaleInfo } from '@shared/remote-access'

export function useRemoteBrowser() {
  const api = window.kunGui
  const [status, setStatus] = useState<RemoteAccessStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [tailscale, setTailscale] = useState<RemoteTailscaleInfo | null>(null)
  const [tailscaleBusy, setTailscaleBusy] = useState(false)
  const refresh = useCallback(async () => {
    if (!api?.remoteAccessGetStatus) return
    try { setStatus(await api.remoteAccessGetStatus()); setError('') }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
  }, [api])
  useEffect(() => {
    void refresh()
    return api?.onRemoteAccessStatusChanged?.(setStatus)
  }, [api, refresh])
  async function action(run: () => Promise<RemoteAccessStatus>): Promise<boolean> {
    setBusy(true); setError('')
    try { setStatus(await run()); return true }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); return false }
    finally { setBusy(false) }
  }
  const detectTailscale = useCallback(async () => {
    if (!api?.remoteAccessDetectTailscale) return
    setTailscaleBusy(true)
    try { setTailscale(await api.remoteAccessDetectTailscale()) }
    catch { setTailscale({ installed: false, connected: false, ipv4: null }) }
    finally { setTailscaleBusy(false) }
  }, [api])
  return {
    status, busy, error, setError, refresh, tailscale, tailscaleBusy, detectTailscale,
    applyConfig: async (patch: RemoteAccessConfigPatch) => { if (api?.remoteAccessSetConfig) await action(() => api.remoteAccessSetConfig(patch)) },
    savePassword: (password: string) => api?.remoteAccessSetPassword ? action(() => api.remoteAccessSetPassword(password)) : Promise.resolve(false),
    revokeSessions: () => api?.remoteAccessRevokeSessions && void action(() => api.remoteAccessRevokeSessions())
  }
}
export type RemoteBrowser = ReturnType<typeof useRemoteBrowser>
