import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import * as xlsx from 'xlsx'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { promisify } from 'node:util'
import JSZip from 'jszip'
import { OfficeDocumentConversionError } from './office-document-legacy'
import {
  convertWorkspaceSpreadsheet,
  saveWorkspaceSpreadsheet,
  spreadsheetMutationsToOfficeCliBatch
} from './workspace-spreadsheet-service'

const roots: string[] = []
const execFileAsync = promisify(execFile)
const bundledOfficeCli = join(process.cwd(), 'resources', 'officecli', 'current', process.platform === 'win32' ? 'officecli.exe' : 'officecli')
const currentSampleWorkbook = join(homedir(), '.deepseekgui', 'write_workspace', '随机示例数据.xlsx')

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture(name = 'book.xlsx'): Promise<{ root: string; path: string; source: Buffer }> {
  const root = await mkdtemp(join(tmpdir(), 'kun-work-sheet-'))
  roots.push(root)
  const path = join(root, name)
  const workbook = xlsx.utils.book_new()
  const sheet = xlsx.utils.aoa_to_sheet([
    ['Name', 'Score'],
    ['Alice', 7]
  ])
  sheet.B2.f = 'SUM(3,4)'
  sheet['!merges'] = [xlsx.utils.decode_range('A3:B3')]
  xlsx.utils.book_append_sheet(workbook, sheet, 'Data')
  const source = Buffer.from(xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
  await writeFile(path, source)
  return { root, path, source }
}

function sha(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

async function applyingRunner(args: string[]) {
  if (args[0] === 'batch') {
    const workbook = xlsx.read(await readFile(args[1]!), { type: 'buffer', cellFormula: true })
    const inputIndex = args.indexOf('--input')
    const commands = JSON.parse(await readFile(args[inputIndex + 1]!, 'utf8')) as Array<{
      path: string
      props: Record<string, unknown>
    }>
    for (const command of commands) {
      const [, sheetName, address] = command.path.split('/')
      const sheet = workbook.Sheets[sheetName!]
      if (!sheet || !/^[A-Z]+\d+$/.test(address || '')) continue
      const props = command.props
      const cell = sheet[address!] ?? { t: 'z' }
      if (props.clear) {
        delete cell.v
        delete cell.f
      }
      if (typeof props.formula === 'string') cell.f = props.formula
      if (Object.prototype.hasOwnProperty.call(props, 'value')) {
        cell.v = props.value
        cell.t = typeof props.value === 'number' ? 'n' : typeof props.value === 'boolean' ? 'b' : 's'
      }
      sheet[address!] = cell
    }
    await writeFile(args[1]!, xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
  }
  return { stdout: '{}', stderr: '', exitCode: 0 }
}

async function bundledRunner(args: string[]) {
  try {
    const result = await execFileAsync(bundledOfficeCli, args, {
      env: { ...process.env, OFFICECLI_NO_AUTO_RESIDENT: '1', OFFICECLI_RESIDENT_FLUSH: 'each' }
    })
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 }
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number }
    return { stdout: failure.stdout ?? '', stderr: failure.stderr ?? '', exitCode: failure.code ?? 1 }
  }
}

describe('workspace spreadsheet mutation service', () => {
  it('builds controlled OfficeCLI commands for content, styles, merges, and dimensions', () => {
    expect(spreadsheetMutationsToOfficeCliBatch([
      {
        kind: 'cell', sheetName: 'Data', address: 'B2', formula: '=SUM(A1:A2)',
        style: { bold: true, fillColor: 'FFFF00', numberFormat: '#,##0.00' }
      },
      { kind: 'merge', sheetName: 'Data', range: 'A3:B3', merged: false },
      { kind: 'row', sheetName: 'Data', index: 4, size: 24, hidden: false },
      { kind: 'column', sheetName: 'Data', index: 2, size: 18 }
    ])).toEqual([
      {
        command: 'set', path: '/Data/B2',
        props: {
          clear: true, formula: 'SUM(A1:A2)', 'font.bold': true,
          fill: 'FFFF00', numberformat: '#,##0.00'
        }
      },
      { command: 'set', path: '/Data/A3', props: { merge: false } },
      { command: 'set', path: '/Data/row[4]', props: { height: 24, hidden: false } },
      { command: 'set', path: '/Data/col[B]', props: { width: 18 } }
    ])
  })

  it('edits a sibling copy and replaces the source only after validation', async () => {
    const { root, path, source } = await fixture()
    const runOfficeCli = vi.fn(applyingRunner)
    const logSave = vi.fn()
    const result = await saveWorkspaceSpreadsheet({
      path,
      expectedSha256: sha(source),
      mutations: [{ kind: 'cell', sheetName: 'Data', address: 'B2', value: 42 }]
    }, { runOfficeCli, logSave })

    expect(result).toMatchObject({ ok: true, path, appliedMutations: 1 })
    const saved = xlsx.read(await readFile(path), { type: 'buffer', cellFormula: true })
    expect(saved.Sheets.Data?.B2).toMatchObject({ v: 42 })
    expect(saved.Sheets.Data?.A1).toMatchObject({ v: 'Name' })
    expect(runOfficeCli.mock.calls.map(([args]) => args[0])).toEqual(['batch', 'validate'])
    expect(await readdir(root)).toEqual(['book.xlsx'])
    expect(logSave).toHaveBeenLastCalledWith(expect.objectContaining({
      stage: 'complete', status: 'succeeded', fileName: 'book.xlsx', mutationCount: 1,
      expectedSha256Prefix: sha(source).slice(0, 12), currentSha256Prefix: expect.stringMatching(/^[a-f0-9]{12}$/)
    }))
    const diagnostic = logSave.mock.calls.at(-1)?.[0]
    expect(diagnostic).not.toHaveProperty('path')
    expect(diagnostic).not.toHaveProperty('mutations')
    expect(diagnostic).not.toHaveProperty('value')
  })

  it('rejects a stale source hash without invoking OfficeCLI', async () => {
    const { path, source } = await fixture()
    const runOfficeCli = vi.fn(applyingRunner)
    const result = await saveWorkspaceSpreadsheet({
      path,
      expectedSha256: sha(Buffer.concat([source, Buffer.from('stale')])),
      mutations: [{ kind: 'cell', sheetName: 'Data', address: 'A1', value: 'Changed' }]
    }, { runOfficeCli })

    expect(result).toMatchObject({ ok: false, code: 'source_changed' })
    expect(await readFile(path)).toEqual(source)
    expect(runOfficeCli).not.toHaveBeenCalled()
  })

  it('preserves the original and cleans private files when validation fails', async () => {
    const { root, path, source } = await fixture()
    const runOfficeCli = vi.fn(async (args: string[]) => {
      if (args[0] === 'batch') return applyingRunner(args)
      return { stdout: '', stderr: 'schema failure', exitCode: 1 }
    })
    const logSave = vi.fn()
    const result = await saveWorkspaceSpreadsheet({
      path,
      expectedSha256: sha(source),
      mutations: [{ kind: 'cell', sheetName: 'Data', address: 'A1', value: 'Changed' }]
    }, { runOfficeCli, logSave })

    expect(result).toMatchObject({ ok: false, code: 'mutation_failed' })
    expect(await readFile(path)).toEqual(source)
    expect(await readdir(root)).toEqual(['book.xlsx'])
    expect(logSave).toHaveBeenLastCalledWith(expect.objectContaining({
      stage: 'validation', status: 'failed', code: 'mutation_failed', fileName: 'book.xlsx'
    }))
  })

  it('does not overwrite a concurrent external change', async () => {
    const { root, path, source } = await fixture()
    const result = await saveWorkspaceSpreadsheet({
      path,
      expectedSha256: sha(source),
      mutations: [{ kind: 'cell', sheetName: 'Data', address: 'A1', value: 'Local' }]
    }, {
      runOfficeCli: applyingRunner,
      beforeReplace: async () => writeFile(path, 'external change')
    })

    expect(result).toMatchObject({ ok: false, code: 'source_changed' })
    expect(await readFile(path, 'utf8')).toBe('external change')
    expect(await readdir(root)).toEqual(['book.xlsx'])
  })

  ;(existsSync(bundledOfficeCli) ? it : it.skip)(
    'round-trips a real styled XLSX while preserving formulas and merges outside the edit',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'kun-work-sheet-real-'))
      roots.push(root)
      const path = join(root, 'roundtrip.xlsx')
      const run = async (...args: string[]) => execFileAsync(bundledOfficeCli, args, {
        env: { ...process.env, OFFICECLI_NO_AUTO_RESIDENT: '1', OFFICECLI_RESIDENT_FLUSH: 'each' }
      })
      const runOfficeCli = async (args: string[]) => {
        try {
          const result = await run(...args)
          return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 }
        } catch (error) {
          const failure = error as { stdout?: string; stderr?: string; code?: number }
          return { stdout: failure.stdout ?? '', stderr: failure.stderr ?? '', exitCode: failure.code ?? 1 }
        }
      }
      await run('create', path, '--locale', 'en-US')
      await run('set', path, '/Sheet1/A1', '--prop', 'value=Header', '--prop', 'bold=true', '--prop', 'fill=FFFF00')
      await run('set', path, '/Sheet1/B2', '--prop', 'formula=SUM(1,2)', '--prop', 'numberformat=0.00')
      await run('set', path, '/Sheet1/A3', '--prop', 'value=Merged', '--prop', 'merge=A3:B3')
      const source = await readFile(path)

      const saved = await saveWorkspaceSpreadsheet({
        path,
        expectedSha256: sha(source),
        mutations: [{
          kind: 'cell',
          sheetName: 'Sheet1',
          address: 'A2',
          value: 'Edited in Work',
          style: { italic: true, horizontalAlignment: 'center' }
        }]
      }, { runOfficeCli })
      expect(saved.ok, JSON.stringify(saved)).toBe(true)
      expect(saved).toMatchObject({ appliedMutations: 1 })

      const workbook = xlsx.read(await readFile(path), { type: 'buffer', cellFormula: true, cellStyles: true })
      expect(workbook.Sheets.Sheet1?.A2).toMatchObject({ v: 'Edited in Work' })
      expect(workbook.Sheets.Sheet1?.B2).toMatchObject({ f: 'SUM(1,2)' })
      expect(workbook.Sheets.Sheet1?.['!merges']).toEqual(expect.arrayContaining([
        expect.objectContaining({ s: { r: 2, c: 0 }, e: { r: 2, c: 1 } })
      ]))
      const a1 = await run('get', path, '/Sheet1/A1', '--json')
      expect(a1.stdout).toContain('Header')
      expect(a1.stdout).toMatch(/bold/i)
      expect(a1.stdout).toContain('FFFF00')
      await expect(run('validate', path, '--json')).resolves.toMatchObject({ stderr: '' })
      expect(await readdir(root)).toEqual(['roundtrip.xlsx'])
    },
    30_000
  )

  ;(existsSync(bundledOfficeCli) && existsSync(currentSampleWorkbook) ? it : it.skip)(
    'saves a copy of the current random sample without changing tables or conditional formatting',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'kun-work-sheet-sample-'))
      roots.push(root)
      const path = join(root, '随机示例数据.xlsx')
      const source = await readFile(currentSampleWorkbook)
      await writeFile(path, source)
      const beforeZip = await JSZip.loadAsync(source)
      const beforeTable = await beforeZip.file('xl/tables/table1.xml')?.async('string')
      const beforeSheet = await beforeZip.file('xl/worksheets/sheet1.xml')?.async('string') ?? ''
      const beforeConditionalFormatting = beforeSheet.match(/<conditionalFormatting\b[\s\S]*?<\/conditionalFormatting>/g)

      const saved = await saveWorkspaceSpreadsheet({
        path,
        expectedSha256: sha(source),
        mutations: [{ kind: 'cell', sheetName: '随机数据', address: 'B2', value: 'Work 保存验证' }]
      }, { runOfficeCli: bundledRunner })
      expect(saved).toMatchObject({ ok: true, appliedMutations: 1 })

      const output = await readFile(path)
      const workbook = xlsx.read(output, { type: 'buffer', cellFormula: true, cellStyles: true })
      expect(workbook.Sheets['随机数据']?.B2).toMatchObject({ v: 'Work 保存验证' })
      expect(workbook.Sheets['汇总']?.B3).toMatchObject({ f: "COUNTA('随机数据'!A2:A61)" })
      const afterZip = await JSZip.loadAsync(output)
      expect(await afterZip.file('xl/tables/table1.xml')?.async('string')).toBe(beforeTable)
      const afterSheet = await afterZip.file('xl/worksheets/sheet1.xml')?.async('string') ?? ''
      expect(afterSheet.match(/<conditionalFormatting\b[\s\S]*?<\/conditionalFormatting>/g))
        .toEqual(beforeConditionalFormatting)
      expect(await bundledRunner(['validate', path, '--json'])).toMatchObject({ exitCode: 0 })
      expect(await readdir(root)).toEqual(['随机示例数据.xlsx'])
    },
    30_000
  )
})

