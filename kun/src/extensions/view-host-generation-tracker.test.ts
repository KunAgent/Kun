import { describe, expect, it } from 'vitest'
import { ExtensionViewHostGenerationTracker } from './view-host-generation-tracker.js'

describe('ExtensionViewHostGenerationTracker', () => {
  it('takes only sessions bound to the exited Host generation', () => {
    const tracker = new ExtensionViewHostGenerationTracker()
    tracker.register('view_old', 'acme.demo', undefined, 'host_old')
    tracker.register('view_other', 'acme.other', undefined, 'host_other')

    // This View was retained after the old process had already entered its
    // crashed state, while its delayed exit cleanup was still pending.
    tracker.register('view_reopened', 'acme.demo')

    expect(tracker.takeExitedGeneration('acme.demo', 'host_old')).toEqual(['view_old'])

    tracker.bindExtension('acme.demo', [], 'host_new')
    expect(tracker.takeExitedGeneration('acme.demo', 'host_old')).toEqual([])
    expect(tracker.takeExitedGeneration('acme.demo', 'host_new')).toEqual(['view_reopened'])
    expect(tracker.takeExitedGeneration('acme.other', 'host_other')).toEqual(['view_other'])
  })

  it('rebinds sessions retained across an expected Host restart', () => {
    const tracker = new ExtensionViewHostGenerationTracker()
    tracker.register('view_retained', 'acme.demo', undefined, 'host_old')

    tracker.bindExtension('acme.demo', [], 'host_new')

    expect(tracker.takeExitedGeneration('acme.demo', 'host_old')).toEqual([])
    expect(tracker.takeExitedGeneration('acme.demo', 'host_new')).toEqual(['view_retained'])
  })

  it('binds retained sessions only to the Host for their workspace', () => {
    const tracker = new ExtensionViewHostGenerationTracker()
    tracker.register('view_a', 'acme.demo', '/workspace/a')
    tracker.register('view_b', 'acme.demo', '/workspace/b')

    tracker.bindExtension('acme.demo', ['/workspace/a'], 'host_a')
    tracker.bindExtension('acme.demo', ['/workspace/b'], 'host_b')

    expect(tracker.takeExitedGeneration('acme.demo', 'host_a')).toEqual(['view_a'])
    expect(tracker.takeExitedGeneration('acme.demo', 'host_b')).toEqual(['view_b'])
  })
})
