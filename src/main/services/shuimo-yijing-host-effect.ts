import type { UiPluginHostEffect } from '../../shared/ui-plugin'
import { UI_PLUGIN_BUNDLED_SHUIMO_YIJING_ID } from '../../shared/ui-plugin'
import { calculateStartupHexagram } from './shuimo-yijing-hexagram'
import { zhouyiBenyiFor } from './zhouyi-benyi'

export function createBundledUiPluginHostEffectResolver(
  startedAt: Date
): (id: string) => UiPluginHostEffect | undefined {
  let cachedEffect: UiPluginHostEffect | undefined

  return (id) => {
    if (id !== UI_PLUGIN_BUNDLED_SHUIMO_YIJING_ID) return undefined
    if (cachedEffect) return cachedEffect

    const calculated = calculateStartupHexagram(startedAt)
    const hexagram = zhouyiBenyiFor(calculated.ordinal)
    const movingLine = hexagram.lines[calculated.movingLine - 1]
    if (!movingLine) {
      throw new Error(
        `Zhouyi Benyi hexagram ${calculated.ordinal} has no line ${calculated.movingLine}`
      )
    }

    cachedEffect = Object.freeze({
      kind: 'shuimo-yijing',
      hexagram: Object.freeze({
        ordinal: calculated.ordinal,
        glyph: hexagram.glyph,
        name: hexagram.name,
        statement: hexagram.statement,
        statementCommentary: hexagram.statementCommentary,
        movingLine: calculated.movingLine,
        movingLineLabel: movingLine.label,
        movingLineText: movingLine.text,
        movingLineCommentary: movingLine.commentary
      })
    })

    return cachedEffect
  }
}

const SHUIMO_YIJING_STARTED_AT = new Date()

export const resolveBundledUiPluginHostEffect =
  createBundledUiPluginHostEffectResolver(SHUIMO_YIJING_STARTED_AT)
