import type { ReactElement } from 'react'
import { Camera, Clapperboard, Grid3x3, Palette, Rotate3d, Sun, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { KUN_3D_LIGHTINGS, KUN_3D_SHADINGS, KUN_3D_VIEWS, type Kun3dLighting, type Kun3dShading, type Kun3dView } from './kun-3d-viewer'

/** The floating bar under the model: camera, shading, lighting and stage toggles. */
export function Kun3dToolbar({ disabled, view, shading, lighting, autoRotate, grid, animations, animation,
  onView, onShading, onLighting, onAutoRotate, onGrid, onAnimation }: {
  disabled: boolean; view: Kun3dView; shading: Kun3dShading; lighting: Kun3dLighting; autoRotate: boolean; grid: boolean
  animations: string[]; animation: string; onView: (view: Kun3dView) => void; onShading: (shading: Kun3dShading) => void
  onLighting: (lighting: Kun3dLighting) => void; onAutoRotate: (on: boolean) => void; onGrid: (on: boolean) => void; onAnimation: (clip: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const group = <T extends string>(Icon: LucideIcon, label: string, values: readonly T[], value: T, name: (item: T) => string,
    choose: (item: T) => void, attr: string) =>
    <div className="kun3d-tool-group" role="radiogroup" aria-label={label} title={label}>
      <Icon size={14} aria-hidden="true" />
      {values.map((item) => <button key={item} type="button" role="radio" aria-checked={value === item}
        onClick={() => choose(item)} {...{ [attr]: item }}>{name(item)}</button>)}
    </div>
  return <div className="kun3d-toolbar" data-disabled={disabled || undefined}>
    {group(Camera, t('kun3dView'), KUN_3D_VIEWS, view, (item) => t(`kun3dView_${item}`), onView, 'data-kun3d-view')}
    {group(Palette, t('kun3dShading'), KUN_3D_SHADINGS, shading, (item) => t(`kun3dShading_${item}`), onShading, 'data-kun3d-shading')}
    {group(Sun, t('kun3dLighting'), KUN_3D_LIGHTINGS, lighting, (item) => t(`kun3dLighting_${item}`), onLighting, 'data-kun3d-lighting')}
    <div className="kun3d-tool-group">
      <button type="button" className="kun3d-tool-icon" aria-pressed={autoRotate} title={t('kun3dAutoRotate')} aria-label={t('kun3dAutoRotate')}
        onClick={() => onAutoRotate(!autoRotate)} data-kun3d-auto-rotate><Rotate3d size={15} aria-hidden="true" /></button>
      <button type="button" className="kun3d-tool-icon" aria-pressed={grid} title={t('kun3dGrid')} aria-label={t('kun3dGrid')}
        onClick={() => onGrid(!grid)} data-kun3d-grid><Grid3x3 size={15} aria-hidden="true" /></button>
      {animations.length ? <label className="kun3d-tool-select" title={t('kun3dAnimation')}>
        <Clapperboard size={14} aria-hidden="true" />
        <select value={animation} onChange={(event) => onAnimation(event.target.value)} aria-label={t('kun3dAnimation')}>
          <option value="">{t('kun3dAnimationNone')}</option>
          {animations.map((clip) => <option key={clip} value={clip}>{clip}</option>)}
        </select>
      </label> : null}
    </div>
  </div>
}
