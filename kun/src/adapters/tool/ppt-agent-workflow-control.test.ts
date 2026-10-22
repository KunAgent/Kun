import { describe, expect, it } from 'vitest'
import {
  blocksPptExport,
  effectivePptProviderId,
  initialPptPreviewMode,
  managedPptProviderUnavailable,
  pptGeneratedImagesAllowed,
  pptImageAssetInstruction,
  pptImageAssetState,
  visualWorkflowInstruction
} from './ppt-agent-workflow-control.js'

describe('PPT agent workflow control', () => {
  it('handles the implicit default provider alias in the managed-tool preflight', () => {
    const config = { defaultProviderLacksManagedTools: true }
    expect(managedPptProviderUnavailable(config, undefined)).toBe(true)
    expect(managedPptProviderUnavailable(config, ' DEFAULT ')).toBe(true)
    expect(managedPptProviderUnavailable(config, 'deepseek')).toBe(false)
  })

  it('resolves a complete Lab model override before inherited provider routes', () => {
    const config = {
      model: 'claude-sonnet',
      providerId: ' cursor-lab ',
      toolIncompatibleProviderIds: ['cursor-lab']
    }
    const providerId = effectivePptProviderId(
      config,
      {
        actingModelRoute: { providerId: 'acting-provider', model: 'acting-model' },
        modelProviderId: 'session-provider'
      }
    )
    expect(providerId).toBe('cursor-lab')
    expect(managedPptProviderUnavailable(config, providerId)).toBe(true)
    expect(effectivePptProviderId(
      { providerId: 'incomplete-lab-override' },
      {
        actingModelRoute: { providerId: 'acting-provider', model: 'acting-model' },
        modelProviderId: 'session-provider'
      }
    )).toBe('acting-provider')
  })

  it('resolves the acting route before the inherited model provider and preserves default', () => {
    const config = { toolIncompatibleProviderIds: ['cursor-acting', 'cursor-session'] }
    const actingProvider = effectivePptProviderId(
      config,
      {
        actingModelRoute: { providerId: 'cursor-acting', model: 'cursor-model' },
        modelProviderId: 'cursor-session'
      }
    )
    const inheritedProvider = effectivePptProviderId(
      config,
      { modelProviderId: ' cursor-session ' }
    )
    expect(actingProvider).toBe('cursor-acting')
    expect(inheritedProvider).toBe('cursor-session')
    expect(managedPptProviderUnavailable(config, actingProvider)).toBe(true)
    expect(managedPptProviderUnavailable(config, inheritedProvider)).toBe(true)
    expect(effectivePptProviderId({}, { modelProviderId: ' default ' })).toBe('default')
    expect(effectivePptProviderId({}, {})).toBeUndefined()
  })

  it('fails closed for configured Cursor providers despite case or surrounding whitespace', () => {
    const config = { toolIncompatibleProviderIds: ['antigravity', ' Cursor-Lab '] }
    expect(managedPptProviderUnavailable(config, 'cursor-lab')).toBe(true)
    expect(managedPptProviderUnavailable(config, ' CURSOR-LAB ')).toBe(true)
    expect(managedPptProviderUnavailable(config, 'deepseek')).toBe(false)
  })

  it('blocks export throughout review and opens it only after approval', () => {
    expect(blocksPptExport('start')).toBe(true)
    expect(blocksPptExport('revise_previews')).toBe(true)
    expect(blocksPptExport('retry_failed')).toBe(true)
    expect(blocksPptExport('approve_and_build')).toBe(false)
  })

  it('starts every new deck as an editable PPTD review rendered by the host', () => {
    expect(initialPptPreviewMode()).toBe('editable')
    const started = visualWorkflowInstruction(
      { imageGenAvailable: false }, 'editable', 'start', 'ppt_workflow', 'thr_parent', '.kun/ppt/ppt_workflow', false
    )
    const revised = visualWorkflowInstruction(
      {}, 'editable', 'revise_previews', 'ppt_workflow', 'thr_parent', '.kun/ppt/ppt_workflow', true
    )

    expect(started).toContain('ppt_generate_previews')
    expect(started).toContain('the host renders every page itself')
    expect(started).toContain('stop at awaiting_review')
    expect(started).not.toContain('generate_image')
    expect(revised).toContain('PPT EDITABLE REVIEW FOLLOW-UP')
    expect(revised).toContain('refill only that image slot')
  })

  it('compares visual directions through rendered sample decks, never generated images', () => {
    const instruction = visualWorkflowInstruction(
      { imageGenAvailable: true }, 'editable', 'start', 'ppt_workflow', 'thr_parent', '.kun/ppt/ppt_workflow', false, true
    )
    expect(instruction).toContain('.kun/ppt/ppt_workflow/directions/<candidate-slug>/')
    expect(instruction).toContain('sampleProject')
    expect(instruction).toContain('no image generation is needed')
    expect(instruction).not.toMatch(/call generate_image/)
    expect(pptGeneratedImagesAllowed({ imageGenAvailable: true }, 'editable', 'direction')).toBe(false)
    expect(pptImageAssetInstruction({ imageGenAvailable: true }, 'editable', 'direction'))
      .toContain('Do not call generate_image for samples')
  })

  it('treats generated images as optional slot assets', () => {
    const available = { imageGenAvailable: true }
    expect(pptGeneratedImagesAllowed(available, 'editable', 'review')).toBe(true)
    expect(pptImageAssetState(available)).toBe('enabled')
    expect(pptImageAssetInstruction(available, 'editable', 'review')).toMatch(/user's relevant material.*generate_image asset.*six per deck/)

    const off = { imageGenAvailable: true, imageAssets: false }
    expect(pptGeneratedImagesAllowed(off, 'editable', 'review')).toBe(false)
    expect(pptImageAssetState(off)).toBe('disabled')
    expect(pptImageAssetInstruction(off, 'editable', 'build')).toContain('turned off in Lab settings')

    const missing = { imageGenAvailable: false, imageGenReason: 'no image model' }
    expect(pptImageAssetState(missing)).toBe('unavailable')
    expect(pptImageAssetInstruction(missing, 'editable', 'review')).toContain('unavailable (no image model): do not call generate_image')
  })

  it('keeps legacy image-first reviews on their whole-page path', () => {
    expect(pptGeneratedImagesAllowed({ imageGenAvailable: true, imageAssets: false }, 'image-first', 'review')).toBe(true)
    expect(pptImageAssetInstruction({ imageGenAvailable: true }, 'image-first', 'review')).toBe('')
    const instruction = visualWorkflowInstruction(
      {}, 'image-first', 'approve_and_build',
      'ppt_workflow', 'thr_parent', '.kun/ppt/ppt_workflow', true
    )
    expect(instruction).toContain('ppt_import_asset')
    expect(instruction).toContain('native editable PPTD')
  })

  it('finalizes the reviewed editable deck in place on approval', () => {
    const instruction = visualWorkflowInstruction(
      {}, 'editable', 'approve_and_build',
      'ppt_workflow', 'thr_parent', '.kun/ppt/ppt_workflow', true
    )
    expect(instruction).toContain('do not rebuild it from preview images')
  })
})
