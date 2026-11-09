import { useEffect, useState, type ReactElement } from 'react'
import type { PetDesktopBridge, PetSettings } from '@shared/pets'
import { defaultPetGlobalActivity, type PetGlobalActivityState, type PetGlobalActivityStatus } from '@shared/pets-global-activity'
import { settingsButtonClass } from './settings-button'

export function SettingsPetGlobalActivity({ api, settings, language }: {
  api: PetDesktopBridge; settings: PetSettings | null; language: string
}): ReactElement {
  const zh = language.startsWith('zh')
  const text = (cn: string, en: string): string => zh ? cn : en
  const [status, setStatus] = useState<PetGlobalActivityStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pendingMicrophone, setPendingMicrophone] = useState<boolean | null>(null)
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
    paused: text('显示宠物后自动跟随', 'Follows automatically when the pet is visible'),
    'permission-required': text('需要输入监控权限', 'Input Monitoring permission needed'),
    unsupported: text('当前系统不支持', 'Unavailable on this system'),
    unavailable: text('暂不可用，请收起宠物后重新唤醒', 'Unavailable; hide and wake the pet to retry')
  }
  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true); setError('')
    try { await action(); setStatus(await api.getPetGlobalActivityStatus()) }
    catch { setError(text('设置失败，请重试', 'Unable to update settings. Please retry.')) }
    finally { setBusy(false) }
  }
  // The saved preference is the source of truth; keep the checkbox responsive
  // until the settings round-trip lands.
  const microphoneEnabled = pendingMicrophone ??
    settings?.globalActivity?.microphone ?? defaultPetGlobalActivity().microphone
  const setMicrophone = (enabled: boolean): void => {
    setPendingMicrophone(enabled)
    void run(async () => {
      await api.setPetGlobalActivity({ ...(settings?.globalActivity ?? defaultPetGlobalActivity()), microphone: enabled })
    }).finally(() => { setPendingMicrophone(null) })
  }
  return <div className="pets-settings-section">
    <h3>{text('自动陪伴', 'Automatic companionship')}</h3>
    <p className="pets-settings-note">{text('宠物会自动回应打字、语音与掉落动作。只感知活动状态，不读取输入文字，也不录音。',
      'Your pet automatically reacts to typing, voice and bottle drops. Only activity states are observed; no text or audio is collected.')}</p>
    {status ? <div className="pets-settings-activity-row" role="status">
      <span>{text('跟随系统打字', 'Typing across apps')}</span>
      <span>{labels[status.keyboard]}</span>
    </div> : null}
    {status?.keyboard === 'permission-required' ?
      <button type="button" className={settingsButtonClass({ variant: 'ghost', size: 'compact' })} disabled={busy}
        onClick={() => void run(() => api.requestPetKeyboardAccess())}>
        {text('授权系统输入监控', 'Allow Input Monitoring')}
      </button> : null}
    <label className="pets-settings-toggle">
      <input type="checkbox" checked={microphoneEnabled} disabled={busy}
        onChange={(event) => setMicrophone(event.target.checked)} />
      {text('跟随其他软件的录音状态', 'Follow recording in other apps')}
    </label>
    {status ? <div className="pets-settings-activity-row" role="status">
      <span>{text('录音状态', 'Recording state')}</span>
      <span>{status.recording ? text('有软件正在录音，宠物正在倾听', 'Recording detected; your pet is listening') : labels[status.microphone]}</span>
    </div> : null}
    <p className="pets-settings-note">{text('系统打字联动支持 macOS；录音状态联动需要 macOS 14.2 或更新版本，默认关闭。它只读取系统当前的录音状态，不会打开或录制麦克风。',
      'Typing activity is supported on macOS. Recording status requires macOS 14.2 or later and is off by default; it only reads the system recording state and never opens or records your microphone.')}</p>
    {error ? <p role="alert">{error}</p> : null}
  </div>
}
