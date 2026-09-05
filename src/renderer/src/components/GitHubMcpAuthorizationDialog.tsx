import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import type { BuiltinGitHubMcpAuthorizationPreflight } from '@shared/github-mcp-authorization'

export function GitHubMcpAuthorizationDialog({
  preflight,
  busy,
  onCancel,
  onBind,
  onDisable,
  onConfirm,
  t
}: {
  preflight?: BuiltinGitHubMcpAuthorizationPreflight
  busy: boolean
  onCancel: () => void
  onBind: (host: string) => void
  onDisable: () => void
  onConfirm: (input: { allowedOrganizations: string[]; allowedRepositories: string[] }) => void
  t: (key: string) => string
}): ReactElement | null {
  const [host, setHost] = useState('github.com')
  const [organizations, setOrganizations] = useState('')
  const [repositories, setRepositories] = useState('')
  const dialogRef = useRef<HTMLElement>(null)
  const open = Boolean(preflight)
  useEffect(() => {
    if (preflight?.status !== 'ready') return
    setHost(preflight.identity.host)
    setOrganizations(preflight.allowedOrganizations.join(', '))
    setRepositories(preflight.allowedRepositories.join(', '))
  }, [preflight])
  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement as HTMLElement | null
    const first = dialogRef.current?.querySelector<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])')
    first?.focus()
    return () => previousFocus?.focus()
  }, [open])
  if (!preflight) return null
  const inputClass = 'mt-1 h-10 w-full rounded-xl border border-ds-border bg-ds-main/45 px-3 text-sm text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/30'

  if (preflight.status === 'missing') {
    return (
      <DialogShell title={t('pluginGithubBindTitle')} onCancel={onCancel} t={t} dialogRef={dialogRef}>
        <p className="text-sm leading-6 text-ds-muted">{t('pluginGithubBindDescription')}</p>
        <label className="mt-4 block text-xs font-semibold text-ds-muted">
          {t('pluginGithubHost')}
          <input value={host} onChange={(event) => setHost(event.target.value)} className={inputClass} spellCheck={false} />
          {host.trim().toLowerCase() !== 'github.com' ? (
            <span className="mt-1 block text-xs font-normal text-red-700">{t('pluginGithubEnterpriseUnsupported')}</span>
          ) : null}
        </label>
        <p className="mt-3 rounded-xl bg-ds-subtle px-3 py-2 text-xs leading-5 text-ds-muted">{t('pluginGithubBindPrivacy')}</p>
        <div className="mt-5 flex justify-end">
          <button type="button" disabled={busy || host.trim().toLowerCase() !== 'github.com'} onClick={() => onBind(host)} className="rounded-xl bg-ds-userbubble px-4 py-2 text-sm font-semibold text-ds-userbubbleFg hover:opacity-90 disabled:opacity-60">
            {busy ? t('pluginGithubBindStarting') : t('pluginGithubBindButton')}
          </button>
        </div>
      </DialogShell>
    )
  }

  const { identity } = preflight
  return (
    <DialogShell title={t('pluginGithubAuthTitle')} onCancel={onCancel} t={t} dialogRef={dialogRef}>
      <p className="text-sm leading-6 text-ds-muted">{t('pluginGithubAuthDescription')}</p>
      <dl className="mt-4 grid grid-cols-[96px_1fr] gap-x-3 gap-y-2 rounded-xl bg-ds-subtle px-3 py-3 text-xs">
        <dt className="text-ds-faint">{t('pluginGithubHost')}</dt><dd className="font-mono text-ds-ink">{identity.host}</dd>
        <dt className="text-ds-faint">{t('pluginGithubAccount')}</dt><dd className="font-semibold text-ds-ink">{identity.login}</dd>
        <dt className="text-ds-faint">{t('pluginGithubSource')}</dt><dd className="font-mono text-ds-ink">{identity.source}</dd>
        <dt className="text-ds-faint">{t('pluginGithubScopes')}</dt><dd className="break-words text-ds-ink">{identity.scopes.join(', ') || t('pluginGithubScopesNone')}</dd>
        <dt className="text-ds-faint">{t('pluginGithubFingerprint')}</dt><dd className="font-mono text-ds-ink" title={identity.fingerprint} aria-label={`${t('pluginGithubFingerprint')}: ${identity.fingerprint}`}>{`${identity.fingerprint.slice(0, 12)}…${identity.fingerprint.slice(-8)}`}</dd>
      </dl>
      <label className="mt-4 block text-xs font-semibold text-ds-muted">
        {t('pluginGithubAllowedOrganizations')}
        <input value={organizations} onChange={(event) => setOrganizations(event.target.value)} className={inputClass} placeholder="acme, example-org" spellCheck={false} />
      </label>
      <label className="mt-3 block text-xs font-semibold text-ds-muted">
        {t('pluginGithubAllowedRepositories')}
        <input value={repositories} onChange={(event) => setRepositories(event.target.value)} className={inputClass} placeholder="acme/api, acme/web" spellCheck={false} />
      </label>
      <p className="mt-2 text-xs leading-5 text-ds-faint">{t('pluginGithubAllowlistHint')}</p>
      <div className="mt-5 flex items-center justify-between gap-3">
        <button type="button" disabled={busy} onClick={onDisable} className="rounded-xl px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-500/10 disabled:opacity-60">{t('pluginGithubDisable')}</button>
        <button type="button" disabled={busy} onClick={() => onConfirm({
          allowedOrganizations: csv(organizations),
          allowedRepositories: csv(repositories)
        })} className="rounded-xl bg-ds-userbubble px-4 py-2 text-sm font-semibold text-ds-userbubbleFg hover:opacity-90 disabled:opacity-60">
          {busy ? t('pluginGithubAuthConfirming') : t('pluginGithubAuthConfirm')}
        </button>
      </div>
    </DialogShell>
  )
}

function DialogShell({ title, onCancel, t, children, dialogRef }: {
  title: string
  onCancel: () => void
  t: (key: string) => string
  children: React.ReactNode
  dialogRef: React.RefObject<HTMLElement | null>
}): ReactElement {
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ) ?? [])]
    if (!focusable.length) return
    const current = focusable.indexOf(document.activeElement as HTMLElement)
    const next = event.shiftKey
      ? current <= 0 ? focusable.length - 1 : current - 1
      : current >= focusable.length - 1 ? 0 : current + 1
    event.preventDefault()
    focusable[next]?.focus()
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="presentation">
      <section ref={dialogRef} onKeyDown={onKeyDown} aria-labelledby="github-mcp-dialog-title" aria-modal="true" role="dialog" className="w-full max-w-lg rounded-2xl border border-ds-border bg-ds-card p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <h2 id="github-mcp-dialog-title" className="text-lg font-semibold text-ds-ink">{title}</h2>
          <button type="button" onClick={onCancel} className="rounded-lg px-2 py-1 text-xs font-semibold text-ds-muted hover:bg-ds-hover">{t('pluginGithubAuthCancel')}</button>
        </div>
        {children}
      </section>
    </div>
  )
}

function csv(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}
