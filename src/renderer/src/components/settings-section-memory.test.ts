import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CoreMemoryRecordJson } from '../agent/kun-contract'
import {
  MemorySettingsSection,
  attemptCloseMemoryDialog,
  isMemoryDraftDirty,
  serializeMemoryTags,
  type MemoryDialogState,
  type MemoryDraft
} from './settings-section-memory'

const labels: Record<string, string> = {
  sectionMemory: 'Long-term memory',
  memoryEnable: 'Enable memory',
  memoryEnableDesc: 'Enable memory description',
  memoryOverview: 'Overview',
  memoryOverviewDesc: 'Overview description',
  memoryActiveCount: 'Active',
  memoryTombstoneCount: 'Deleted',
  memoryEnabled: 'Status',
  memoryOn: 'On',
  memoryOff: 'Off',
  memoryRecords: 'Memory records',
  memoryRecordsDesc: 'Memory records description',
  memoryDisabledHint: 'Memory disabled',
  memoryScope_all: 'All',
  memoryScope_user: 'User',
  memoryScope_workspace: 'Workspace',
  memoryScope_project: 'Project',
  memoryCreate: 'New',
  memoryCreateTitle: 'Create memory',
  memoryEditTitle: 'Edit memory',
  memoryContentPlaceholder: 'Memory content',
  memoryTagsPlaceholder: 'Tags',
  memoryConfidence: 'Confidence',
  memoryCancel: 'Cancel',
  memorySave: 'Save',
  memoryEmpty: 'No memory records',
  memoryEdit: 'Edit',
  memoryDetails: 'Details',
  memoryClose: 'Close',
  memoryDisable: 'Disable',
  memoryDelete: 'Delete',
  memoryDisabled: 'Disabled',
  memoryProject: 'Project',
  memoryLastInjected: 'Last injected',
  memoryLastInjectedDesc: 'Last injected description',
  memoryDiscardConfirm: 'Discard unsaved changes?',
  memoryDiscardConfirmDetail: 'Your edits will be lost.',
  memoryDiscardConfirmAction: 'Discard',
  memoryDiscardCancel: 'Keep editing'
}

function baseCtx(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    t: (key: string) => labels[key] ?? key,
    kun: { memoryEnabled: true },
    updateKun: () => undefined,
    memoryDiagnostics: {
      enabled: true,
      activeCount: 1,
      tombstoneCount: 0,
      lastInjectedIds: []
    },
    memoryRecords: [],
    createMemoryRecord: async () => true,
    updateMemoryRecord: async () => true,
    disableMemoryRecord: async () => undefined,
    deleteMemoryRecord: async () => undefined,
    ...overrides
  }
}

function sampleRecord(overrides: Partial<CoreMemoryRecordJson> = {}): CoreMemoryRecordJson {
  return {
    id: 'mem_sample1234',
    content: 'Remember the project overview',
    scope: 'workspace',
    workspace: '/Users/mothra/data/code/kook-bot',
    tags: ['summary', 'kook-bot'],
    confidence: 1,
    createdAt: '2026-06-21T00:00:00.000Z',
    updatedAt: '2026-06-21T00:00:00.000Z',
    ...overrides
  } as CoreMemoryRecordJson
}

describe('MemorySettingsSection', () => {
  it('renders a compact list row with tags and the scoped directory', () => {
    const projectPath = '/Users/mothra/data/code/kook-bot'
    const html = renderToStaticMarkup(createElement(MemorySettingsSection, {
      ctx: baseCtx({
        memoryRecords: [
          {
            id: 'mem_mqns1234',
            content: 'Remember the project overview',
            scope: 'project',
            project: projectPath,
            tags: ['project-overview', 'kook-bot'],
            confidence: 1,
            createdAt: '2026-06-21T00:00:00.000Z',
            updatedAt: '2026-06-21T00:00:00.000Z'
          }
        ]
      })
    }))

    expect(html).toContain('Details')
    expect(html).toContain('Project')
    expect(html).toContain(projectPath)
    expect(html).toContain('project-overview')
  })

  it('truncates long memory content in the default list view body (not in the title attribute)', () => {
    const hiddenTail = 'this tail should only appear inside the details dialog'
    const content = `${'Long memory content '.repeat(12)}${hiddenTail}`
    const html = renderToStaticMarkup(createElement(MemorySettingsSection, {
      ctx: baseCtx({
        memoryRecords: [
          {
            id: 'mem_long1234',
            content,
            scope: 'workspace',
            workspace: '/Users/mothra/data/code/kook-bot',
            tags: ['summary'],
            confidence: 1,
            createdAt: '2026-06-21T00:00:00.000Z',
            updatedAt: '2026-06-21T00:00:00.000Z'
          }
        ]
      })
    }))

    expect(html).toContain('Long memory content')
    // The tail must not be present in any visible text node — only inside the
    // title="…" attribute we add for accessibility / hover tooltips.
    const visibleText = html.replace(/title="[^"]*"/g, '')
    expect(visibleText).not.toContain(hiddenTail)
  })

  it('exposes the full memory content via the row title attribute (a11y / hover tooltip)', () => {
    const hiddenTail = 'this tail should only appear inside the details dialog'
    const content = `${'Long memory content '.repeat(12)}${hiddenTail}`
    const html = renderToStaticMarkup(createElement(MemorySettingsSection, {
      ctx: baseCtx({
        memoryRecords: [
          {
            id: 'mem_long1234',
            content,
            scope: 'workspace',
            workspace: '/Users/mothra/data/code/kook-bot',
            tags: ['summary'],
            confidence: 1,
            createdAt: '2026-06-21T00:00:00.000Z',
            updatedAt: '2026-06-21T00:00:00.000Z'
          }
        ]
      })
    }))

    // The visible body is truncated, but the title attribute hands the full content
    // to screen readers / hover tooltips.
    const titleAttrPattern = /title="[^"]*this tail should only appear inside the details dialog[^"]*"/
    expect(html).toMatch(titleAttrPattern)
  })
})

