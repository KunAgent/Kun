import { EXTENSION_VIEW_SAFE_METHODS } from '@kun/extension-api'
import { describe, expect, it } from 'vitest'
import { isAllowedExtensionViewMethod } from './extension-view-methods'

describe('extension View method policy', () => {
  it('allows bounded view operations and denies credential/registration operations', () => {
    for (const method of EXTENSION_VIEW_SAFE_METHODS) {
      expect(isAllowedExtensionViewMethod(method)).toBe(true)
    }
    expect(isAllowedExtensionViewMethod('ui.getTheme')).toBe(true)
    expect(isAllowedExtensionViewMethod('ui.attachComposerContext')).toBe(true)
    expect(isAllowedExtensionViewMethod('authentication.listAccounts')).toBe(true)
    expect(isAllowedExtensionViewMethod('media.openViewResource')).toBe(true)
    expect(isAllowedExtensionViewMethod('media.performArtifactAction')).toBe(true)
    expect(isAllowedExtensionViewMethod('media.createCacheTarget')).toBe(true)
    expect(isAllowedExtensionViewMethod('media.startFfmpegJob')).toBe(true)
    expect(isAllowedExtensionViewMethod('media.getAudioAnalysisCapabilities')).toBe(true)
    expect(isAllowedExtensionViewMethod('media.startAudioAnalysisJob')).toBe(true)
    expect(isAllowedExtensionViewMethod('jobs.subscribe')).toBe(true)
    expect(isAllowedExtensionViewMethod('authentication.getSession')).toBe(false)
    expect(isAllowedExtensionViewMethod('authentication.authenticatedFetch')).toBe(false)
    expect(isAllowedExtensionViewMethod('authentication.createSession')).toBe(false)
    expect(isAllowedExtensionViewMethod('authentication.cancelSession')).toBe(false)
    expect(isAllowedExtensionViewMethod('authentication.deleteAccount')).toBe(false)
    expect(isAllowedExtensionViewMethod('authentication.revealSecret')).toBe(false)
    expect(isAllowedExtensionViewMethod('tools.register')).toBe(false)
    expect(isAllowedExtensionViewMethod('modelProviders.register')).toBe(false)
  })
})
