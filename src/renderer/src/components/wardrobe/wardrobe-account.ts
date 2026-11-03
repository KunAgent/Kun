import { useCallback, useEffect, useRef, useState } from 'react'
import type { TFunction } from 'i18next'
import type { KunAccountWardrobeApi, KunEconomyResult } from '@shared/kun-account-economy'
import { WardrobeAccountError } from '../rooms/room-wardrobe'

/** Rule codes with their own sentence; anything else reads as a temporary outage. */
const KNOWN = new Set(['anonymous', 'expired', 'network', 'not_enough_feathers', 'offer_limit_reached', 'offer_unavailable', 'shelf_full',
  'item_owned', 'item_unknown', 'look_item_locked', 'bottle_not_found', 'invite_code_invalid', 'invite_self', 'invite_already_claimed',
  'invite_mutual', 'invite_window_closed', 'invalid_request'])

export function wardrobeErrorText(t: TFunction, cause: unknown): string {
  const code = cause instanceof WardrobeAccountError ? cause.code : ''
  return t(`wardrobeAccountError_${KNOWN.has(code) ? code : 'service'}`)
}

/** Starts the browser sign-in; the sidebar account control follows it from there. */
export function signInToKun(): void {
  void window.kunGui?.kunAccount?.login().catch(() => undefined)
}

/** Loads one account read (shop, invitations) and reloads it on demand. */
export function useAccountRead<T>(read: (api: KunAccountWardrobeApi) => Promise<KunEconomyResult<T>>, active: boolean) {
  const [value, setValue] = useState<T | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const serial = useRef(0)
  const latest = useRef(read)
  latest.current = read
  const reload = useCallback(async () => {
    const api = window.kunGui?.kunAccount?.wardrobe
    if (!api) return
    const version = ++serial.current
    setLoading(true)
    try {
      const result = await latest.current(api)
      if (version !== serial.current) return
      if (result.ok) { setValue(result.value); setError(null) } else setError(new WardrobeAccountError(result.code))
    } catch (cause) { if (version === serial.current) setError(cause) }
    finally { if (version === serial.current) setLoading(false) }
  }, [])
  useEffect(() => { if (active) void reload() }, [active, reload])
  return { value, error, loading, reload, setValue }
}

/** Copies text and reports whether the clipboard accepted it. */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true } catch { return false }
}

/** XXXX-XXXX reads aloud more easily than eight letters in a row. */
export const formatInviteCode = (code: string): string => code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code
