import { describe, expect, it } from 'vitest'
import { allowsEffort, checkedProfiles, modelProfile, routeProfiles } from './model-profiles.js'

describe('mobile Code model profiles', () => {
  it('keeps wire levels in host order and drops a default outside them', () => {
    expect(modelProfile(['max', 'minimal', 'low', 'auto'], 'max')).toEqual({ efforts: ['auto', 'low', 'max'], defaultEffort: 'max' })
    expect(modelProfile(['low', 'high'], 'xhigh')).toEqual({ efforts: ['low', 'high'] })
    expect(modelProfile(['xhigh'])).toBeUndefined()
    expect(modelProfile(undefined)).toBeUndefined()
    expect(routeProfiles(['a', 'b'], () => undefined)).toEqual({})
  })

  it('withholds a description the protocol self-check refuses', () => {
    const route = { label: 'Kun', models: ['a'], profiles: { b: { efforts: ['high' as const] } } }
    expect(checkedProfiles(route)).toEqual({ label: 'Kun', models: ['a'] })
    const valid = { label: 'Kun', models: ['a'], profiles: { a: { efforts: ['high' as const] } } }
    expect(checkedProfiles(valid)).toBe(valid)
  })

  it('treats inherited object keys as unlisted models', () => {
    const route = { profiles: { a: { efforts: ['high' as const] } } }
    expect(allowsEffort(route, 'a', 'high')).toBe(true)
    expect(allowsEffort(route, 'a', undefined)).toBe(true)
    expect(allowsEffort(route, 'constructor', 'high')).toBe(false)
    expect(allowsEffort({}, 'a', 'high')).toBe(false)
  })
})
