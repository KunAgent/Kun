import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { AccountEntitlements } from '@kun/remote-protocol'

export function VipEntitlements({ owner }: { owner: string }): ReactElement {
  const { i18n } = useTranslation(), zh = i18n.language.startsWith('zh')
  const [value, setValue] = useState<AccountEntitlements | null>(null), [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    setValue(null); setFailed(false)
    async function refresh() {
      let delay = 60000
      try {
        const value = await window.kunGui?.mobileLink?.entitlements?.()
        if (!value || value.userId !== owner) throw new Error('ACCOUNT_CHANGED')
        if (value.status === 'active' && value.expiresAt) delay = Math.max(1000, Math.min(delay, Date.parse(value.expiresAt) - Date.parse(value.checkedAt)))
        if (active) { setValue(value); setFailed(false) }
      } catch { if (active) { setValue(null); setFailed(true) } }
      finally { if (active) timer = setTimeout(() => void refresh(), delay) }
    }
    void refresh()
    return () => { active = false; clearTimeout(timer) }
  }, [owner, attempt])
  const shown = value?.userId === owner ? value : null
  const label = shown ? shown.effectiveTier === 'free' ? zh ? '免费账号' : 'Free account' : shown.effectiveTier[0].toUpperCase() + shown.effectiveTier.slice(1) : failed ? zh ? '会员状态暂不可用' : 'Membership unavailable' : zh ? '正在读取会员状态…' : 'Checking membership…'
  return <section className="mx-3 my-2 rounded-lg border border-ds-border-muted p-3 text-[12px] text-ds-muted" aria-label={zh ? '会员权益' : 'Membership'}>
    <div className="flex items-center justify-between gap-2"><strong className="text-ds-ink">{label}</strong><button type="button" onClick={() => setAttempt(value => value + 1)}>{zh ? '刷新' : 'Refresh'}</button></div>
    {shown?.status === 'expired' ? <p>{zh ? '会员已到期' : 'Membership expired'}</p> : null}
    {shown?.expiresAt ? <p>{zh ? '有效期至：' : 'Expires: '}{new Date(shown.expiresAt).toLocaleString()}</p> : null}
    <p>Plus · {zh ? '手机远控' : 'Mobile remote access'}</p>
    <p>Pro / Max · {zh ? '手机远控、个人助手' : 'Mobile remote access and personal assistants'}</p>
  </section>
}
