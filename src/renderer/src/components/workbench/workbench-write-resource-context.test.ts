import { describe, expect, it } from 'vitest'
import { activeWriteResourceReference } from './workbench-write-resource-context'

describe('activeWriteResourceReference', () => {
  it('marks XLSX as writable while retaining legacy and other Office formats as read-only', () => {
    expect(activeWriteResourceReference('/work', '/work/book.xlsx', 'office', 'xlsx')).toMatchObject({
      locator: 'book.xlsx',
      resourceKind: 'office',
      sourceFormat: 'xlsx',
      access: 'read-write'
    })
    expect(activeWriteResourceReference('/work', '/work/book.xls', 'office', 'xls')).toMatchObject({
      access: 'read-only'
    })
    expect(activeWriteResourceReference('/work', '/work/report.docx', 'office', 'docx')).toMatchObject({
      access: 'read-only'
    })
  })
})
