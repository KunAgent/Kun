import { useEffect, useState } from 'react'
import type { MobileLinkScope } from '@shared/mobile-link-scopes'
import type { MobileLinkStatus } from '@shared/mobile-link'
import { runTrustedUserActivation } from '../../extensions/protected-user-activation'
import type { MobileLink } from './useMobileLink'
import { MobileScopeOptions, PERSONAL_SCOPES } from './MobileScopeOptions'
import { MobileDesktopScopes } from './MobileDesktopScopes'
import { REMOTE_BUTTON_CLASS, REMOTE_PRIMARY_BUTTON_CLASS, RemoteRow, RemoteRowText, RemoteStatusDot } from './remote-panel-ui'

export function MobileGrantRow({ link, grant }: { link: MobileLink; grant: MobileLinkStatus['grants'][number] }) {
  const { zh, busy, revoke, setScopes } = link
  const approved = grant.scopes ?? PERSONAL_SCOPES, serialized = JSON.stringify(approved)
  const [draft, setDraft] = useState<MobileLinkScope[]>(approved), [saved, setSaved] = useState<string>()
  const [saveFailed, setSaveFailed] = useState(false)
  useEffect(() => { setDraft(JSON.parse(serialized)) }, [grant.id, serialized])
  useEffect(() => { setSaved(undefined); setSaveFailed(false) }, [grant.id])
  const dirty = [...draft].sort().join(',') !== [...approved].sort().join(',')
  const change = (value: MobileLinkScope[]) => { setDraft(value); setSaved(undefined); setSaveFailed(false) }
  async function save() {
    setSaveFailed(false)
    if (await setScopes(grant.id, draft)) setSaved([...draft].sort().join(','))
    else setSaveFailed(true)
  }
  return <RemoteRow className="flex-wrap">
    <RemoteStatusDot on />
    <RemoteRowText title={grant.name ?? grant.controllerId} subtitle={zh ? 'Kun iOS · Plus 及以上' : 'Kun iOS · Plus or higher'} />
    <button type="button" className={REMOTE_BUTTON_CLASS} disabled={Boolean(busy)} onClick={() => revoke(grant.id)}>
      {zh ? '撤销' : 'Revoke'}
    </button>
    <MobileDesktopScopes zh={zh} value={draft} saved={approved} disabled={Boolean(busy)} onChange={change} />
    {saveFailed ? <p role="alert" className="w-full text-[12px] text-ds-danger">
      {zh ? '权限未保存，请重试；手机仍按原权限连接。' : 'Permissions were not saved. Retry; the phone still uses its previous permissions.'}
    </p> : null}
    <MobileScopeOptions zh={zh} value={draft} onChange={change} disabled={Boolean(busy)} includeDesktop={false} />
    {dirty ? <div className="flex w-full flex-col gap-2">
      <p role="status" className="text-[12px] text-amber-600 dark:text-amber-400">
        {zh ? '有未保存的权限变更，手机仍按已保存权限连接。' : 'Unsaved changes. The phone still uses the saved permissions.'}
      </p>
      <div className="flex gap-2">
        <button type="button" className={REMOTE_PRIMARY_BUTTON_CLASS} disabled={Boolean(busy)}
          onClick={event => runTrustedUserActivation(event, () => { void save() })}>
          {busy ? zh ? '正在保存…' : 'Saving…' : zh ? '保存访问权限' : 'Save access permissions'}
        </button>
        <button type="button" className={REMOTE_BUTTON_CLASS} disabled={Boolean(busy)} onClick={() => change([...approved])}>
          {zh ? '取消修改' : 'Discard changes'}
        </button>
      </div>
    </div> : saved === [...approved].sort().join(',') ? <p role="status" className="w-full text-[12px] text-emerald-600 dark:text-emerald-400">
      {zh ? '权限已保存，手机可重新检查电脑状态。' : 'Permissions saved. Recheck the computer on your phone.'}
    </p> : null}
  </RemoteRow>
}
