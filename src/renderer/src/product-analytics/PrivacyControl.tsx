import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AnalyticsState } from '@shared/product-analytics'
import { trackProduct, setProductCapture, PRODUCT_ANALYTICS_CHANGED } from './client'
export function ProductAnalyticsConsent({ freshOnly = false }: { freshOnly?: boolean }) {
  const { i18n } = useTranslation()
  const zh = i18n.language.startsWith('zh')
  const [state, setState] = useState<AnalyticsState | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (window.kunGui?.isRemoteWeb) return
    let live = true
    void window.kunGui?.productAnalytics?.getState().then(s => { if (live) setState(s) }).catch(() => {})
    return () => { live = false }
  }, [])
  if (!state || (freshOnly && state.installation !== 'fresh')) return null
  return <section className="rounded-xl border border-ds-border p-4" data-product-analytics-consent>
    <label className="flex items-start gap-3">
      <input type="checkbox" checked={state.enabled} disabled={busy} className="mt-1"
        onChange={async e => {
          const enabled = e.target.checked; setBusy(true)
          try {
            const next = await window.kunGui.productAnalytics!.setEnabled(enabled); setState(next)
            setProductCapture(next.enabled, next.epoch); window.dispatchEvent(new Event(PRODUCT_ANALYTICS_CHANGED))
            if (enabled) trackProduct({ name: 'onboarding_step', properties: { step: 'welcome', action: 'entered' } })
          } catch { /* Keep the previous preference when persistence fails. */ }
          finally { setBusy(false) }
        }} />
      <span><span className="font-medium">{zh ? '帮助改进 Kun 的使用体验（可选）' : 'Help improve Kun (optional)'}</span>
        <span className="mt-1 block text-sm text-ds-muted">{zh
          ? '同意后统计此设备后续的操作步骤、耗时和错误类别；登录后事件关联当前账号。不上传提示词、代码、回复、路径或密钥。可随时关闭，关闭会清除待上传数据；已接收数据最多保留 90 天。'
          : 'Collect future interaction steps, timing and error categories on this device; signed-in events belong to the current account. No prompts, code, replies, paths or credentials. Turn off at any time to clear pending data; received data is retained for up to 90 days.'}</span>
      </span>
    </label>
  </section>
}
