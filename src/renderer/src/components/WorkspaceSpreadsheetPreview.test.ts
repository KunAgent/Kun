import { createElement, type ReactElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceOfficePreviewSuccess } from '@shared/office-document'
import type { WorkspaceXlsxGridProps } from './WorkspaceXlsxGrid'

const grid = vi.hoisted(() => ({ props: [] as WorkspaceXlsxGridProps[] }))

vi.mock('./WorkspaceXlsxGrid', () => ({
  WorkspaceXlsxGrid: (props: WorkspaceXlsxGridProps): ReactElement => {
    grid.props.push(props)
    return createElement('div', { 'data-engine': 'xlsx' })
  }
}))

import { WorkspaceSpreadsheetPreview } from './WorkspaceSpreadsheetPreview'

function preview(sha: string, data = new Uint8Array([1, 2, 3])): WorkspaceOfficePreviewSuccess {
  return {
    ok: true,
    path: '/repo/usage.xlsx',
    name: 'usage.xlsx',
    sourceFormat: 'xlsx',
    renderFormat: 'xlsx',
    viewer: 'spreadsheet',
    size: data.byteLength,
    mtimeMs: 1,
    sourceSha256: sha,
    data
  }
}

describe('WorkspaceSpreadsheetPreview', () => {
  let renderer: ReactTestRenderer | undefined

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    grid.props = []
  })

  afterEach(async () => {
    if (renderer) await act(async () => renderer?.unmount())
    renderer = undefined
  })

  async function render(element: ReactElement, update = false): Promise<void> {
    await act(async () => {
      if (update && renderer) renderer.update(element)
      else renderer = create(element)
      for (let index = 0; index < 20; index += 1) await Promise.resolve()
    })
  }

  it('loads the grid lazily and hands it the file, refresh state and selection callback', async () => {
    const onSelectionChange = vi.fn()
    const result = preview('a')
    await render(createElement(WorkspaceSpreadsheetPreview, {
      result,
      loading: true,
      refreshError: 'Could not refresh',
      onSelectionChange
    }))
    const props = grid.props.at(-1)!
    expect(props.result).toBe(result)
    expect(props.source).toBe(result.data)
    expect(props.loading).toBe(true)
    expect(props.refreshError).toBe('Could not refresh')
    expect(props.onSelectionChange).toBe(onSelectionChange)
  })

  it('keeps the open workbook for the same bytes and reloads a changed file', async () => {
    const first = preview('a')
    await render(createElement(WorkspaceSpreadsheetPreview, { result: first, loading: false }))
    const firstSource = grid.props.at(-1)!.source
    await render(createElement(WorkspaceSpreadsheetPreview, {
      result: { ...first, data: new Uint8Array(first.data) },
      loading: false
    }), true)
    expect(grid.props.at(-1)!.source).toBe(firstSource)
    await render(createElement(WorkspaceSpreadsheetPreview, {
      result: preview('b', new Uint8Array([4, 5])),
      loading: false
    }), true)
    expect(grid.props.at(-1)!.source).not.toBe(firstSource)
  })
})
