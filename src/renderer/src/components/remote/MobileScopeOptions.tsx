import type { ReactElement } from 'react'
import type { MobileLinkScope } from '@shared/mobile-link-scopes'
export const PERSONAL_SCOPES: MobileLinkScope[] = ['personal']
const OPTIONS: Array<{ id: MobileLinkScope; zh: string; en: string }> = [
  { id: 'groups.read', zh: '阅读群组消息和成员', en: 'Read group messages and members' },
  { id: 'groups.write', zh: '发送群组消息，可触发 Agent 执行', en: 'Send group messages, including Agent execution' },
  { id: 'collaboration.read', zh: '阅读群组运行和任务状态', en: 'Read group runs and task status' },
  { id: 'schedules.read', zh: '阅读 Agent 和桌面自动运行及其历史', en: 'Read Agent and desktop schedules and their run history' },
  { id: 'extensions.read', zh: '阅读已装插件及桌面面板信息', en: 'Read installed plugins and desktop panel information' },
  { id: 'extensions.control', zh: '启用或停用已装插件（全局开关，项目覆盖保持有效）', en: 'Enable or disable installed plugins globally (project overrides remain active)' },
  { id: 'shares.manage', zh: '管理单任务跨账号共享及访客权限', en: 'Manage single-task sharing and guest permissions' }
]
export function selectMobileScope(current: MobileLinkScope[], id: MobileLinkScope, checked: boolean): MobileLinkScope[] {
  const next = new Set(current)
  next.add('personal')
  if (checked) {
    next.add(id)
    if (['groups.write', 'collaboration.read', 'collaboration.control'].includes(id)) next.add('groups.read')
    if (id === 'collaboration.control') next.add('collaboration.read')
    if (id === 'extensions.control') next.add('extensions.read')
  } else {
    next.delete(id)
    if (id === 'groups.read') for (const scope of ['groups.write', 'collaboration.read', 'collaboration.control'] as const) next.delete(scope)
    if (id === 'collaboration.read') next.delete('collaboration.control')
    if (id === 'extensions.read') next.delete('extensions.control')
  }
  return [...next]
}
export function MobileScopeOptions({ zh, value, onChange, disabled = false }: {
  zh: boolean; value: MobileLinkScope[]; onChange(scopes: MobileLinkScope[]): void; disabled?: boolean
}): ReactElement {
  return <details className="w-full rounded-lg border border-ds-border px-3 py-2 text-[12px] text-ds-muted">
    <summary className="cursor-pointer select-none text-ds-text">{zh ? '高级访问（默认关闭）' : 'Advanced access (off by default)'}</summary>
    <p className="mt-2 leading-5">{zh ? '基础访问包含这台电脑的个人 Agent 和 Code。以下权限仅在本次启动中有效，关闭访问或重新授权后清除。'
      : 'Basic access includes personal Agents and Code on this computer. These choices last until access is stopped or the device is authorized again.'}</p>
    <div className="mt-2 flex flex-col gap-2">
      {OPTIONS.map((option) => <label key={option.id} className="flex items-start gap-2">
        <input type="checkbox" checked={value.includes(option.id)} disabled={disabled}
          onChange={(event) => onChange(selectMobileScope(value, option.id, event.target.checked))} />
        <span>{zh ? option.zh : option.en}</span>
      </label>)}
    </div>
    <p className="mt-2 leading-5">{zh ? '自动运行包括 Agent 日程和桌面计划任务。插件面板目前仅显示信息，启停须单独授权。'
      : 'Schedules include Agent and desktop tasks. Plugin panels currently show information; enablement requires separate consent.'}</p>
  </details>
}
