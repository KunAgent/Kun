import { describe, expect, it } from 'vitest'
import { UI_PLUGIN_BUNDLED_SHUIMO_YIJING_ID } from '../../shared/ui-plugin'
import { createBundledUiPluginHostEffectResolver } from './shuimo-yijing-host-effect'

const STARTED_AT = new Date(2026, 1, 17, 0, 0, 0)

describe('createBundledUiPluginHostEffectResolver', () => {
  it('returns no host effect for an ordinary plugin', () => {
    const resolveHostEffect = createBundledUiPluginHostEffectResolver(STARTED_AT)

    expect(resolveHostEffect('starlight')).toBeUndefined()
  })

  it('returns stable Zhouyi content for the trusted bundled plugin', () => {
    const resolveHostEffect = createBundledUiPluginHostEffectResolver(STARTED_AT)

    expect(resolveHostEffect(UI_PLUGIN_BUNDLED_SHUIMO_YIJING_ID)).toEqual({
      kind: 'shuimo-yijing',
      hexagram: {
        ordinal: 10,
        glyph: '䷉',
        name: '履',
        statement: '虎尾不咥人亨',
        statementCommentary:
          '咥直結反○兌亦三畫卦之名一隂見於二陽之上故其德為説其象為澤履有所躡而進之義也以兌遇乾和説以躡剛强之後有履虎尾而不見傷之象故其卦為履而占如是也人能如是則處危而不傷矣',
        movingLine: 4,
        movingLineLabel: '九四',
        movingLineText: '履虎尾愬愬終吉',
        movingLineCommentary: '愬山革反音色○九四亦以不中不正履九五之剛然以剛居柔故能戒懼而得終吉'
      }
    })
  })

  it('caches and freezes the trusted host effect', () => {
    const resolveHostEffect = createBundledUiPluginHostEffectResolver(STARTED_AT)
    const first = resolveHostEffect(UI_PLUGIN_BUNDLED_SHUIMO_YIJING_ID)
    const second = resolveHostEffect(UI_PLUGIN_BUNDLED_SHUIMO_YIJING_ID)

    expect(second).toBe(first)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first?.hexagram)).toBe(true)
  })
})
