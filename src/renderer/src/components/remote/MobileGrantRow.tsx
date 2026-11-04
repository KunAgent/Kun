import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MobileLinkScope } from '@shared/mobile-link-scopes'
import type { MobileLinkStatus } from '@shared/mobile-link'
import { runTrustedUserActivation } from '../../extensions/protected-user-activation'
import type { MobileLink } from './useMobileLink'
import { MobileScopeOptions, PERSONAL_SCOPES, selectMobileScope } from './MobileScopeOptions'
import { desktopConsent } from './remote-access-state'
import { REMOTE_BUTTON_CLASS, REMOTE_PRIMARY_BUTTON_CLASS, RemoteGroup } from './remote-panel-ui'
import { REMOTE_FOCUS } from './remote-compact-ui'

const scopeKey = (scopes: MobileLinkScope[]) => [...scopes].sort().join(',')

export function MobileGrantRow({ link, grant, onDirtyChange }: {
  link: MobileLink; grant: MobileLinkStatus['grants'][number]; onDirtyChange?(dirty: boolean): void
}) {
  const { t } = useTranslation('common')
  const { zh, busy, revoke, setScopes } = link
  const approved = grant.scopes ?? PERSONAL_SCOPES
  const serialized = scopeKey(approved)
  const [draft, setDraft] = useState<MobileLinkScope[]>(approved)
  const [saved, setSaved] = useState<string>()
  const [saveFailed, setSaveFailed] = useState(false)
  const dirty = scopeKey(draft) !== serialized
  const dirtyRef = useRef(dirty)
  useEffect(() => {
    // Polling must not overwrite a permission draft being edited.
    if (!dirtyRef.current) setDraft(serialized.split(',').filter(Boolean) as MobileLinkScope[])
  }, [serialized])
  useEffect(() => { dirtyRef.current = dirty }, [dirty])
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  const change = (value: MobileLinkScope[]) => { setDraft(value); setSaved(undefined); setSaveFailed(false) }
  async function save() {
    setSaveFailed(false)
    if (await setScopes(grant.id, draft)) setSaved(scopeKey(draft))
    else setSaveFailed(true)
  }
  const level = desktopConsent(draft)
  const savedLevel = desktopConsent(approved)
  return <>
    <RemoteGroup>
      <div className="flex min-h-11 items-center justify-between gap-2 px-3 text-[13px]">
        <span className="font-medium text-ds-ink">{t('remoteCompact.basic')}</span><span className="text-[12px] text-ds-muted">{t('remoteCompact.basicValue')}</span>
      </div>
      <fieldset className="flex flex-wrap items-center justify-between gap-2 px-3 py-3">
        <legend className="sr-only">{t('remoteCompact.desktop')}</legend>
        <span className="text-[13px] font-medium text-ds-ink">{t('remoteCompact.desktop')}</span>
        <div className="inline-flex rounded-lg bg-ds-subtle p-0.5" role="group" aria-label={t('remoteCompact.desktop')}>
          {(['off', 'view', 'control'] as const).map(value => <button key={value} type="button" disabled={Boolean(busy) || !link.mobileAllowed}
            aria-pressed={level === value} className={`min-h-7 rounded-md px-2 text-[12px] font-medium disabled:opacity-50 ${REMOTE_FOCUS} ${level === value ? 'bg-control text-control-foreground' : 'text-ds-muted'}`}
            onClick={() => change(value === 'off' ? selectMobileScope(draft, 'desktop.view', false)
              : value === 'view' ? selectMobileScope(selectMobileScope(draft, 'desktop.control', false), 'desktop.view', true)
                : selectMobileScope(draft, 'desktop.control', true))}>
            {t(`remoteCompact.${value}`)}
          </button>)}
        </div>
      </fieldset>
      <MobileScopeOptions zh={zh} value={draft} onChange={change} disabled={Boolean(busy) || !link.mobileAllowed} includeDesktop={false} />
    </RemoteGroup>
    <p className="text-[12px] text-ds-muted" aria-live="polite">{t(savedLevel === 'control' ? 'remoteCompact.savedControl' : savedLevel === 'view' ? 'remoteCompact.savedView' : 'remoteCompact.savedOff')}</p>
    {saveFailed ? <p role="alert" className="text-[12px] text-ds-danger">{zh ? '权限未保存，请重试；手机仍按原权限连接。' : 'Permissions were not saved. The phone still uses its previous permissions.'}</p> : null}
    {!dirty && saved === serialized ? <p role="status" className="text-[12px] text-ds-muted">{zh ? '权限已保存，手机可重新检查电脑状态。' : 'Permissions saved. Recheck the computer on your phone.'}</p> : null}
    <button type="button" className={`self-start rounded-md py-1 text-[12px] text-ds-danger disabled:opacity-50 ${REMOTE_FOCUS}`}
      disabled={Boolean(busy)} onClick={() => { if (window.confirm(t('remoteCompact.revokeQuestion'))) revoke(grant.id) }}>{t('remoteCompact.revoke')}</button>
    {dirty ? <div className="sticky bottom-0 -mx-4 -mb-5 mt-2 flex flex-wrap items-center gap-2 border-t border-ds-border-muted bg-ds-sidebar px-4 py-3">
      <span role="status" className="min-w-0 flex-1 text-[12px] text-ds-muted">{t('remoteCompact.dirty')}</span>
      <button type="button" className={REMOTE_BUTTON_CLASS} disabled={Boolean(busy)} onClick={() => change([...approved])}>{t('remoteAccessCancel')}</button>
      <button type="button" className={REMOTE_PRIMARY_BUTTON_CLASS} disabled={Boolean(busy) || !link.mobileAllowed}
        onClick={event => runTrustedUserActivation(event, () => { void save() })}>{t('remoteCompact.savePermissions')}</button>
    </div> : null}
  </>
}