describe('serializeMemoryTags', () => {
  it('returns an empty string for nullish / empty input', () => {
    expect(serializeMemoryTags(undefined)).toBe('')
    expect(serializeMemoryTags(null)).toBe('')
    expect(serializeMemoryTags([])).toBe('')
  })

  it('trims and joins tags with a stable separator', () => {
    expect(serializeMemoryTags(['alpha', '  beta', 'gamma '])).toBe('alpha, beta, gamma')
  })

  it('drops empty tag entries', () => {
    expect(serializeMemoryTags(['alpha', '', '  ', 'beta'])).toBe('alpha, beta')
  })
})

describe('isMemoryDraftDirty', () => {
  it('returns false in view mode regardless of draft', () => {
    const record = sampleRecord()
    const dialog: MemoryDialogState = { mode: 'view', memory: record }
    const draft: MemoryDraft = { content: 'totally different', scope: 'user', targetPath: '', tags: 'x', confidence: 0 }
    expect(isMemoryDraftDirty(dialog, draft)).toBe(false)
  })

  it('returns false in edit mode when the draft mirrors the original record', () => {
    const record = sampleRecord({ tags: ['summary', 'kook-bot'] })
    const dialog: MemoryDialogState = { mode: 'edit', memory: record }
    const draft: MemoryDraft = {
      content: record.content,
      scope: record.scope,
      targetPath: record.workspace ?? '',
      tags: 'summary, kook-bot',
      confidence: record.confidence ?? 1
    }
    expect(isMemoryDraftDirty(dialog, draft)).toBe(false)
  })

  it('returns true in edit mode when content / scope / tags differ', () => {
    const record = sampleRecord({ tags: ['summary'] })
    const dialog: MemoryDialogState = { mode: 'edit', memory: record }
    const baseline: MemoryDraft = {
      content: record.content,
      scope: record.scope,
      targetPath: record.workspace ?? '',
      tags: 'summary',
      confidence: 1
    }
    expect(isMemoryDraftDirty(dialog, { ...baseline, content: 'edited' })).toBe(true)
    expect(isMemoryDraftDirty(dialog, { ...baseline, scope: 'user' })).toBe(true)
    expect(isMemoryDraftDirty(dialog, { ...baseline, tags: 'summary, extra' })).toBe(true)
  })

  it('returns false in create mode for an empty draft on the default scope', () => {
    const dialog: MemoryDialogState = { mode: 'create' }
    const draft: MemoryDraft = { content: '   ', scope: 'workspace', targetPath: '', tags: '   ', confidence: 1 }
    expect(isMemoryDraftDirty(dialog, draft)).toBe(false)
  })

  it('returns true in create mode when any field changes from the empty default', () => {
    const dialog: MemoryDialogState = { mode: 'create' }
    expect(isMemoryDraftDirty(dialog, { content: 'hello', scope: 'workspace', targetPath: '', tags: '', confidence: 1 })).toBe(true)
    expect(isMemoryDraftDirty(dialog, { content: '', scope: 'workspace', targetPath: '', tags: 'tag', confidence: 1 })).toBe(true)
    expect(isMemoryDraftDirty(dialog, { content: '', scope: 'user', targetPath: '', tags: '', confidence: 1 })).toBe(true)
  })
})

describe('attemptCloseMemoryDialog', () => {
  it('closes immediately and never prompts when the draft is clean', async () => {
    const record = sampleRecord({ tags: ['summary'] })
    const dialog: MemoryDialogState = { mode: 'edit', memory: record }
    const draft: MemoryDraft = {
      content: record.content,
      scope: record.scope,
      targetPath: record.workspace ?? '',
      tags: 'summary',
      confidence: 1
    }
    const confirm = vi.fn(async () => false)
    const close = vi.fn()
    const result = await attemptCloseMemoryDialog({ dialog, draft, confirm, close })
    expect(result).toEqual({ prompted: false, closed: true })
    expect(confirm).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('closes immediately when there is no dialog open (defensive)', async () => {
    const confirm = vi.fn(async () => false)
    const close = vi.fn()
    const result = await attemptCloseMemoryDialog({
      dialog: null,
      draft: { content: 'anything', scope: 'workspace', targetPath: '', tags: '', confidence: 1 },
      confirm,
      close
    })
    expect(result).toEqual({ prompted: false, closed: true })
    expect(confirm).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('prompts on dirty close and stays open when the user keeps editing', async () => {
    const record = sampleRecord({ tags: ['summary'] })
    const dialog: MemoryDialogState = { mode: 'edit', memory: record }
    const draft: MemoryDraft = {
      content: 'EDITED content',
      scope: record.scope,
      targetPath: record.workspace ?? '',
      tags: 'summary',
      confidence: 1
    }
    const confirm = vi.fn(async () => false)
    const close = vi.fn()
    const result = await attemptCloseMemoryDialog({ dialog, draft, confirm, close })
    expect(result).toEqual({ prompted: true, closed: false })
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(close).not.toHaveBeenCalled()
  })

  it('prompts on dirty close and closes when the user confirms discard', async () => {
    const dialog: MemoryDialogState = { mode: 'create' }
    const draft: MemoryDraft = {
      content: 'half-typed thought',
      scope: 'workspace',
      targetPath: '',
      tags: '',
      confidence: 1
    }
    const confirm = vi.fn(async () => true)
    const close = vi.fn()
    const result = await attemptCloseMemoryDialog({ dialog, draft, confirm, close })
    expect(result).toEqual({ prompted: true, closed: true })
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })
})
