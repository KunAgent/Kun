import { describe, expect, it } from 'vitest'
import { FOLLOW_UP_API_VERSION } from '../../contracts/collaboration-followup-api.js'
import { followUpCapability } from './capability.js'

const off = { enabled: false, auto: false, github: false }
const manual = { enabled: true, auto: false, github: false }
const everything = { enabled: true, auto: true, github: true }

describe('follow-up capability negotiation', () => {
  it('advertises nothing executable while the feature is off', () => {
    expect(followUpCapability(off)).toMatchObject({
      apiVersion: FOLLOW_UP_API_VERSION,
      features: { tracking: false, manualContinuation: false, attention: false,
        sourceGrants: false, githubReader: false },
      modes: { continuation: ['manual'], newWork: ['off'] }
    })
  })

  it('offers the manual surface without the github capability', () => {
    expect(followUpCapability(manual).features).toMatchObject({
      tracking: true, manualContinuation: true, attention: true,
      sourceGrants: false, githubReader: false
    })
  })

  it('adds source consent and the reader only when the github capability is on', () => {
    expect(followUpCapability({ ...manual, github: true }).features)
      .toMatchObject({ sourceGrants: true, githubReader: true })
  })

  it('never advertises a mode it cannot execute', () => {
    // `auto` continuation and `observe` new work exist in the policy contract but have
    // no executor, so announcing them would let a client plan on work that cannot run.
    const capability = followUpCapability(everything)
    expect(capability.modes.continuation).toEqual(['manual'])
    expect(capability.modes.newWork).toEqual(['off'])
    expect(capability.apiVersion).toBe('collaboration-followup-v1')
  })
})
