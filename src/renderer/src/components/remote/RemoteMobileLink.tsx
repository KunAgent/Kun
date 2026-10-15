import type { ReactElement } from 'react'
import { Smartphone } from 'lucide-react'
import { runTrustedUserActivation } from '../../extensions/protected-user-activation'
import type { MobileLink } from './useMobileLink'
import {
  REMOTE_BUTTON_CLASS,
  REMOTE_PRIMARY_BUTTON_CLASS,
  RemoteIconTile,
  RemoteRow,
  RemoteRowText,
  RemoteStatusDot,
  RemoteSwitch
} from './remote-panel-ui'

/** iOS pairing requests, pinned to the top of the panel until allowed. */
export function MobilePairingRequests({ link }: { link: MobileLink }): ReactElement | null {
  const { zh, enabled, state, busy, confirm } = link
  if (!enabled || !state?.pairings.length) return null
  return (
    <div className="flex flex-col gap-2">
      {state.pairings.map((pairing) => (
        <div
          key={pairing.id}
          className="flex items-center gap-2.5 rounded-xl border border-accent-tint/30 bg-accent-soft px-3 py-2.5"
        >
          <RemoteIconTile active>
            <Smartphone size={15} />
          </RemoteIconTile>
          <RemoteRowText
            title={zh ? `${pairing.name} 请求访问` : `${pairing.name} wants access`}
            subtitle={zh ? '通过 Kun iOS 连接这台电脑' : 'Connecting to this computer through Kun iOS'}
          />
          <button
            type="button"
            className={REMOTE_PRIMARY_BUTTON_CLASS}
            disabled={Boolean(busy)}
            onClick={(event) => runTrustedUserActivation(event, () => confirm(pairing.id))}
          >
            {zh ? '允许访问' : 'Allow access'}
          </button>
        </div>
      ))}
    </div>
  )
}

function mobileSubtitle(link: MobileLink): string {
  const { zh, busy, starting, signedIn, state } = link
  if (busy === 'stop') return zh ? '正在关闭' : 'Stopping'
  if (starting) return zh ? '正在启动' : 'Starting'
  if (signedIn && state?.online) return zh ? '中继已连接 · 聊天记录留在电脑' : 'Relay connected · history stays here'
  if (signedIn && state?.enabled) return zh ? '连接中' : 'Connecting'
  if (!signedIn) return zh ? '官方中继需登录 Kun 账号后使用' : 'The official relay needs a Kun account sign-in'
  return zh ? '已关闭 · 每次打开 Kun 默认关闭' : 'Off · off each time Kun opens'
}

/** The Kun iOS row in the access-method list. */
export function MobileChannelRow({ link }: { link: MobileLink }): ReactElement | null {
  const { api, zh, account, signedIn, state, busy, starting, canStop, enabled, connectionError, toggle } = link
  if (!api) return null
  const on = enabled || starting
  const label = starting
    ? zh ? '取消启动' : 'Cancel start'
    : enabled
      ? zh ? '关闭手机远程' : 'Stop remote access'
      : zh ? '启动手机远程' : 'Start remote access'
  return (
    <RemoteRow className="flex-wrap">
      <RemoteIconTile active={on}>
        <Smartphone size={15} />
      </RemoteIconTile>
      <RemoteRowText
        title={zh ? 'Kun iOS · 中继' : 'Kun iOS · relay'}
        subtitle={mobileSubtitle(link)}
      />
      {signedIn ? (
        <RemoteSwitch
          checked={on}
          label={label}
          disabled={!state || busy === 'stop' || (Boolean(busy) && !canStop)}
          onToggle={toggle}
        />
      ) : account.state.status === 'authorizing' ? (
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="text-[12px] text-ds-muted">{zh ? '等待登录…' : 'Waiting…'}</span>
          <button
            type="button"
            className={REMOTE_BUTTON_CLASS}
            onClick={() => void account.run('cancelLogin')}
          >
            {zh ? '取消' : 'Cancel'}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={REMOTE_PRIMARY_BUTTON_CLASS}
          disabled={!account.api || Boolean(account.busy) || account.state.status === 'loading'}
          onClick={() => void account.run('login')}
        >
          {zh ? '登录 Kun' : 'Sign in to Kun'}
        </button>
      )}
      {connectionError ? (
        <p role="alert" className="w-full pl-[38px] text-[12px] leading-4 text-ds-danger">
          {connectionError}
        </p>
      ) : null}
    </RemoteRow>
  )
}

/** Granted iOS devices, listed with browser clients under connected devices. */
export function MobileGrantRows({ link }: { link: MobileLink }): ReactElement[] {
  const { zh, enabled, state, busy, revoke } = link
  if (!enabled || !state) return []
  return state.grants.map((grant) => (
    <RemoteRow key={grant.id}>
      <RemoteStatusDot on />
      <RemoteRowText title={grant.name ?? grant.controllerId} subtitle={zh ? 'Kun iOS · 中继' : 'Kun iOS · relay'} />
      <button type="button" className={REMOTE_BUTTON_CLASS} disabled={Boolean(busy)} onClick={() => revoke(grant.id)}>
        {zh ? '撤销' : 'Revoke'}
      </button>
    </RemoteRow>
  ))
}
