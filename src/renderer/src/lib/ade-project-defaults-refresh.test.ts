import { describe, expect, it } from 'vitest'
import { isAdeProjectDefaultsStaleError } from './ade-project-defaults-refresh'

describe('project defaults stale response', () => {
  it('recognizes the runtime conflict without treating other failures as stale project state', () => {
    expect(isAdeProjectDefaultsStaleError(new Error(JSON.stringify({
      code: 'project_defaults_stale', message: 'project defaults changed'
    })))).toBe(true)
    expect(isAdeProjectDefaultsStaleError(new Error('project defaults have not applied yet'))).toBe(true)
    expect(isAdeProjectDefaultsStaleError(new Error('model provider unavailable'))).toBe(false)
  })
})
