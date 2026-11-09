import type { MobileLinkScope } from '@shared/mobile-link-scopes'
import { selectMobileScope } from './MobileScopeOptions'

/** The badge describes saved consent, never an unsaved checkbox draft. */
export function MobileDesktopScopes({ zh, value, saved, disabled, onChange }: {
  zh: boolean; value: MobileLinkScope[]; saved: MobileLinkScope[]; disabled: boolean; onChange(scopes: MobileLinkScope[]): void
}) {
  const view = saved.includes('desktop.view'), control = view && saved.includes('desktop.control')
  return <fieldset className="flex w-full flex-col gap-2 rounded-lg border border-ds-border-muted bg-ds-subtle p-2.5 text-[12px]">
    <legend className="px-1 font-medium text-ds-ink">{zh ? '内置远控权限' : 'Built-in desktop permissions'}</legend>
    <p className={view ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'} aria-live="polite">
      {control ? zh ? '已授权：查看与键鼠控制' : 'Saved: viewing and input control'
        : view ? zh ? '已授权：仅查看桌面' : 'Saved: view only'
          : zh ? '尚未授权：手机暂时不能打开内置远控' : 'Not authorized: this phone cannot open built-in desktop'}
    </p>
    <label className="flex items-center gap-2 text-ds-ink">
      <input type="checkbox" checked={value.includes('desktop.view')} disabled={disabled}
        onChange={event => onChange(selectMobileScope(value, 'desktop.view', event.target.checked))} />
      {zh ? '查看已批准显示器的桌面' : 'View the approved desktop display'}
    </label>
    <label className="flex items-center gap-2 text-ds-ink">
      <input type="checkbox" checked={value.includes('desktop.control')} disabled={disabled}
        onChange={event => onChange(selectMobileScope(value, 'desktop.control', event.target.checked))} />
      {zh ? '接管桌面的鼠标和键盘' : 'Control desktop mouse and keyboard'}
    </label>
    <p className="text-ds-muted">{zh ? '勾选后需保存。重启 Kun 或关闭手机访问后，需重新授权。' : 'Save after selecting. Reauthorize after restarting Kun or stopping phone access.'}</p>
  </fieldset>
}
