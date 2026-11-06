import { useRef, useState, type ReactElement } from 'react'
import { PET_SCENE_IDS, type PetSceneId } from '@shared/pets-ensemble'
import type { PetVisitPreferences } from '@shared/pets-visits'
import { PET_SCENES, petEnsembleText } from './pet-ensemble-catalog'
import './pet-visits.css'

export function PetVisitControls(props: {
  value: PetVisitPreferences; canInvite: boolean; language: string
  onPreferences: (value: PetVisitPreferences) => Promise<unknown>
  onInvite: (scene?: PetSceneId) => Promise<unknown>
}): ReactElement {
  const [scene, setScene] = useState<PetSceneId | ''>('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const text = (pair: [string, string]): string => petEnsembleText(pair, props.language)
  const run = async (action: () => Promise<unknown>): Promise<void> => {
    if (lock.current) return
    lock.current = true; setPending(true); setError('')
    try { await action() }
    catch { setError(text(['暂时没能完成，请稍后重试。', 'Could not complete this action. Please try again.'])) }
    finally { lock.current = false; setPending(false) }
  }
  return <div className="pet-visits-controls" role="group" aria-label={text(['伙伴来访', 'Visiting friends'])}>
    <p>{text(['平时只有你选的宠物。它会在合适的时候，偶尔叫一两位朋友来玩，结束后朋友就回去。',
      'Your chosen pet usually stays alone. Occasionally, it invites a few friends for a short visit, then they head home.'])}</p>
    <label>{text(['来访频率', 'Visit frequency'])}<select value={props.value.frequency} disabled={pending}
      onChange={(event) => void run(() => props.onPreferences({ ...props.value, frequency: event.target.value as PetVisitPreferences['frequency'] }))}>
      <option value="quiet">{text(['偶尔 · 约 8–14 分钟', 'Quiet · about 8–14 minutes'])}</option>
      <option value="balanced">{text(['自然 · 约 4–7 分钟', 'Natural · about 4–7 minutes'])}</option>
      <option value="lively">{text(['活泼 · 约 2–4 分钟', 'Lively · about 2–4 minutes'])}</option>
    </select></label>
    <p>{text(['输入和忙碌时会让你专心。每次来访都是一个短片段，也可能在切换模型、完成任务或长时间输入后休息时发生。',
      'Visits wait for a quiet moment. They may also follow a model change, a completed task, or a break after a long input session.'])}</p>
    <div className="pet-visits-actions">
      <button type="button" className="pet-visits-invite" disabled={pending || !props.canInvite}
        onClick={() => void run(() => props.onInvite(scene || undefined))}>{text(['现在叫朋友来玩', 'Invite friends now'])}</button>
      <button type="button" disabled={pending} aria-pressed={!props.value.enabled}
        onClick={() => void run(() => props.onPreferences({ ...props.value, enabled: !props.value.enabled }))}>
        {props.value.enabled ? text(['暂停随机来访', 'Pause random visits']) : text(['恢复随机来访', 'Resume random visits'])}
      </button>
    </div>
    <details><summary>{text(['这次想玩什么', 'Choose this visit’s activity'])}</summary>
      <label>{text(['玩法', 'Activity'])}<select value={scene} disabled={pending} onChange={(event) => setScene(event.target.value as PetSceneId | '')}>
        <option value="">{text(['让宠物自己决定', 'Let the pet decide'])}</option>
        {PET_SCENE_IDS.map((id) => <option key={id} value={id}>{text(PET_SCENES[id].title)}</option>)}
      </select></label>
    </details>
    {error ? <p role="alert">{error}</p> : null}
  </div>
}
