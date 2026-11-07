import { useEffect, useState, type ReactElement } from 'react'
import type { PetDesktopBridge, PetSettings } from '@shared/pets'
import { defaultPetGlobalActivity, type PetGlobalActivityState, type PetGlobalActivityStatus } from '@shared/pets-global-activity'
import { settingsButtonClass } from './settings-button'

export function SettingsPetGlobalActivity({ api, settings, language, onSettings }: {
  api: PetDesktopBridge; settings: PetSettings | null; language: string; onSettings: (settings: PetSettings) => void
}): ReactElement {
  const zh = language.startsWith('zh')
  const text = (cn: string, en: string): string => zh ? cn : en
  const [status, setStatus] = useState<PetGlobalActivityStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const preferences = settings?.globalActivity ?? defaultPetGlobalActivity()
  useEffect(() => {
    let cancelled = false
    const refresh = (): void => {
      void api.getPetGlobalActivityStatus().then((value) => { if (!cancelled) setStatus(value) })
        .catch(() => { if (!cancelled) setError(zh ? '无法读取系统联动状态' : 'Unable to read activity status') })
    }
    refresh()
    const timer = window.setInterval(refresh, 2000)
    window.addEventListener('focus', refresh)
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [api, settings, zh])
  const labels: Record<PetGlobalActivityState, string> = {
    off: text('未开启', 'Off'), starting: text('正在连接', 'Connecting'), active: text('已就绪', 'Ready'),
    paused: text('显示宠物并开启动作反馈后生效', 'Active when the pet and reactions are on'),
    'permission-required': text('需要输入监控权限', 'Input Monitoring permission needed'),
    unsupported: text('当前系统不支持', 'Unavailable on this system'),
    unavailable: text('暂不可用，可关闭后重新开启', 'Unavailable; turn off and on to retry')
  }
  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true); setError('')
    try { await action(); setStatus(await api.getPetGlobalActivityStatus()) }
    catch { setError(text('设置失败，请重试', 'Unable to update settings. Please retry.')) }
    finally { setBusy(false) }
  }
  return <div className="pets-settings-section">
    <h3>{text('应用外的陪伴', 'Companion across apps')}</h3>
    <p className="pets-settings-note">{text('在其他软件里打字、录音时，宠物也会回应。只感知活动状态，不读取输入文字，不录音。',
      'Your pet reacts to typing and recording in other apps. Only activity states are observed; no text or audio is collected.')}</p>
    <label className="pets-settings-toggle">
      <input type="checkbox" checked={preferences.keyboard} disabled={busy || !settings}
        onChange={(event) => { const keyboard = event.target.checked; void run(async () => onSettings(await api.setPetGlobalActivity({ ...preferences, keyboard }))) }} />
      {text('跟随系统打字', 'React to typing across apps')}
    </label>
    {preferences.keyboard && status ? <p className="pets-settings-note" role="status">{labels[status.keyboard]}</p> : null}
    {preferences.keyboard && status && ['permission-required', 'paused', 'unavailable'].includes(status.keyboard) ?
      <button type="button" className={settingsButtonClass({ variant: 'ghost', size: 'compact' })} disabled={busy}
        onClick={() => void run(() => api.requestPetKeyboardAccess())}>
        {text('授权系统输入监控', 'Allow Input Monitoring')}
      </button> : null}
    <label className="pets-settings-toggle">
      <input type="checkbox" checked={preferences.microphone} disabled={busy || !settings}
        onChange={(event) => { const microphone = event.target.checked; void run(async () => onSettings(await api.setPetGlobalActivity({ ...preferences, microphone }))) }} />
      {text('跟随其他软件的录音状态', 'React to recording in other apps')}
    </label>
    <p className="pets-settings-note">{text('系统打字联动支持 macOS；录音状态联动需要 macOS 14.2 或更新版本，不会额外启用麦克风。',
      'Typing activity is supported on macOS. Recording status requires macOS 14.2 or later and does not turn on your microphone.')}</p>
    {preferences.microphone && status ? <p className="pets-settings-note" role="status">{
      status.recording ? text('有软件正在录音，宠物正在倾听', 'Recording detected; your pet is listening') : labels[status.microphone]
    }</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </div>
}
