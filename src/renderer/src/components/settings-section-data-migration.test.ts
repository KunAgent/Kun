import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DataMigrationImportPlanSchema,
  DataMigrationReportSchema,
  parsePackageRelativePath,
  type DataMigrationConflict,
  type DataMigrationOperationStatus,
  type DataMigrationProgress
} from '@shared/data-migration'
import english from '../locales/en/settings.json'
import chinese from '../locales/zh/settings.json'
import {
  DEFAULT_CATEGORIES,
  DataMigrationActionError,
  DataMigrationLanding,
  DataMigrationProgressCard,
  DataMigrationReportView,
  DataMigrationSettingsSection,
  DataMigrationStepRail,
  DataMigrationVirtualConflictList,
  formatBytes,
  normalizeResolvedPlan,
  resolveAllPlanConflicts,
  resolvePlanConflict
} from './settings-section-data-migration'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function plan() {
  return DataMigrationImportPlanSchema.parse({
    operationId: 'import_ui',
    packageId: 'package_ui',
    inspectedAt: '2026-07-15T00:00:00.000Z',
    sourcePlatform: 'windows',
    encrypted: true,
    mappings: [{
      workspaceId: 'ws_ui', sourcePathDisplay: 'C:\\Project', destinationRoot: '/Users/test/Project',
      strategy: 'merge', compatible: false, requiredBytes: 10, freeBytes: 1_000, unresolvedIssueCount: 1
    }],
    conflicts: [{
      conflictId: 'conflict_ui', workspaceId: 'ws_ui', path: parsePackageRelativePath('README.md'),
      kind: 'different-content', fatal: true
    }],
    threadIdMap: {}, unresolvedReferences: [], disabledItems: [], estimatedPeakBytes: 20, fatalIssueCount: 1
  })
}

function status(overrides: Partial<DataMigrationOperationStatus> = {}): DataMigrationOperationStatus {
  return {
    featureEnabled: true,
    recoverable: [],
    recentReports: [],
    ...overrides
  }
}

const report = DataMigrationReportSchema.parse({
  operationId: 'report_ui',
  packageId: 'package_ui',
  kind: 'import',
  outcome: 'completed-with-review',
  startedAt: '2026-07-15T00:00:00.000Z',
  finishedAt: '2026-07-15T00:01:00.000Z',
  counts: { workspaces: 1 },
  workspacePathMap: { ws_ui: '/Users/test/Project' },
  threadIdMap: { thread_old: 'thread_new' },
  warnings: ['Review one imported workflow.'],
  unresolvedReferences: 1,
  disabledItems: 1
})

describe('data migration settings helpers', () => {
  it('keeps fatal conflicts blocking until an explicit resolution is selected', () => {
    expect(normalizeResolvedPlan(plan())).toMatchObject({ fatalIssueCount: 1 })
    const resolved = resolvePlanConflict(plan(), 'conflict_ui', 'replace-with-backup')
    expect(resolved.fatalIssueCount).toBe(0)
    expect(resolved.mappings[0]).toMatchObject({ compatible: true, unresolvedIssueCount: 0 })
  })

  it('applies bulk conflict decisions without dropping the plan identity', () => {
    const resolved = resolveAllPlanConflicts(plan(), 'keep-target')
    expect(resolved.operationId).toBe('import_ui')
    expect(resolved.conflicts).toEqual([expect.objectContaining({ resolution: 'keep-target' })])
  })

  it('formats byte counters without invalid or negative output', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(Number.NaN)).toBe('0 B')
    expect(formatBytes(1_572_864)).toBe('1.5 MB')
  })

  it('has English and Chinese labels for every selectable migration category', async () => {
    for (const category of DEFAULT_CATEGORIES) {
      expect(english[`dataMigrationCategory_${category}` as keyof typeof english]).toBeTruthy()
      expect(chinese[`dataMigrationCategory_${category}` as keyof typeof chinese]).toBeTruthy()
    }
  })

  it('keeps the complete English and Chinese migration key sets in sync', () => {
    const englishKeys = Object.keys(english).filter((key) => key.startsWith('dataMigration')).sort()
    const chineseKeys = Object.keys(chinese).filter((key) => key.startsWith('dataMigration')).sort()
    expect(englishKeys).toEqual(chineseKeys)
    expect(englishKeys.length).toBeGreaterThan(100)
    for (const key of englishKeys) {
      expect(String(english[key as keyof typeof english]).trim()).not.toBe('')
      expect(String(chinese[key as keyof typeof chinese]).trim()).not.toBe('')
    }
  })
})

