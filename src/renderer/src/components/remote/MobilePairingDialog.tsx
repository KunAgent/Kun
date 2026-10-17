import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Smartphone } from 'lucide-react'
import { runTrustedUserActivation } from '../../extensions/protected-user-activation'
import { useMobileLink } from './useMobileLink'

/**
 * App-wide alert for Kun iOS pairing requests: a centred dialog wherever the
 * user is, plus a system notification, Dock bounce and badge while Kun is in
 * the background. "Later" hides one request until the next launch; the
 * Remote panel banner and rail badge keep it reachable.
 */
export function MobilePairingDialog(): ReactElement | null {
  const link = useMobileLink()
  const { zh, enabled, state, busy, confirm } = link
  const [later, setLater] = useState<ReadonlySet<string>>(() => new Set())
  const laterButton = useRef<HTMLButtonElement>(null)
  const pairings = enabled ? state?.pairings ?? [] : []
  const pending = pairings.filter((pairing) => !later.has(pairing.id))
  const current = pending[0]

  const firstId = pairings[0]?.id ?? ''
  const firstName = pairings[0]?.name ?? ''
  useEffect(() => {
    const request = window.kunGui?.requestUserAttention
    if (!request) return
    void request({
      key: firstId ? `mobile-pairing:${firstId}` : 'mobile-pairing',
      title: zh ? `${firstName} 想连接这台电脑` : `${firstName} wants to connect`,
      body: zh ? '打开 Kun 处理 Kun iOS 配对请求' : 'Open Kun to answer the Kun iOS pairing request',
      badge: pairings.length
    }).catch(() => undefined)
  }, [firstId, firstName, pairings.length, zh])

  useEffect(() => {
    if (current) laterButton.current?.focus()
  }, [current?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!current) return null
  const dismiss = (): void => setLater((previous) => new Set(previous).add(current.id))
  const others = pending.length - 1

  return (
    <div
      className="ds-no-drag fixed inset-0 z-[90] flex items-center justify-center bg-black/30 p-4"
      onKeyDown={(event) => {
        if (event.key === 'Escape') dismiss()
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="mobile-pairing-title"
        aria-describedby="mobile-pairing-body"
        className="flex w-[380px] max-w-full flex-col items-center gap-2.5 rounded-[20px] border border-ds-border bg-ds-card p-6 text-center text-ds-ink shadow-[0_24px_64px_rgba(16,24,40,0.28)]"
      >
        <span className="mb-1 flex h-[52px] w-[52px] items-center justify-center rounded-2xl bg-accent-soft text-accent">
          <Smartphone size={26} aria-hidden="true" />
        </span>
        <h2 id="mobile-pairing-title" className="text-[17px] font-semibold leading-6">
          {zh ? `允许「${current.name}」访问这台电脑？` : `Allow "${current.name}" to access this computer?`}
        </h2>
        <p id="mobile-pairing-body" className="text-[13px] leading-[19px] text-ds-muted">
          {zh
            ? '允许后，这台手机可以通过 Kun iOS 查看和发送对话、操作工作区。只允许你自己的设备。'
            : 'Once allowed, this phone can read and send conversations and work in your workspace through Kun iOS. Only allow your own devices.'}
        </p>
        {others > 0 ? (
          <p className="text-[12px] text-ds-faint">
            {zh ? `还有 ${others} 个配对请求` : `${others} more pairing request(s)`}
          </p>
        ) : null}
        <div className="mt-2 flex w-full gap-2">
          <button
            ref={laterButton}
            type="button"
            onClick={dismiss}
            className="h-9 flex-1 rounded-[10px] border border-ds-border bg-ds-card text-[13px] font-medium text-ds-ink transition hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-tint/40"
          >
            {zh ? '稍后' : 'Later'}
          </button>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={(event) => runTrustedUserActivation(event, () => confirm(current.id))}
            className="h-9 flex-1 rounded-[10px] bg-accent text-[13px] font-medium text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-tint/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {zh ? '允许访问' : 'Allow access'}
          </button>
        </div>
      </div>
    </div>
  )
}
