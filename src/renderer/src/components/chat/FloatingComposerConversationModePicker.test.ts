import { describe, expect, it } from 'vitest'
import { buildActiveExpertOptions } from './FloatingComposerConversationModePicker'

describe('buildActiveExpertOptions', () => {
  it('keeps expert and team queues independent and bounded at five', () => {
    const experts = Array.from({ length: 6 }, (_, index) => ({ id: `e${index + 1}`, displayName: `Expert ${index + 1}` }))
    const teams = Array.from({ length: 6 }, (_, index) => ({ id: `t${index + 1}`, displayName: `Team ${index + 1}` }))

    const options = buildActiveExpertOptions(experts, teams, {
      activeExpertIds: experts.map((item) => item.id),
      activeTeamIds: teams.map((item) => item.id)
    })

    expect(options.filter((item) => item.kind === 'expert').map((item) => item.id)).toEqual(['e2', 'e3', 'e4', 'e5', 'e6'])
    expect(options.filter((item) => item.kind === 'team').map((item) => item.id)).toEqual(['t2', 't3', 't4', 't5', 't6'])
  })
})
