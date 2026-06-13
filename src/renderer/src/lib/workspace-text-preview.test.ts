import { describe, expect, it } from 'vitest'
import { isWorkspaceTextPreviewPath } from './workspace-text-preview'

describe('isWorkspaceTextPreviewPath', () => {
  it('accepts common source and markdown files', () => {
    expect(isWorkspaceTextPreviewPath('/tmp/app/src/main.ts')).toBe(true)
    expect(isWorkspaceTextPreviewPath('/tmp/app/README.md')).toBe(true)
    expect(isWorkspaceTextPreviewPath('/tmp/app/.gitignore')).toBe(true)
  })

  it('rejects common binary and media files', () => {
    expect(isWorkspaceTextPreviewPath('/tmp/app/logo.png')).toBe(false)
    expect(isWorkspaceTextPreviewPath('/tmp/app/archive.zip')).toBe(false)
    expect(isWorkspaceTextPreviewPath('/tmp/app/report.pdf')).toBe(false)
  })
})
