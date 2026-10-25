import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { link, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import * as yauzl from 'yauzl'
import * as yazl from 'yazl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { buildOfficeCliLocalTools } from './office-cli-tool-provider.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function context(workspace: string): ToolHostContext {
  return {
    threadId: 'thread_office',
    turnId: 'turn_office',
    workspace,
    approvalPolicy: 'auto',
    sandboxMode: 'workspace-write',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow'
  }
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex')
}

const PPTX_HEADER =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<p:presentation xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
const PPTX_MASTERS =
  '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>'
const PPTX_NOTES = '<p:notesMasterIdLst><p:notesMasterId r:id="rId11"/></p:notesMasterIdLst>'
const PPTX_SLIDES = '<p:sldIdLst><p:sldId id="256" r:id="rId3"/></p:sldIdLst>'
const PPTX_SIZES = '<p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/>'
const PPTX_RELATIONSHIPS =
  '<?xml version="1.0"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId11" Type="http://schemas.openxmlformats.org/officeDocument/2006/' +
  'relationships/notesMaster" Target="notesMasters/notesMaster1.xml"/></Relationships>'

async function writePptxFixture(filePath: string, notesAfterSlides: boolean): Promise<void> {
  const body = notesAfterSlides
    ? `${PPTX_HEADER}${PPTX_MASTERS}${PPTX_SLIDES}${PPTX_NOTES}${PPTX_SIZES}</p:presentation>`
    : `${PPTX_HEADER}${PPTX_MASTERS}${PPTX_NOTES}${PPTX_SLIDES}${PPTX_SIZES}</p:presentation>`
  const zip = new yazl.ZipFile()
  zip.addBuffer(Buffer.from('<?xml version="1.0"?><Types/>', 'utf8'), '[Content_Types].xml')
  zip.addBuffer(Buffer.from(body, 'utf8'), 'ppt/presentation.xml')
  zip.addBuffer(Buffer.from(PPTX_RELATIONSHIPS, 'utf8'), 'ppt/_rels/presentation.xml.rels')
  zip.end()
  await pipeline(zip.outputStream, createWriteStream(filePath))
}

async function readPresentationXml(filePath: string): Promise<string> {
  const zipfile = await yauzl.openPromise(filePath, {
    lazyEntries: true,
    decodeStrings: true,
    autoClose: false
  })
  try {
    for await (const entry of zipfile.eachEntry()) {
      if (entry.fileName !== 'ppt/presentation.xml') continue
      const stream = await zipfile.openReadStreamPromise(entry)
      const chunks: Buffer[] = []
      for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer))
      return Buffer.concat(chunks).toString('utf8')
    }
    throw new Error('fixture has no ppt/presentation.xml')
  } finally {
    zipfile.close()
  }
}

