import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useAccountEntitlements } from './useAccountEntitlements'

export function VipEntitlements({ owner }: { owner: string }): ReactElement {
  const { i18n } = useTranslation(), zh = i18n.language.startsWith('zh')
  const [openingFailed, setOpeningFailed] = useState(false)
  const { value: shown, failed, refresh } = useAccountEntitlements(owner)
  const label = shown ? shown.effectiveTier === 'free' ? zh ? '免费账号' : 'Free account' : shown.effectiveTier[0].toUpperCase() + shown.effectiveTier.slice(1) : failed ? zh ? '会员状态暂不可用' : 'Membership unavailable' : zh ? '正在读取会员状态…' : 'Checking membership…'
  return <section className="mx-3 my-2 rounded-lg border border-ds-border-muted p-3 text-[12px] text-ds-muted" aria-label={zh ? '会员权益' : 'Membership'}>
    <div className="flex items-center justify-between gap-2"><strong className="text-ds-ink">{label}</strong><button type="button" onClick={refresh}>{zh ? '刷新' : 'Refresh'}</button></div>
    {shown?.status === 'expired' ? <p>{zh ? '会员已到期' : 'Membership expired'}</p> : null}
    {shown?.expiresAt ? <p>{zh ? '有效期至：' : 'Expires: '}{new Date(shown.expiresAt).toLocaleString()}</p> : null}
    {shown?.status === 'active' && !shown.expiresAt ? <p>{zh ? '长期有效' : 'No expiry'}</p> : null}
    <p>Plus · {zh ? '手机远控' : 'Mobile remote access'}</p>
    <p>Pro / Max · {zh ? '手机远控、个人助手' : 'Mobile remote access and personal assistants'}</p>
    <button type="button" className="mt-2 flex w-full items-center justify-between rounded-md bg-ds-subtle px-2 py-2 text-ds-ink" onClick={() => { setOpeningFailed(false); const open = window.kunGui?.kunAccount?.openMembership; if (open) void open().catch(() => setOpeningFailed(true)); else setOpeningFailed(true) }}>{zh ? '兑换邀请码 / 体验码' : 'Redeem invitation / trial code'}<span aria-hidden="true">↗</span></button>
    {openingFailed ? <p role="alert">{zh ? '打开失败，请在官网个人中心的会员页兑换。' : 'Open the membership tab in your account on the website.'}</p> : null}
  </section>
}
