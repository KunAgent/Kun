import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolHostContext } from '../../ports/tool-host.js'
import {
  createPptMasterConfirmDesignTool,
  createPptMasterReadGuideTool,
  createPptMasterRunTool
} from './ppt-master-tool.js'

const workspaces: string[] = []

function context(
  workspace: string,
  awaitUserInput?: ToolHostContext['awaitUserInput']
): ToolHostContext {
  return {
    threadId: `thread_ppt_${workspace}`,
    turnId: 'turn_ppt',
    workspace,
    approvalPolicy: 'auto',
    sandboxMode: 'workspace-write',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow',
    activeSkillIds: ['ppt-master'],
    ...(awaitUserInput ? { awaitUserInput } : {})
  }
}

async function approvePresentation(workspace: string): Promise<string> {
  const confirmation = await createPptMasterConfirmDesignTool().execute({
    summary: '1. Context\n2. Proposal\n3. Next steps',
    audience: 'Leadership team',
    slide_count: 3,
    visual_direction: 'Clean editorial blue',
    output_path: 'presentations/brief.pptx'
  }, context(workspace, async () => ({
    status: 'submitted',
    answers: [{ id: 'ppt-generation', label: 'Generate PPT', value: 'Generate PPT' }]
  })))
  const token = (confirmation.output as { approval_token?: unknown }).approval_token
  if (confirmation.isError || typeof token !== 'string') {
    throw new Error('PPT Master confirmation did not return an approval token')
  }
  return token
}

async function workspaceWithMarkdown(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), 'kun-ppt-master-'))
  workspaces.push(workspace)
  await writeFile(join(workspace, 'brief.md'), '# Brief\n\nA source document.\n', 'utf8')
  await mkdir(join(workspace, '.kun-presentations'), { recursive: true })
  return workspace
}

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })))
})