describe('OfficeCLI controlled tools', () => {
  it('inspects a supported document without exposing an arbitrary command surface', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-office-tools-'))
    roots.push(workspace)
    const filePath = join(workspace, 'book.xlsx')
    await writeFile(filePath, 'source workbook')
    const run = vi.fn(async () => ({
      stdout: '{"sheets":2}',
      stderr: '',
      exitCode: 0
    }))
    const inspect = buildOfficeCliLocalTools({ run })[0]!

    const result = await inspect.execute({
      path: 'book.xlsx',
      action: 'summary'
    }, context(workspace))

    expect(result.isError).not.toBe(true)
    expect(result.output).toMatchObject({
      path: filePath,
      relative_path: 'book.xlsx',
      format: 'xlsx',
      source_sha256: sha256('source workbook'),
      action: 'summary',
      result: { sheets: 2 }
    })
    expect(run).toHaveBeenCalledWith(
      ['view', filePath, 'stats', '--json'],
      expect.any(AbortSignal)
    )
    expect(inspect.inputSchema).not.toHaveProperty('properties.command')
  })

  it('renders scoped previews through the screenshot surface without passing a raw command', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-office-tools-'))
    roots.push(workspace)
    const filePath = join(workspace, 'book.xlsx')
    await writeFile(filePath, 'source workbook')
    const run = vi.fn(async (args: readonly string[]) => {
      const outputIndex = args.indexOf('--out')
      if (outputIndex >= 0) await writeFile(args[outputIndex + 1]!, Buffer.from('PNG preview'))
      return { stdout: '', stderr: '', exitCode: 0 }
    })
    const preview = buildOfficeCliLocalTools({ run })[2]!

    const result = await preview.execute({
      path: 'book.xlsx',
      sheet: 'Sheet1',
      range: 'A1:C8'
    }, context(workspace))

    expect(result.isError).not.toBe(true)
    expect(result.output).toMatchObject({
      kind: 'image',
      path: filePath,
      mime_type: 'image/png',
      data_base64: Buffer.from('PNG preview').toString('base64')
    })
    const args = run.mock.calls[0]?.[0] ?? []
    expect(args).toEqual(expect.arrayContaining([
      'view',
      filePath,
      'screenshot',
      '--range',
      'Sheet1!A1:C8'
    ]))
    expect(args).not.toContain('--sheet')
  })

  it('edits a sibling copy and replaces the original only after validation succeeds', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-office-tools-'))
    roots.push(workspace)
    const filePath = join(workspace, 'book.xlsx')
    const source = Buffer.from('source workbook')
    await writeFile(filePath, source)
    const commands: string[][] = []
    const run = vi.fn(async (args: readonly string[]) => {
      commands.push([...args])
      if (args[0] === 'batch') {
        const stagedPath = args[1]!
        const batchInput = JSON.parse(await readFile(args[3]!, 'utf8'))
        expect(batchInput).toEqual([{
          command: 'set',
          path: '/Sheet1/A1',
          props: { value: '42' }
        }])
        await writeFile(stagedPath, 'edited workbook')
        return { stdout: '{"succeeded":1}', stderr: '', exitCode: 0 }
      }
      if (args[0] === 'validate') {
        return { stdout: '{"valid":true}', stderr: '', exitCode: 0 }
      }
      return { stdout: 'Workbook outline', stderr: '', exitCode: 0 }
    })
    const edit = buildOfficeCliLocalTools({ run })[1]!

    const result = await edit.execute({
      path: 'book.xlsx',
      expectedSha256: sha256(source),
      operations: [{
        type: 'set',
        target: '/Sheet1/A1',
        props: { value: '42' }
      }]
    }, context(workspace))

    expect(result.isError).not.toBe(true)
    expect(await readFile(filePath, 'utf8')).toBe('edited workbook')
    expect(result.output).toMatchObject({
      path: filePath,
      operations: 1,
      before_sha256: sha256(source),
      after_sha256: sha256('edited workbook'),
      preview_invalidated: true
    })
    expect(commands.map((args) => args[0])).toEqual(['view', 'batch', 'validate'])
    expect(await readdir(workspace)).toEqual(['book.xlsx'])
    expect(edit).toMatchObject({
      policy: 'on-request',
      toolKind: 'file_change',
      externalWritePathArguments: ['path']
    })
  })

  it('keeps the original byte-identical when validation fails', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-office-tools-'))
    roots.push(workspace)
    const filePath = join(workspace, 'deck.pptx')
    await writePptxFixture(filePath, false)
    const source = await readFile(filePath)
    const run = vi.fn(async (args: readonly string[]) => {
      if (args[0] === 'batch') {
        await writeFile(args[1]!, 'invalid edited deck')
        return { stdout: '', stderr: '', exitCode: 0 }
      }
      if (args[0] === 'validate') {
        return { stdout: '{"valid":false}', stderr: 'schema error', exitCode: 1 }
      }
      return { stdout: 'Deck outline', stderr: '', exitCode: 0 }
    })
    const edit = buildOfficeCliLocalTools({ run })[1]!

    const result = await edit.execute({
      path: 'deck.pptx',
      expectedSha256: sha256(source),
      operations: [{ type: 'remove', target: '/slide[1]/shape[1]' }]
    }, context(workspace))

    expect(result.isError).toBe(true)
    expect(result.output).toMatchObject({ error: expect.stringContaining('schema error') })
    expect(await readFile(filePath)).toEqual(source)
    expect(await readdir(workspace)).toEqual(['deck.pptx'])
  })

  it('refuses to overwrite a concurrent external change', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-office-tools-'))
    roots.push(workspace)
    const filePath = join(workspace, 'report.docx')
    const source = Buffer.from('source report')
    await writeFile(filePath, source)
    const run = vi.fn(async (args: readonly string[]) => {
      if (args[0] === 'batch') {
        await writeFile(args[1]!, 'edited report')
        await writeFile(filePath, 'changed by Word')
        return { stdout: '', stderr: '', exitCode: 0 }
      }
      if (args[0] === 'validate') {
        return { stdout: '{"valid":true}', stderr: '', exitCode: 0 }
      }
      return { stdout: 'Document outline', stderr: '', exitCode: 0 }
    })
    const edit = buildOfficeCliLocalTools({ run })[1]!

    const result = await edit.execute({
      path: 'report.docx',
      expectedSha256: sha256(source),
      operations: [{
        type: 'replace_text',
        target: '/body',
        find: 'source',
        replace: 'edited'
      }]
    }, context(workspace))

    expect(result.isError).toBe(true)
    expect(await readFile(filePath, 'utf8')).toBe('changed by Word')
    expect(await readdir(workspace)).toEqual(['report.docx'])
  })

  it('rejects hard-linked Office targets before creating a staged edit', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-office-tools-'))
    roots.push(workspace)
    const filePath = join(workspace, 'report.docx')
    const aliasPath = join(workspace, 'report-copy.docx')
    const source = Buffer.from('source report')
    await writeFile(filePath, source)
    await link(filePath, aliasPath)
    const run = vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 }))
    const edit = buildOfficeCliLocalTools({ run })[1]!

    const result = await edit.execute({
      path: 'report.docx',
      expectedSha256: sha256(source),
      operations: [{ type: 'remove', target: '/body/p[1]' }]
    }, context(workspace))

    expect(result).toMatchObject({
      isError: true,
      output: { error: expect.stringContaining('exactly one hard link') }
    })
    expect(run).not.toHaveBeenCalled()
    expect(await readFile(filePath)).toEqual(source)
    expect(await readFile(aliasPath)).toEqual(source)
  })

  it('repairs a PPTX notes master order defect before running the edit batch', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-office-tools-'))
    roots.push(workspace)
    const filePath = join(workspace, 'deck.pptx')
    await writePptxFixture(filePath, true)
    const source = await readFile(filePath)
    let orderAtBatch = ''
    const run = vi.fn(async (args: readonly string[]) => {
      if (args[0] === 'batch') {
        orderAtBatch = await readPresentationXml(args[1]!)
        return { stdout: '{"success":true}', stderr: '', exitCode: 0 }
      }
      if (args[0] === 'validate') {
        return { stdout: '{"success":true}', stderr: '', exitCode: 0 }
      }
      return { stdout: 'Deck outline', stderr: '', exitCode: 0 }
    })
    const edit = buildOfficeCliLocalTools({ run })[1]!

    const result = await edit.execute({
      path: 'deck.pptx',
      expectedSha256: sha256(source),
      operations: [{ type: 'set', target: '/slide[1]/shape[@id=2]', props: { size: '12pt' } }]
    }, context(workspace))

    expect(result.isError).not.toBe(true)
    expect(result.output).toMatchObject({
      source_repairs: ['moved-notes-master-id-list in ppt/presentation.xml']
    })
    expect(orderAtBatch.indexOf('<p:notesMasterIdLst>')).toBeLessThan(
      orderAtBatch.indexOf('<p:sldIdLst>')
    )
  })

  it('treats a failed validation payload as a failure even with a zero exit code', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-office-tools-'))
    roots.push(workspace)
    const filePath = join(workspace, 'deck.pptx')
    await writePptxFixture(filePath, true)
    const source = await readFile(filePath)
    const run = vi.fn(async (args: readonly string[]) => {
      if (args[0] === 'batch') {
        return { stdout: '{"success":true}', stderr: '', exitCode: 0 }
      }
      if (args[0] === 'validate') {
        return {
          stdout: '{"success":false,"message":"schema error in notesMasterIdLst"}',
          stderr: '',
          exitCode: 0
        }
      }
      return { stdout: 'Deck outline', stderr: '', exitCode: 0 }
    })
    const edit = buildOfficeCliLocalTools({ run })[1]!

    const result = await edit.execute({
      path: 'deck.pptx',
      expectedSha256: sha256(source),
      operations: [{ type: 'set', target: '/slide[1]/shape[@id=2]', props: { size: '12pt' } }]
    }, context(workspace))

    expect(result.isError).toBe(true)
    expect(result.output).toMatchObject({
      error: expect.stringContaining('schema error in notesMasterIdLst')
    })
    expect(result.output).toMatchObject({
      error: expect.stringContaining('the original file was not modified')
    })
    expect(await readFile(filePath)).toEqual(source)
  })

  it('surfaces the nested validation error detail without flooding the result', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-office-tools-'))
    roots.push(workspace)
    const filePath = join(workspace, 'deck.pptx')
    await writePptxFixture(filePath, false)
    const source = await readFile(filePath)
    const nested = {
      success: false,
      data: {
        count: 8,
        errors: Array.from({ length: 8 }, (_value, index) => ({
          type: 'Schema',
          description: `defect ${index} ${'x'.repeat(600)}`,
          path: '/p:presentation[1]',
          part: '/ppt/presentation.xml'
        }))
      }
    }
    const run = vi.fn(async (args: readonly string[]) => {
      if (args[0] === 'batch') return { stdout: '{"success":true}', stderr: '', exitCode: 0 }
      if (args[0] === 'validate') {
        return { stdout: JSON.stringify(nested), stderr: '', exitCode: 0 }
      }
      return { stdout: 'Deck outline', stderr: '', exitCode: 0 }
    })
    const edit = buildOfficeCliLocalTools({ run })[1]!

    const result = await edit.execute({
      path: 'deck.pptx',
      expectedSha256: sha256(source),
      operations: [{ type: 'set', target: '/slide[1]/shape[@id=2]', props: { size: '12pt' } }]
    }, context(workspace))

    const error = String((result.output as Record<string, unknown>).error)
    expect(error).toContain('defect 0')
    expect(error).toContain('/ppt/presentation.xml')
    expect(error).toContain('x'.repeat(100))
    expect(error.length).toBeLessThan(3_000)
    expect(error).not.toContain('defect 5')
    expect(await readFile(filePath)).toEqual(source)
  })
})
