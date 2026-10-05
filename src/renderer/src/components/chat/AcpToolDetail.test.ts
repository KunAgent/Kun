import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AcpToolDetail } from './AcpToolDetail'
import { dedupeAcpMediatedChanges } from '../../agent/acp-mediated-changes'
import type { ToolBlock } from '../../agent/types'
vi.mock('react-i18next', () => ({ initReactI18next: { type: '3rdParty', init: () => undefined }, useTranslation: () => ({ t: (key: string) => key }) }))
const block = (meta: Record<string, unknown>): ToolBlock => ({ kind: 'tool', id: 'tool', turnId: 'turn', summary: 'acp:read', status: 'success', filePath: '/repo/README.md', meta })
describe('ACP tool detail', () => {
  it('shows received file content with input separately, without replacing it with a line-count summary', () => {
    const html = renderToStaticMarkup(createElement(AcpToolDetail, { block: block({ acpKind: 'read', acpInput: { file_path: '/repo/README.md' }, acpFileContent: 'Actual README content', acpText: '201 lines' }) }))
    expect(html).toContain('Actual README content')
    expect(html).toContain('acpTool.input')
    expect(html).not.toContain('201 lines')
    expect(html).not.toContain('acpTool.summaryOnly')
  })
  it('honestly labels summary-only reads and keeps command output plus exit status', () => {
    expect(renderToStaticMarkup(createElement(AcpToolDetail, { block: block({ acpKind: 'read', acpText: '201 lines' }) }))).toContain('acpTool.summaryOnly')
    const html = renderToStaticMarkup(createElement(AcpToolDetail, { block: block({ acpKind: 'execute', command: 'git status', acpTerminals: [{ terminalId: 't', output: 'clean', exitCode: 0 }] }) }))
    expect(html).toContain('$ git status')
    expect(html).toContain('clean')
    expect(html).toContain('acpTool.exitCode')
  })
  it('deduplicates only identical mediated write echoes within the same turn', () => {
    const diff = [{ path: '/repo/file', oldText: 'before', newText: 'after' }]
    const native = block({ acpKind: 'edit', acpDiffs: diff })
    const echo = { ...block({ acpKind: 'fs.write', acpDiffs: diff }), id: 'echo' }
    expect(dedupeAcpMediatedChanges([native, echo])).toEqual([native])
    expect(dedupeAcpMediatedChanges([native, { ...echo, turnId: 'another' }])).toHaveLength(2)
    expect(dedupeAcpMediatedChanges([native, { ...echo, meta: { acpKind: 'fs.write', acpDiffs: [{ ...diff[0], newText: 'different' }] } }])).toHaveLength(2)
  })
})