describe('PPT Master local tool', () => {
  it('uses fixed scripts, copies the Markdown source, and confines the output layout', async () => {
    const workspace = await workspaceWithMarkdown()
    const skillDir = '/managed/ppt-master'
    const projectPath = join(workspace, '.kun-presentations', 'brief_ppt169_20260710')
    const approvalToken = await approvePresentation(workspace)
    const calls: string[][] = []
    const tool = createPptMasterRunTool(skillDir, {
      pythonPath: '/managed/ppt-master/.venv/bin/python',
      isReady: () => true,
      run: async (_python, args) => {
        calls.push(args)
        if (args[0] === join(skillDir, 'scripts', 'svg_to_pptx.py')) {
          await writeFile(String(args[3]), 'pptx', 'utf8')
        }
        return {
          exitCode: 0,
          output: args[1] === 'init' ? `Project created: ${projectPath}` : 'OK'
        }
      }
    })

    expect(tool.shouldAdvertise?.(context(workspace))).toBe(true)
    expect(tool.shouldAdvertise?.({ ...context(workspace), activeSkillIds: [] })).toBe(false)

    const initialized = await tool.execute({
      action: 'init_project',
      project_name: 'brief',
      confirmation_token: approvalToken
    }, context(workspace))
    expect(initialized.isError).toBeUndefined()
    expect(initialized.output).toMatchObject({ action: 'init_project', project_path: projectPath })
    expect(calls[0]).toEqual([
      join(skillDir, 'scripts', 'project_manager.py'),
      'init',
      'brief',
      '--format',
      'ppt169',
      '--dir',
      join(workspace, '.kun-presentations')
    ])

    const imported = await tool.execute({
      action: 'import_markdown',
      project_path: '.kun-presentations/brief_ppt169_20260710',
      source_path: 'brief.md',
      confirmation_token: approvalToken
    }, context(workspace))
    expect(imported.isError).toBeUndefined()
    expect(calls[1]).toEqual([
      join(skillDir, 'scripts', 'project_manager.py'),
      'import-sources',
      projectPath,
      join(workspace, 'brief.md'),
      '--copy'
    ])

    const notes = await tool.execute({
      action: 'split_notes',
      project_path: '.kun-presentations/brief_ppt169_20260710',
      confirmation_token: approvalToken
    }, context(workspace))
    expect(notes.isError).toBeUndefined()
    expect(calls[2]).toEqual([
      join(skillDir, 'scripts', 'total_md_split.py'),
      projectPath,
      '--quiet'
    ])

    const exported = await tool.execute({
      action: 'export',
      project_path: '.kun-presentations/brief_ppt169_20260710',
      output_path: 'presentations/brief.pptx',
      confirmation_token: approvalToken
    }, context(workspace))
    expect(exported.isError).toBeUndefined()
    expect(exported.output).toMatchObject({
      action: 'export',
      output_path: join(workspace, 'presentations', 'brief.pptx'),
      generatedFiles: [{
        name: 'brief.pptx',
        relativePath: 'presentations/brief.pptx',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        byteSize: 4
      }]
    })
    expect(calls[3]).toEqual([
      join(skillDir, 'scripts', 'svg_to_pptx.py'),
      projectPath,
      '--output',
      expect.stringMatching(/\/presentations\/\.brief\.[^.]+\.tmp\.pptx$/),
      '--quiet'
    ])
  })

  it('rejects project and output paths outside the managed Write locations', async () => {
    const workspace = await workspaceWithMarkdown()
    const approvalToken = await approvePresentation(workspace)
    const tool = createPptMasterRunTool('/managed/ppt-master', {
      pythonPath: '/managed/ppt-master/.venv/bin/python',
      isReady: () => true,
      run: async () => ({ exitCode: 0, output: 'OK' })
    })

    const wrongRoot = await tool.execute({
      action: 'init_project',
      project_name: 'brief',
      projects_root: 'other-projects',
      confirmation_token: approvalToken
    }, context(workspace))
    expect(wrongRoot.isError).toBe(true)
    expect(wrongRoot.output).toMatchObject({ error: 'projects_root must be .kun-presentations' })

    const wrongProject = await tool.execute({
      action: 'validate',
      project_path: 'other-projects/brief',
      confirmation_token: approvalToken
    }, context(workspace))
    expect(wrongProject.isError).toBe(true)
    expect(wrongProject.output).toMatchObject({ error: 'project_path must be inside .kun-presentations/' })

    const wrongOutput = await tool.execute({
      action: 'export',
      project_path: '.kun-presentations/brief',
      output_path: 'exports/brief.pptx',
      confirmation_token: approvalToken
    }, context(workspace))
    expect(wrongOutput.isError).toBe(true)
    expect(wrongOutput.output).toMatchObject({ error: 'output_path must be inside presentations/' })

    await writeFile(join(workspace, 'brief.mdx'), '# Unsupported for this flow\n', 'utf8')
    const mdxSource = await tool.execute({
      action: 'import_markdown',
      project_path: '.kun-presentations/brief',
      source_path: 'brief.mdx',
      confirmation_token: approvalToken
    }, context(workspace))
    expect(mdxSource.isError).toBe(true)
    expect(mdxSource.output).toMatchObject({ error: 'source_path must be a Markdown file' })
  })

  it('rejects project generation before the native design confirmation', async () => {
    const workspace = await workspaceWithMarkdown()
    const tool = createPptMasterRunTool('/managed/ppt-master', {
      pythonPath: '/managed/ppt-master/.venv/bin/python',
      isReady: () => true,
      run: async () => ({ exitCode: 0, output: 'unexpected' })
    })

    const result = await tool.execute({
      action: 'init_project',
      project_name: 'brief',
      confirmation_token: 'not-approved'
    }, context(workspace))

    expect(result.isError).toBe(true)
    expect(result.output).toMatchObject({ error: expect.stringContaining('design approval is required') })
  })

  it('treats a successful exporter exit without a PPTX file as an error', async () => {
    const workspace = await workspaceWithMarkdown()
    const approvalToken = await approvePresentation(workspace)
    const tool = createPptMasterRunTool('/managed/ppt-master', {
      pythonPath: '/managed/ppt-master/.venv/bin/python',
      isReady: () => true,
      run: async () => ({ exitCode: 0, output: 'PPTX exported' })
    })

    const result = await tool.execute({
      action: 'export',
      project_path: '.kun-presentations/brief',
      output_path: 'presentations/brief.pptx',
      confirmation_token: approvalToken
    }, context(workspace))

    expect(result.isError).toBe(true)
    expect(result.output).toMatchObject({ error: expect.stringContaining('did not create') })
  })

  it('does not accept a stale PPTX from an earlier export', async () => {
    const workspace = await workspaceWithMarkdown()
    const approvalToken = await approvePresentation(workspace)
    await mkdir(join(workspace, 'presentations'), { recursive: true })
    await writeFile(join(workspace, 'presentations', 'brief.pptx'), 'old-deck', 'utf8')
    const tool = createPptMasterRunTool('/managed/ppt-master', {
      pythonPath: '/managed/ppt-master/.venv/bin/python',
      isReady: () => true,
      run: async () => ({ exitCode: 0, output: 'PPTX exported' })
    })

    const result = await tool.execute({
      action: 'export',
      project_path: '.kun-presentations/brief',
      output_path: 'presentations/brief.pptx',
      confirmation_token: approvalToken
    }, context(workspace))

    expect(result.isError).toBe(true)
    expect(result.output).toMatchObject({ error: expect.stringContaining('did not create a new') })
  })

  it('uses native structured input to issue a same-turn generation token', async () => {
    const workspace = await workspaceWithMarkdown()
    let prompt: { questions: Array<{ id: string; options: Array<{ label: string }> }> } | undefined
    const confirmed = await createPptMasterConfirmDesignTool().execute({
      summary: 'Slide outline',
      audience: 'Product team',
      slide_count: 4,
      visual_direction: 'Warm editorial',
      output_path: 'presentations/product.pptx'
    }, context(workspace, async (input) => {
      prompt = input
      return {
        status: 'submitted',
        answers: [{ id: 'ppt-generation', label: 'Generate PPT', value: 'Generate PPT' }]
      }
    }))
    expect(confirmed.isError).toBeUndefined()
    expect(confirmed.output).toMatchObject({
      approved_design: true,
      approval_token: expect.any(String)
    })
    expect(prompt).toMatchObject({
      questions: [{
        id: 'ppt-generation',
        options: [{ label: 'Generate PPT' }, { label: 'Cancel' }]
      }]
    })

    const cancelled = await createPptMasterConfirmDesignTool().execute({
      summary: 'Slide outline',
      audience: 'Product team',
      slide_count: 4,
      visual_direction: 'Warm editorial',
      output_path: 'presentations/product.pptx'
    }, context(workspace, async () => ({
      status: 'submitted',
      answers: [{ id: 'ppt-generation', label: 'Cancel', value: 'Cancel' }]
    })))
    expect(cancelled.isError).toBe(true)
    expect(cancelled.output).toMatchObject({ error: expect.stringContaining('cancelled') })
  })

  it('reads only bounded documentation inside the managed skill package', async () => {
    const workspace = await workspaceWithMarkdown()
    const skillDir = join(workspace, 'ppt-master')
    await mkdir(join(skillDir, 'workflows'), { recursive: true })
    await writeFile(join(skillDir, 'workflows', 'routing.md'), '# Route\n\nUse the Markdown route.\n', 'utf8')
    await writeFile(join(skillDir, 'workflows', 'long.md'), 'x'.repeat(25_000), 'utf8')
    const tool = createPptMasterReadGuideTool(skillDir)

    const guide = await tool.execute({ path: 'workflows/routing.md', max_lines: 2 }, context(workspace))
    expect(guide.isError).toBeUndefined()
    expect(guide.output).toMatchObject({
      path: 'workflows/routing.md',
      content: '# Route\n',
      truncated: true,
      next_line: 3
    })

    const escaped = await tool.execute({ path: '../brief.md' }, context(workspace))
    expect(escaped.isError).toBe(true)
    expect(escaped.output).toMatchObject({ error: expect.stringContaining('guide path') })

    const tooLong = await tool.execute({ path: 'workflows/long.md' }, context(workspace))
    expect(tooLong.isError).toBe(true)
    expect(tooLong.output).toMatchObject({ error: expect.stringContaining('output limit') })
  })
})