describe('legacy spreadsheet conversion', () => {
  it('publishes a collision-safe XLSX sibling and preserves the XLS source', async () => {
    const { root, path, source } = await fixture('budget.xls')
    await writeFile(join(root, 'budget.xlsx'), 'existing')
    let cleaned = false
    const result = await convertWorkspaceSpreadsheet({
      path,
      expectedSha256: sha(source)
    }, {
      convertLegacyDocument: async () => ({
        path,
        format: 'xlsx',
        cleanup: async () => { cleaned = true }
      })
    })

    expect(result).toMatchObject({ ok: true, name: 'budget converted.xlsx' })
    expect(await readFile(path)).toEqual(source)
    expect(await readFile(join(root, 'budget.xlsx'), 'utf8')).toBe('existing')
    expect(cleaned).toBe(true)
  })

  it('keeps XLS readable when LibreOffice is unavailable', async () => {
    const { path, source } = await fixture('legacy.xls')
    const result = await convertWorkspaceSpreadsheet({
      path,
      expectedSha256: sha(source)
    }, {
      convertLegacyDocument: async () => {
        throw new OfficeDocumentConversionError('libreoffice_unavailable', 'Install LibreOffice.')
      }
    })
    expect(result).toEqual({
      ok: false,
      code: 'libreoffice_unavailable',
      message: 'Install LibreOffice.'
    })
    expect(await readFile(path)).toEqual(source)
  })

  it('rejects a changed XLS source before conversion', async () => {
    const { path, source } = await fixture('legacy.xls')
    const convertLegacyDocument = vi.fn()
    const result = await convertWorkspaceSpreadsheet({
      path,
      expectedSha256: sha(Buffer.concat([source, Buffer.from('stale')]))
    }, { convertLegacyDocument })
    expect(result).toMatchObject({ ok: false, code: 'source_changed' })
    expect(convertLegacyDocument).not.toHaveBeenCalled()
  })
})
