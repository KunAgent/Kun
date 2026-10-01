import { describe, expect, it } from 'vitest'
import { selectHarnessProvider } from './harness-provider-selection'
const one = { providerId: 'cursor-account', label: 'Cursor', models: ['cursor-model'] }
const two = { providerId: 'other-account', label: 'Other', models: ['other-model'] }
describe('harness source selection', () => {
  it('selects the single eligible source with its own model', () => {
    expect(selectHarnessProvider([one], undefined, { providerId: 'unrelated-http', model: 'http-model' }))
      .toEqual({ providerId: one.providerId, model: 'cursor-model' })
  })
  it('preserves an eligible selection and requires a choice for ambiguous sources', () => {
    expect(selectHarnessProvider([one, two], undefined, { providerId: two.providerId, model: 'other-model' })).toEqual({ providerId: two.providerId, model: 'other-model' })
    expect(selectHarnessProvider([one, two], undefined, {})).toEqual({ providerId: '', model: '' })
  })
  it('honors saved defaults and does not silently substitute a removed default source', () => {
    expect(selectHarnessProvider([one, two], { providerId: two.providerId, model: 'custom' }, {})).toEqual({ providerId: two.providerId, model: 'custom' })
    expect(selectHarnessProvider([one], { providerId: 'removed', model: 'old' }, {})).toEqual({ providerId: '', model: '' })
  })
})
