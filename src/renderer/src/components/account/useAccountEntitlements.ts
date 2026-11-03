import { useEffect, useState } from 'react'
import type { AccountEntitlements } from '@kun/remote-protocol'

export function useAccountEntitlements(owner: string | null) {
  const [value, setValue] = useState<AccountEntitlements | null>(null)
  const [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true, sequence = 0, timer: ReturnType<typeof setTimeout> | undefined
    setValue(null); setFailed(false)
    if (!owner) return
    async function refresh() {
      const turn = ++sequence
      clearTimeout(timer)
      let delay = 60000
      try {
        const result = await window.kunGui?.mobileLink?.entitlements?.()
        if (!result || result.userId !== owner) throw new Error('ACCOUNT_CHANGED')
        if (result.status === 'active' && result.expiresAt) delay = Math.max(1000, Math.min(delay, Date.parse(result.expiresAt) - Date.parse(result.checkedAt)))
        if (active && turn === sequence) { setValue(result); setFailed(false) }
      } catch { if (active && turn === sequence) { setValue(null); setFailed(true) } }
      finally { if (active && turn === sequence) timer = setTimeout(() => void refresh(), delay) }
    }
    void refresh()
    const focus = () => { if (document.visibilityState === 'visible') void refresh() }
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', focus)
    return () => { active = false; ++sequence; clearTimeout(timer); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus) }
  }, [owner, attempt])
  return { value: value?.userId === owner ? value : null, failed,
    refresh: () => { setValue(null); setFailed(false); setAttempt(value => value + 1) } }
}
