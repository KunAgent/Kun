import { useEffect, useState } from 'react'
import type { AccountEntitlements } from '@kun/remote-protocol'

export function useAccountEntitlements(owner: string | null) {
  const [value, setValue] = useState<AccountEntitlements | null>(null)
  const [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout> | undefined
    setValue(null); setFailed(false)
    if (!owner) return
    async function refresh() {
      let delay = 60000
      try {
        const result = await window.kunGui?.mobileLink?.entitlements?.()
        if (!result || result.userId !== owner) throw new Error('ACCOUNT_CHANGED')
        if (result.status === 'active' && result.expiresAt) delay = Math.max(1000, Math.min(delay, Date.parse(result.expiresAt) - Date.parse(result.checkedAt)))
        if (active) { setValue(result); setFailed(false) }
      } catch { if (active) { setValue(null); setFailed(true) } }
      finally { if (active) timer = setTimeout(() => void refresh(), delay) }
    }
    void refresh()
    return () => { active = false; clearTimeout(timer) }
  }, [owner, attempt])
  return { value: value?.userId === owner ? value : null, failed,
    refresh: () => { setValue(null); setFailed(false); setAttempt(value => value + 1) } }
}