describe('data migration settings states', () => {
  const noop = () => undefined
  const landing = (value: DataMigrationOperationStatus) => renderToStaticMarkup(createElement(DataMigrationLanding, {
    status: value,
    onExport: noop,
    onImport: noop,
    onOpenReport: noop,
    onDeleteReport: async () => undefined,
    onRecover: async () => undefined,
    busy: false
  }))

  it('renders both landing routes, the never-transferred notice, and recent report empty state', () => {
    const html = landing(status())
    expect(html).toContain('dataMigrationCreateTitle')
    expect(html).toContain('dataMigrationImportTitle')
    expect(html).toContain('dataMigrationNeverTransferredTitle')
    expect(html).toContain('dataMigrationNoReports')
    expect(html).not.toContain('disabled=""')
  })

  it('prioritizes recovery, disables new routes, and does not offer resume for an inspected operation', () => {
    const html = landing(status({
      recoverable: [{
        operationId: 'recover_ui',
        packageId: 'package_ui',
        phase: 'inspected',
        updatedAt: '2026-07-15T00:00:00.000Z',
        destinationEffect: 'untouched',
        warnings: [],
        manualRecoverySteps: ['Select the package again.']
      }]
    }))
    expect(html).toContain('dataMigrationRecoveryTitle')
    expect(html).toContain('Select the package again.')
    expect(html).toContain('dataMigrationRollback')
    expect(html).not.toContain('dataMigrationResume')
    expect(html.match(/disabled=""/g)?.length).toBe(2)
  })

  it('keeps recovery available even when new migrations are feature-disabled', () => {
    expect(landing(status({ featureEnabled: false }))).toContain('dataMigrationFeatureDisabled')
    expect(landing(status({
      featureEnabled: false,
      recoverable: [{
        operationId: 'recover_commit', packageId: 'package_ui', phase: 'committing',
        updatedAt: '2026-07-15T00:00:00.000Z', destinationEffect: 'partially-committed',
        warnings: [], manualRecoverySteps: []
      }]
    }))).toContain('dataMigrationResume')
  })

  it('renders accessible progress, cancellation semantics, and stable error codes', () => {
    const progress: DataMigrationProgress = {
      operationId: 'progress_ui', kind: 'import', phase: 'staging', completedItems: 2, totalItems: 4,
      completedBytes: 512, totalBytes: 1024, cancellable: true, cancellationEffect: 'cleanup',
      updatedAt: '2026-07-15T00:00:00.000Z'
    }
    const html = renderToStaticMarkup(createElement(DataMigrationProgressCard, { progress, onCancel: noop }))
    expect(html).toContain('role="status"')
    expect(html).toContain('dataMigrationCancel')
    expect(html).toContain('dataMigrationCancellation_cleanup')
    expect(html).toContain('width:50%')
    const error = renderToStaticMarkup(createElement(DataMigrationActionError, {
      message: 'RECOVERY_REQUIRED: Resume or roll back this operation.'
    }))
    expect(error).toContain('role="alert"')
    expect(error).toContain('<strong')
    expect(error).toContain('RECOVERY_REQUIRED')
  })

  it('marks exactly one step current and renders non-color report outcomes', () => {
    const steps = renderToStaticMarkup(createElement(DataMigrationStepRail, {
      steps: ['Select', 'Inspect', 'Import'], current: 1
    }))
    expect(steps.match(/aria-current="step"/g)?.length).toBe(1)
    expect(steps).toContain('aria-label="Migration steps"')
    const html = renderToStaticMarkup(createElement(DataMigrationReportView, { report, onDone: noop }))
    expect(html).toContain('aria-label="Review needed"')
    expect(html).toContain('Review one imported workflow.')
    expect(html).toContain('dataMigrationOutcome_completed-with-review')
  })

  it('virtualizes large conflict inventories while preserving list semantics', () => {
    const conflicts: DataMigrationConflict[] = Array.from({ length: 10_000 }, (_, index) => ({
      conflictId: `conflict_${index}`,
      workspaceId: 'ws_ui',
      path: parsePackageRelativePath(`src/file-${index}.txt`),
      kind: 'different-content',
      fatal: false
    }))
    const html = renderToStaticMarkup(createElement(DataMigrationVirtualConflictList, {
      conflicts,
      onResolve: noop
    }))
    expect(html).toContain('role="list"')
    expect(html.match(/role="listitem"/g)?.length).toBeLessThan(10)
    expect(html).toContain('height:1160000px')
  })
})

describe('data migration estimate loading', () => {
  it('shows a failed automatic estimate once and waits for an explicit retry', async () => {
    const estimateExport = vi.fn(async () => { throw new Error('Kun thread inventory failed (400)') })
    vi.stubGlobal('window', {
      kunGui: {
        dataMigration: {
          getStatus: async () => status(),
          onProgress: () => () => undefined,
          estimateExport
        }
      },
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: vi.fn()
    })
    vi.stubGlobal('document', { querySelector: () => null })

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(DataMigrationSettingsSection))
    })
    const createButton = renderer.root.findAllByType('button').find((button) =>
      button.findAllByType('span').some((span) => span.children.includes('dataMigrationCreateTitle'))
    )
    expect(createButton).toBeDefined()

    await act(async () => {
      createButton!.props.onClick()
      await Promise.resolve()
    })
    await act(async () => { await Promise.resolve() })

    expect(estimateExport).toHaveBeenCalledOnce()
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('Kun thread inventory failed (400)')

    const retryButton = renderer.root.findAllByType('button').find((button) =>
      button.children.includes('dataMigrationRefreshEstimate')
    )
    expect(retryButton).toBeDefined()
    await act(async () => {
      retryButton!.props.onClick()
      await Promise.resolve()
    })
    expect(estimateExport).toHaveBeenCalledTimes(2)

    await act(async () => renderer.unmount())
  })
})
