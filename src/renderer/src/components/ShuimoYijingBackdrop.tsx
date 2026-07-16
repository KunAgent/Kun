import type { UiPluginHostEffect } from '@shared/ui-plugin'
import { useUiPluginStore } from '../store/ui-plugin-store'

export function ShuimoYijingBackdrop({
  effect
}: {
  effect?: UiPluginHostEffect
}): React.ReactElement | null {
  if (!effect || effect.kind !== 'shuimo-yijing') return null

  const hexagram = effect.hexagram
  return (
    <div
      aria-hidden="true"
      className="shuimo-yijing-backdrop pointer-events-none absolute inset-0 z-0 select-none overflow-hidden"
    >
      <div className="shuimo-yijing-script">
        <p className="shuimo-yijing-title">
          {hexagram.glyph}
          {hexagram.name}
        </p>
        <p>{hexagram.statement}</p>
        <p>{hexagram.statementCommentary}</p>
        <p>
          {hexagram.movingLineLabel}
          {hexagram.movingLineText}
        </p>
        <p>{hexagram.movingLineCommentary}</p>
      </div>
    </div>
  )
}

export function ActiveShuimoYijingBackdrop(): React.ReactElement | null {
  const effect = useUiPluginStore((state) => state.activeRuntime?.hostEffect)
  return <ShuimoYijingBackdrop effect={effect} />
}
