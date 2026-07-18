import { Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  CanvasMotionEasing,
  CanvasMotionKeyframe,
  CanvasMotionTrack
} from '../../../design/motion'

type KeyframePatch = Partial<Pick<CanvasMotionKeyframe, 'timeMs' | 'value' | 'easing'>>

type Props = {
  track: CanvasMotionTrack
  keyframe: CanvasMotionKeyframe | undefined
  targetLabel: string
  onDeleteTrack: () => void
  onUpdateKeyframe: (patch: KeyframePatch) => void
  onDeleteKeyframe: () => void
  onAddKeyframe: () => void
}

function easingFromType(type: string): CanvasMotionEasing {
  switch (type) {
    case 'ease-in': return { type: 'ease-in' }
    case 'ease-out': return { type: 'ease-out' }
    case 'ease-in-out': return { type: 'ease-in-out' }
    case 'hold': return { type: 'hold' }
    case 'cubic-bezier': return { type: 'cubic-bezier', x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 }
    case 'spring': return { type: 'spring', mass: 1, stiffness: 100, damping: 10 }
    default: return { type: 'linear' }
  }
}

export function CanvasMotionKeyframeInspector({
  track,
  keyframe,
  targetLabel,
  onDeleteTrack,
  onUpdateKeyframe,
  onDeleteKeyframe,
  onAddKeyframe
}: Props) {
  const { t } = useTranslation('common')
  const easing = keyframe?.easing
  return (
    <aside className="w-[178px] shrink-0 border-l border-ds-border-muted px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[10.5px] font-medium text-ds-ink">{track.property}</div>
          <div className="truncate text-[9px] text-ds-faint">{targetLabel}</div>
        </div>
        <button
          type="button"
          className="grid h-6 w-6 place-items-center rounded-[6px] text-ds-faint hover:bg-red-500/10 hover:text-red-500"
          onClick={onDeleteTrack}
          title={t('canvasMotionDeleteTrack', 'Delete track')}
          aria-label={t('canvasMotionDeleteTrack', 'Delete track')}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      {keyframe ? (
        <div className="mt-2 space-y-1.5">
          <label className="grid grid-cols-[42px_1fr] items-center gap-1 text-[9.5px] text-ds-faint">
            <span>Time</span>
            <input
              key={`${keyframe.id}:time:${keyframe.timeMs}`}
              type="number"
              min={0}
              defaultValue={Math.round(keyframe.timeMs)}
              onBlur={(event) => onUpdateKeyframe({ timeMs: Number(event.target.value) })}
              className="h-7 min-w-0 rounded-[7px] bg-ds-hover/50 px-2 text-[10.5px] tabular-nums text-ds-ink outline-none"
            />
          </label>
          <label className="grid grid-cols-[42px_1fr] items-center gap-1 text-[9.5px] text-ds-faint">
            <span>Value</span>
            <input
              key={`${keyframe.id}:value:${keyframe.value}`}
              type="number"
              step="any"
              defaultValue={keyframe.value}
              onBlur={(event) => onUpdateKeyframe({ value: Number(event.target.value) })}
              className="h-7 min-w-0 rounded-[7px] bg-ds-hover/50 px-2 text-[10.5px] tabular-nums text-ds-ink outline-none"
            />
          </label>
          <label className="grid grid-cols-[42px_1fr] items-center gap-1 text-[9.5px] text-ds-faint">
            <span>Ease</span>
            <select
              value={keyframe.easing.type}
              onChange={(event) => onUpdateKeyframe({ easing: easingFromType(event.target.value) })}
              className="h-7 min-w-0 rounded-[7px] bg-ds-hover/50 px-1.5 text-[10px] text-ds-ink outline-none"
            >
              <option value="linear">Linear</option>
              <option value="ease-in">Ease in</option>
              <option value="ease-out">Ease out</option>
              <option value="ease-in-out">Ease in out</option>
              <option value="hold">Hold</option>
              <option value="cubic-bezier">Bezier</option>
              <option value="spring">Spring</option>
            </select>
          </label>
          {easing?.type === 'cubic-bezier' ? (
            <div className="grid grid-cols-4 gap-1" aria-label="Cubic bezier controls">
              {(['x1', 'y1', 'x2', 'y2'] as const).map((field) => (
                <label key={field} className="min-w-0 text-[8.5px] text-ds-faint">
                  {field}
                  <input
                    key={`${keyframe.id}:${field}:${easing[field]}`}
                    type="number"
                    step={0.05}
                    defaultValue={easing[field]}
                    onBlur={(event) => onUpdateKeyframe({
                      easing: { ...easing, [field]: Number(event.target.value) }
                    })}
                    className="mt-0.5 h-6 w-full rounded-[6px] bg-ds-hover/50 px-1 text-[9px] tabular-nums text-ds-ink outline-none"
                  />
                </label>
              ))}
            </div>
          ) : null}
          {easing?.type === 'spring' ? (
            <div className="grid grid-cols-4 gap-1" aria-label="Spring controls">
              {([
                ['mass', 'M'],
                ['stiffness', 'K'],
                ['damping', 'D'],
                ['initialVelocity', 'V₀']
              ] as const).map(([field, label]) => (
                <label key={field} className="min-w-0 text-[8.5px] text-ds-faint">
                  {label}
                  <input
                    key={`${keyframe.id}:${field}:${easing[field]}`}
                    type="number"
                    min={field === 'initialVelocity' ? undefined : field === 'damping' ? 0 : 0.0001}
                    step={field === 'mass' || field === 'initialVelocity' ? 0.1 : 1}
                    defaultValue={easing[field] ?? 0}
                    onBlur={(event) => onUpdateKeyframe({
                      easing: { ...easing, [field]: Number(event.target.value) }
                    })}
                    className="mt-0.5 h-6 w-full rounded-[6px] bg-ds-hover/50 px-1 text-[9px] tabular-nums text-ds-ink outline-none"
                  />
                </label>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            className="mt-1 flex h-7 w-full items-center justify-center gap-1 rounded-[7px] bg-red-500/8 text-[10px] text-red-500 hover:bg-red-500/14"
            onClick={onDeleteKeyframe}
          >
            <Trash2 className="h-3 w-3" /> Delete keyframe
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="mt-3 flex h-7 w-full items-center justify-center gap-1 rounded-[7px] bg-ds-hover/50 text-[10px] text-ds-muted hover:text-ds-ink"
          onClick={onAddKeyframe}
        >
          <Plus className="h-3 w-3" /> Add keyframe
        </button>
      )}
    </aside>
  )
}
