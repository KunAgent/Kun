import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCreatePlanTool, executeCreatePlanTool } from '../src/adapters/tool/create-plan-tool.js'
import { LocalToolHost } from '../src/adapters/tool/local-tool-host.js'
import type { ToolHostContext } from '../src/ports/tool-host.js'
import { buildGuiPlanId } from '../src/shared/gui-plan.js'

describe('create_plan host-owned routing', () => {
  let workspace: string
  let context: ToolHostContext

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'kun-reserved-plan-'))
    await mkdir(join(workspace, '.kunsdd/plan'), { recursive: true })
    context = {
      threadId: 'thr_auto',
      turnId: 'turn_plan',
      threadMode: 'plan',
      workspace,
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      abortSignal: new AbortController().signal,
      awaitApproval: async () => 'allow',
      guiPlan: {
        operation: 'draft',
        workspaceRoot: workspace,
        relativePath: '.kunsdd/plan/provisional.md',
        planId: 'plan_provisional'
      }
    }
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('saves an automatic draft through the tool host despite stale routing hints', async () => {
    await writeFile(join(workspace, '.kunsdd/plan/title-fix.md'), '# Existing plan')
    const host = new LocalToolHost({ tools: [createCreatePlanTool()] })
    const result = await host.execute({
      callId: 'call_auto_plan',
      toolName: 'create_plan',
      arguments: {
        markdown: '# Title fix\n\n- [ ] Fix titles',
        title: 'Title fix',
        operation: 'refine',
        plan_relative_path: '.kunsdd/plan/title-fix.md',
        plan_id: 'plan_stale'
      }
    }, context)

    expect(result.item.kind).toBe('tool_result')
    if (result.item.kind !== 'tool_result') throw new Error('Expected tool result')
    expect(result.item.isError).not.toBe(true)
    expect(result.item.output).toMatchObject({
      operation: 'draft',
      relative_path: '.kunsdd/plan/title-fix-2.md',
      plan_id: buildGuiPlanId(workspace, '.kunsdd/plan/title-fix-2.md'),
      content_hash: expect.stringMatching(/^[a-f0-9]{16}$/)
    })
    expect(await readFile(join(workspace, '.kunsdd/plan/title-fix-2.md'), 'utf8'))
      .toBe('# Title fix\n\n- [ ] Fix titles')
    expect(await readFile(join(workspace, '.kunsdd/plan/title-fix.md'), 'utf8'))
      .toBe('# Existing plan')
  })

  it.each(['.kunsdd/plan/other.md', '../escape.md', '/tmp/escape.md'])(
    'keeps fixed drafts at the host target instead of %s', async (path) => {
      context.guiPlan = { ...context.guiPlan!, fixedPath: true }
      const result = await executeCreatePlanTool({
        markdown: '# Fixed draft',
        title: 'Different title',
        plan_relative_path: path,
        plan_id: 'plan_forged'
      }, context)

      expect(result.isError).not.toBe(true)
      expect(result.output).toMatchObject({
        relative_path: '.kunsdd/plan/provisional.md',
        plan_id: 'plan_provisional'
      })
      expect(await readFile(join(workspace, '.kunsdd/plan/provisional.md'), 'utf8'))
        .toBe('# Fixed draft')
      expect(await readdir(join(workspace, '.kunsdd/plan'))).toEqual(['provisional.md'])
    }
  )

  it.each(['.kunsdd/plan/login.md', '.deepseekgui/plan/login.md'])(
    'refines %s in place without overwriting the model-supplied target', async (path) => {
      await mkdir(join(workspace, '.deepseekgui/plan'), { recursive: true })
      await writeFile(join(workspace, path), '# Original')
      await writeFile(join(workspace, '.kunsdd/plan/other.md'), '# Unrelated')
      context.guiPlan = {
        ...context.guiPlan!, operation: 'refine', relativePath: path, planId: 'plan_login'
      }
      const result = await executeCreatePlanTool({
        markdown: '# Revised',
        title: 'Renamed title',
        plan_relative_path: '.kunsdd/plan/other.md',
        plan_id: 'plan_other'
      }, context)

      expect(result.isError).not.toBe(true)
      expect(result.output).toMatchObject({
        operation: 'refine', relative_path: path, plan_id: 'plan_login'
      })
      expect(await readFile(join(workspace, path), 'utf8')).toBe('# Revised')
      expect(await readFile(join(workspace, '.kunsdd/plan/other.md'), 'utf8')).toBe('# Unrelated')
    }
  )

  it.each(['../escape.md', '/tmp/escape.md', '.kunsdd/plan/nested/plan.md'])(
    'still rejects unsafe context-free targets: %s', async (path) => {
      context.guiPlan = undefined
      const result = await executeCreatePlanTool({ markdown: '# Plan', plan_relative_path: path }, context)
      expect(result.isError).toBe(true)
      expect(await readdir(join(workspace, '.kunsdd/plan'))).toEqual([])
    }
  )
})
