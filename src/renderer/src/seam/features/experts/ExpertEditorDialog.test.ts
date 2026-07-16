import { describe, expect, it } from 'vitest'
import { EXPERT_TEMPLATES, buildExpertCreatePayload } from './ExpertEditorDialog'

describe('ExpertEditorDialog templates', () => {
  it('offers separate expert and team samples', () => {
    expect(EXPERT_TEMPLATES.some((template) => template.kind === 'expert')).toBe(true)
    expect(EXPERT_TEMPLATES.some((template) => template.kind === 'team')).toBe(true)
  })

  it('builds a valid team request with a lead member', () => {
    const template = EXPERT_TEMPLATES.find((item) => item.kind === 'team')!
    expect(buildExpertCreatePayload(template)).toMatchObject({
      name: expect.any(String),
      workflow: expect.any(String),
      members: [expect.objectContaining({ agentName: 'lead' })]
    })
  })
})
