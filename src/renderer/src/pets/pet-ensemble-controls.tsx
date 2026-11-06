import { useEffect, useRef, useState, type ReactElement } from 'react'
import { AI_PET_IDS, BUILTIN_PET_IDS, KUN_PET_IDS, type BuiltinPetId } from '@shared/pets-builtin'
import { PET_SCENE_IDS, parsePetEnsemble, type PetEnsembleSettings, type PetSceneId } from '@shared/pets-ensemble'
import type { PetSummary } from '@shared/pets'
import { nextPetScene, PET_ENSEMBLE_PRESETS, PET_PERSONAS, PET_SCENES, petEnsembleText } from './pet-ensemble-catalog'
import { PetMotifIcon } from './pet-ensemble-stage'

export function PetEnsembleControls(props: {
  value: PetEnsembleSettings; pets: PetSummary[]; language: string
  onChange: (next: PetEnsembleSettings) => Promise<unknown>; onClose?: () => void
}): ReactElement {
  const { value, pets, language, onClose } = props
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const panel = useRef<HTMLDivElement>(null)
  const text = (pair: [string, string]): string => petEnsembleText(pair, language)
  const available = new Map(pets.filter((pet) => pet.source === 'kun-builtin' && pet.available && pet.spritesheetUrl).map((pet) => [pet.sourceId, pet]))
  const canPlay = value.members.every((id) => available.has(id))
  const floating = Boolean(onClose)
  useEffect(() => { if (floating) panel.current?.querySelector<HTMLButtonElement>('button')?.focus() }, [floating])
  const change = async (patch: Partial<PetEnsembleSettings>): Promise<void> => {
    if (lock.current) return
    const next = parsePetEnsemble({ ...value, ...patch })
    if (!next) return
    lock.current = true
    setPending(true)
    setError('')
    try { await props.onChange(next) }
    catch { setError(text(['保存失败，请刷新宠物列表后重试', 'Could not save. Refresh the pet library and try again.'])) }
    finally { lock.current = false; setPending(false) }
  }
  const toggle = (id: BuiltinPetId): void => {
    const members = value.members.includes(id) ? value.members.filter((member) => member !== id) : [...value.members, id]
    void change({ members })
  }
  const chips = (ids: readonly BuiltinPetId[]): ReactElement[] => ids.map((id) => {
    const pet = available.get(id)
    const checked = value.members.includes(id)
    const removable = parsePetEnsemble({ ...value, members: value.members.filter((member) => member !== id) }) !== null
    return <label key={id} className="pet-ensemble-chip" data-checked={checked} title={text(PET_PERSONAS[id].role)}>
      <input type="checkbox" checked={checked} disabled={pending || !pet || (checked && !removable)} onChange={() => toggle(id)} />
      <span style={{ color: PET_PERSONAS[id].color }}><PetMotifIcon motif={PET_PERSONAS[id].motif} /></span>
      {pet?.displayName ?? id.replace('-girl', '')}
    </label>
  })
  return <div ref={panel} className="pet-ensemble-panel" role="group" aria-label={text(['多人互动设置', 'Ensemble settings'])}
    onKeyDown={(event) => { if (event.key === 'Escape' && onClose) { event.preventDefault(); event.stopPropagation(); onClose() } }}>
    <div className="pet-ensemble-panel-heading"><strong>{text(['伙伴小剧场', 'Companion theater'])}</strong>
      <span>{PET_SCENE_IDS.length} {text(['种互动', 'scenes'])}</span>
      {onClose ? <button type="button" onClick={onClose} aria-label={text(['关闭互动设置', 'Close ensemble settings'])}>×</button> : null}
    </div>
    <p>{text(['选上 Kun 和 AI 伙伴，组成你的小分队。', 'Choose your Kun hosts and AI companions.'])}</p>
    <label className="pet-ensemble-scene-label">{text(['主题配队', 'Cast ideas'])}
      <select value="" disabled={pending} onChange={(event) => {
        const preset = PET_ENSEMBLE_PRESETS.find((entry) => entry.id === event.target.value)
        if (preset) void change({ members: [...preset.members], scene: preset.scene, paused: false })
      }}>
        <option value="">{text(['选择一组主题伙伴…', 'Choose a themed crew…'])}</option>
        {PET_ENSEMBLE_PRESETS.map((preset) => <option key={preset.id} value={preset.id}
          disabled={preset.members.some((id) => !available.has(id))}>{text(preset.title)}</option>)}
      </select>
    </label>
    <fieldset disabled={pending}><legend>{text(['领队', 'Hosts'])}</legend><div className="pet-ensemble-members">{chips(KUN_PET_IDS)}</div></fieldset>
    <fieldset disabled={pending}><legend>{text(['AI 伙伴', 'AI companions'])} · {value.members.filter((id) => (AI_PET_IDS as readonly string[]).includes(id)).length}/15</legend>
      <div className="pet-ensemble-members">{chips(AI_PET_IDS)}</div>
      <button type="button" className="pet-ensemble-text-button" onClick={() => void change({ members: BUILTIN_PET_IDS.filter((id) => available.has(id)) })}>
        {text(['全员加入', 'Invite everyone'])}
      </button>
    </fieldset>
    <label className="pet-ensemble-scene-label">{text(['互动场景', 'Scene'])}
      <select value={value.scene} disabled={pending} onChange={(event) => void change({ scene: event.target.value as PetSceneId, paused: false })}>
        {(['greet', 'play', 'work', 'life'] as const).map((group) => <optgroup key={group} label={text({
          greet: ['见面与庆祝', 'Greetings'], play: ['舞蹈与游戏', 'Play'], work: ['一起工作', 'Work'], life: ['日常与演出', 'Life']
        }[group] as [string, string])}>
          {PET_SCENE_IDS.filter((id) => PET_SCENES[id].group === group).map((id) => <option key={id} value={id}>{text(PET_SCENES[id].title)}</option>)}
        </optgroup>)}
      </select>
    </label>
    <p className="pet-ensemble-story">{text(PET_SCENES[value.scene].story)}</p>
    <label className="pet-ensemble-autoplay"><input type="checkbox" checked={value.autoplay} disabled={pending}
      onChange={(event) => void change({ autoplay: event.target.checked })} />{text(['自动轮播全部场景', 'Cycle through all scenes'])}</label>
    <div className="pet-ensemble-actions">
      <button type="button" disabled={pending || (!value.enabled && !canPlay)} className="pet-ensemble-primary"
        aria-pressed={value.enabled} onClick={() => void change({ enabled: !value.enabled, paused: false })}>
        {value.enabled ? text(['回到单宠', 'Solo pet']) : text(['开始同屏互动', 'Start ensemble'])}
      </button>
      <button type="button" disabled={pending || !value.enabled} onClick={() => void change({ paused: !value.paused })}>
        {value.paused ? text(['继续', 'Resume']) : text(['暂停', 'Pause'])}
      </button>
      <button type="button" disabled={pending} onClick={() => void change({ scene: nextPetScene(value.scene), paused: false })}>{text(['下一场', 'Next scene'])}</button>
    </div>
    {!canPlay ? <p role="status">{text(['部分成员不可用，请刷新或调整选择。', 'Some members are unavailable. Refresh or adjust the selection.'])}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </div>
}
