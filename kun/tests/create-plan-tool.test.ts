import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalToolHost, buildDefaultLocalTools } from '../src/adapters/tool/local-tool-host.js'
import {
  CREATE_PLAN_INPUT_SCHEMA,
  CREATE_PLAN_TOOL_NAME,
  createCreatePlanTool,
  executeCreatePlanTool,
  isPlanToolContextActive
} from '../src/adapters/tool/create-plan-tool.js'
import type { ToolHostContext } from '../src/ports/tool-host.js'

function buildContext(overrides: Partial<ToolHostContext> = {}): ToolHostContext {
  return {
    threadId: 'thr_1',
    turnId: 'turn_1',
    workspace: '/tmp/ws',
    approvalPolicy: 'on-request',
    sandboxMode: 'danger-full-access',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow',
    ...overrides
  }
}

function buildGuiPlan(relativePath = '.kunsdd/plan/login.md', operation: 'draft' | 'refine' = 'draft') {
  return {
    operation,
    workspaceRoot: '/tmp/ws',
    relativePath,
    planId: `plan_${operation}`
  }
}

describe('create_plan tool: advertisement', () => {
  it('advertises when a GUI plan context is present', () => {
    expect(
      isPlanToolContextActive(
        buildContext({
          threadMode: 'agent',
          guiPlan: buildGuiPlan()
        })
      )
    ).toBe(true)
  })

  it('advertises for plan-mode threads even without an explicit GUI plan context', () => {
    expect(isPlanToolContextActive(buildContext({ threadMode: 'plan' }))).toBe(true)
  })

  it('does not advertise for normal agent turns', () => {
    expect(isPlanToolContextActive(buildContext({ threadMode: 'agent' }))).toBe(false)
    expect(isPlanToolContextActive(undefined)).toBe(false)
  })

  it('omits create_plan from the local tool list during normal agent turns', async () => {
    const host = new LocalToolHost({ tools: [createCreatePlanTool()] })
    const tools = await host.listTools(buildContext({ threadMode: 'agent' }))
    expect(tools.map((t) => t.name)).not.toContain(CREATE_PLAN_TOOL_NAME)
  })

  it('includes create_plan in the local tool list during plan turns', async () => {
    const host = new LocalToolHost({ tools: [createCreatePlanTool()] })
    const tools = await host.listTools(
      buildContext({
        threadMode: 'plan',
        guiPlan: buildGuiPlan()
      })
    )
    expect(tools.map((t) => t.name)).toContain(CREATE_PLAN_TOOL_NAME)
  })

  it('includes create_plan during plan turns without a GUI plan context', async () => {
    const host = new LocalToolHost({ tools: [createCreatePlanTool()] })
    const tools = await host.listTools(buildContext({ threadMode: 'plan' }))
    expect(tools.map((t) => t.name)).toContain(CREATE_PLAN_TOOL_NAME)
  })

  it('advertises only read-only investigation plus plan controls in plan mode', async () => {
    const host = new LocalToolHost({ tools: buildDefaultLocalTools() })
    const tools = await host.listTools(
      buildContext({
        threadMode: 'plan',
        awaitUserInput: async () => ({ status: 'cancelled' })
      })
    )
    const names = tools.map((tool) => tool.name)

    expect(names).toEqual([
      'read',
      'grep',
      'glob',
      'ls',
      'lsp',
      'repo_map',
      'git_inspect',
      'user_input',
      'request_user_input',
      CREATE_PLAN_TOOL_NAME
    ])
    expect(names).not.toEqual(expect.arrayContaining(['write', 'edit', 'bash', 'verify_changes', 'echo']))
  })

  it('keeps the plan-mode tool catalog stable when no user-input gate is wired', async () => {
    const host = new LocalToolHost({ tools: buildDefaultLocalTools() })
    const tools = await host.listTools(buildContext({ threadMode: 'plan' }))
    const names = tools.map((tool) => tool.name)

    expect(names).toEqual([
      'read',
      'grep',
      'glob',
      'ls',
      'lsp',
      'repo_map',
      'git_inspect',
      'user_input',
      'request_user_input',
      CREATE_PLAN_TOOL_NAME
    ])
  })

  it('keeps the normal agent-mode default tool advertisement unchanged', async () => {
    const host = new LocalToolHost({ tools: buildDefaultLocalTools() })
    const tools = await host.listTools(buildContext({ threadMode: 'agent' }))
    const names = tools.map((tool) => tool.name)

    expect(names).toEqual(expect.arrayContaining(['read', 'bash', 'edit', 'write', 'grep', 'glob', 'ls', 'echo']))
    expect(names).not.toContain('find')
    expect(names).not.toContain(CREATE_PLAN_TOOL_NAME)
  })
})

describe('create_plan tool: path validation', () => {
  it('rejects nested relative paths', async () => {
    const result = await executeCreatePlanTool(
      {
        markdown: '# nested',
        operation: 'draft',
        plan_relative_path: '.kunsdd/plan/nested/a.md'
      },
      buildContext({
        threadMode: 'plan',
        guiPlan: buildGuiPlan('.kunsdd/plan/nested/a.md')
      })
    )
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.output)).toMatch(/direct Markdown file/)
  })

  it('rejects traversal relative paths', async () => {
    const result = await executeCreatePlanTool(
      {
        markdown: '# escape',
        operation: 'draft',
        plan_relative_path: '../escape.md'
      },
      buildContext({
        threadMode: 'plan',
        guiPlan: buildGuiPlan('../escape.md')
      })
    )
    expect(result.isError).toBe(true)
  })

  it('rejects non-Markdown extensions', async () => {
    const result = await executeCreatePlanTool(
      {
        markdown: '# not md',
        operation: 'draft',
        plan_relative_path: '.kunsdd/plan/login.txt'
      },
      buildContext({
        threadMode: 'plan',
        guiPlan: buildGuiPlan('.kunsdd/plan/login.txt')
      })
    )
    expect(result.isError).toBe(true)
  })

  it('rejects an explicit plan_relative_path that differs from the reserved GUI plan path', async () => {
    const result = await executeCreatePlanTool(
      {
        markdown: '# mismatch',
        operation: 'refine',
        plan_relative_path: '.kunsdd/plan/other.md'
      },
      buildContext({
        threadMode: 'plan',
        guiPlan: {
          operation: 'refine',
          workspaceRoot: '/tmp/ws',
          relativePath: '.kunsdd/plan/login.md',
          planId: 'plan_login'
        }
      })
    )
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.output)).toMatch(/does not match the reserved/)
  })

  it('uses the active GUI plan operation when the caller supplies the other valid operation', async () => {
    const result = await executeCreatePlanTool(
      {
        markdown: '# mismatch',
        operation: 'draft'
      },
      buildContext({
        threadMode: 'plan',
        guiPlan: buildGuiPlan('.kunsdd/plan/login.md', 'refine')
      }),
      {
        writePlan: async (target) => ({ path: target.absolutePath, savedAt: 'now' })
      }
    )
    expect(result.isError).toBeFalsy()
    expect(result.output).toMatchObject({
      operation: 'refine',
      relative_path: '.kunsdd/plan/login.md'
    })
  })
})

describe('create_plan tool: execution safety', () => {
  it('defaults a context-free call without operation to draft and self-allocates a path', async () => {
    const result = await executeCreatePlanTool(
      { markdown: '# allowed', title: 'disk cleanup' },
      buildContext({ threadMode: 'plan', workspace: '/tmp/ws' }),
      {
        listPlanFiles: () => [],
        writePlan: async (target) => ({ path: target.absolutePath, savedAt: 'now' })
      }
    )
    expect(result.isError).toBeFalsy()
    expect((result.output as { relative_path: string }).relative_path).toBe(
      '.kunsdd/plan/disk-cleanup.md'
    )
    expect((result.output as { operation: string }).operation).toBe('draft')
  })

  it('uses a reserved GUI operation when the caller omits operation', async () => {
    const result = await executeCreatePlanTool(
      { markdown: '# refined' },
      buildContext({
        threadMode: 'plan',
        guiPlan: buildGuiPlan('.kunsdd/plan/login.md', 'refine')
      }),
      {
        writePlan: async (target) => ({ path: target.absolutePath, savedAt: 'now' })
      }
    )

    expect(result.isError).toBeFalsy()
    expect(result.output).toMatchObject({
      operation: 'refine',
      relative_path: '.kunsdd/plan/login.md'
    })
  })

  it('rejects an explicitly invalid operation', async () => {
    const result = await executeCreatePlanTool(
      { markdown: '# invalid', operation: 'replace' },
      buildContext({
        threadMode: 'plan',
        guiPlan: buildGuiPlan()
      })
    )

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.output)).toMatch(/operation must be/)
  })

  it('rejects a forged call when the active turn is not in plan mode', async () => {
    const result = await executeCreatePlanTool(
      { markdown: '# forged', operation: 'draft' },
      buildContext({ threadMode: 'agent' })
    )
    expect(result.isError).toBe(true)
  })

  it('rejects a free-form legacy plan path as a new target', async () => {
    const result = await executeCreatePlanTool(
      {
        markdown: '# legacy',
        operation: 'draft',
        plan_relative_path: '.deepseekgui/plan/legacy.md'
      },
      buildContext({ threadMode: 'plan', workspace: '/tmp/ws' })
    )
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.output)).toMatch(/\.kunsdd\/plan/)
  })

  it('rejects when the model tries to execute create_plan on a normal turn through the tool host', async () => {
    const host = new LocalToolHost({ tools: [createCreatePlanTool()] })
    await expect(
      host.execute(
        { callId: 'call_1', toolName: CREATE_PLAN_TOOL_NAME, arguments: { operation: 'draft', markdown: '# hi' } },
        buildContext({ threadMode: 'agent' })
      )
    ).rejects.toThrow(/not advertised/)
  })

  it('rejects when the workspace advertised in the GUI plan context does not match the active turn', async () => {
    const result = await executeCreatePlanTool(
      { markdown: '# hi', operation: 'draft' },
      buildContext({
        threadMode: 'plan',
        workspace: '/tmp/other',
        guiPlan: {
          operation: 'draft',
          workspaceRoot: '/tmp/ws',
          relativePath: '.kunsdd/plan/login.md',
          planId: 'plan_login'
        }
      })
    )
    expect(result.isError).toBe(true)
  })

  it('rejects Markdown and source writes during plan mode', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-plan-markdown-write-'))
    const host = new LocalToolHost({ tools: buildDefaultLocalTools() })
    const context = buildContext({ threadMode: 'plan', workspace })

    try {
      await expect(host.execute(
        {
          callId: 'call_markdown',
          toolName: 'write',
          arguments: { path: 'notes.md', content: '# Notes\n' }
        },
        context
      )).rejects.toThrow(/not advertised by active tool policy/)
      await expect(host.execute(
        {
          callId: 'call_source',
          toolName: 'write',
          arguments: { path: 'src/app.ts', content: 'export const changed = true\n' }
        },
        context
      )).rejects.toThrow(/not advertised by active tool policy/)

      await expect(readFile(join(workspace, 'notes.md'), 'utf8')).rejects.toThrow()
      await expect(readFile(join(workspace, 'src/app.ts'), 'utf8')).rejects.toThrow()
      await expect(
        host.execute(
          {
            callId: 'call_bash',
            toolName: 'bash',
            arguments: { command: 'touch forbidden.txt' }
          },
          context
        )
      ).rejects.toThrow(/not advertised by active tool policy/)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('rejects a Markdown symlink whose resolved target is not Markdown', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-plan-markdown-symlink-'))
    try {
      await writeFile(join(workspace, 'source.ts'), 'export const safe = true\n', 'utf8')
      await symlink('source.ts', join(workspace, 'notes.md'))
      const host = new LocalToolHost({ tools: buildDefaultLocalTools() })
      await expect(host.execute(
        {
          callId: 'call_symlink',
          toolName: 'edit',
          arguments: {
            path: 'notes.md',
            oldText: 'safe = true',
            newText: 'safe = false'
          }
        },
        buildContext({ threadMode: 'plan', workspace })
      )).rejects.toThrow(/not advertised by active tool policy/)

      expect(await readFile(join(workspace, 'source.ts'), 'utf8')).toContain('safe = true')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('still executes create_plan through the tool host during plan mode', async () => {
    const host = new LocalToolHost({
      tools: buildDefaultLocalTools({
        listPlanFiles: () => [],
        writePlan: async (target) => ({ path: target.absolutePath, savedAt: 'now' })
      })
    })
    const result = await host.execute(
      {
        callId: 'call_plan',
        toolName: CREATE_PLAN_TOOL_NAME,
        arguments: { markdown: '# allowed', operation: 'draft', title: 'safe plan' }
      },
      buildContext({ threadMode: 'plan', workspace: '/tmp/ws' })
    )

    expect(result.item.kind).toBe('tool_result')
    expect(result.item.kind === 'tool_result' ? result.item.isError : true).not.toBe(true)
    expect(result.item.kind === 'tool_result'
      ? (result.item.output as { relative_path?: string }).relative_path
      : ''
    ).toBe('.kunsdd/plan/safe-plan.md')
  })
})

describe('create_plan tool: success and atomic write', () => {
  let workspace: string
  let previousMarkdown = ''

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'kun-plan-'))
    previousMarkdown = '# previous plan\n'
    await mkdir(join(workspace, '.deepseekgui/plan'), { recursive: true })
    await writeFile(join(workspace, '.deepseekgui/plan/login.md'), previousMarkdown, 'utf8')
    await mkdir(join(workspace, '.kunsdd/plan'), { recursive: true })
    await writeFile(join(workspace, '.kunsdd/plan/login.md'), previousMarkdown, 'utf8')
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('writes a fresh plan to the reserved path and returns structured metadata', async () => {
    const result = await executeCreatePlanTool(
      {
        markdown: '# Login plan\n\n- step 1',
        operation: 'draft',
        title: 'Login flow',
        source_request: 'Add login'
      },
      buildContext({
        threadMode: 'plan',
        workspace,
        guiPlan: {
          operation: 'draft',
          workspaceRoot: workspace,
          relativePath: '.kunsdd/plan/login.md',
          planId: `${workspace}:.kunsdd/plan/login.md`,
          sourceRequest: 'Add login',
          title: 'Login flow'
        }
      })
    )
    expect(result.isError).toBeFalsy()
    const output = result.output as {
      plan_id: string
      relative_path: string
      absolute_path: string
      operation: string
      summary: string
      content_hash: string
      byte_size: number
      saved_at: string
    }
    expect(output.relative_path).toBe('.kunsdd/plan/login-flow.md')
    expect(output.operation).toBe('draft')
    expect(output.summary).toContain('.kunsdd/plan/login-flow.md')
    expect(output.content_hash).toMatch(/^[a-f0-9]{16}$/)
    expect(output.byte_size).toBe(Buffer.byteLength('# Login plan\n\n- step 1', 'utf8'))
    expect(output.absolute_path).toBe(join(workspace, '.kunsdd/plan/login-flow.md'))
    const persisted = await readFile(output.absolute_path, 'utf8')
    expect(persisted).toBe('# Login plan\n\n- step 1')
  })

  it('rejects a reserved plan directory symlink that escapes the workspace', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'kun-plan-outside-'))
    try {
      await rm(join(workspace, '.kunsdd'), { recursive: true, force: true })
      await symlink(outside, join(workspace, '.kunsdd'), process.platform === 'win32' ? 'junction' : 'dir')

      const result = await executeCreatePlanTool(
        {
          markdown: '# escape attempt',
          operation: 'draft'
        },
        buildContext({
          threadMode: 'plan',
          workspace,
          sandboxMode: 'workspace-write',
          guiPlan: {
            operation: 'draft',
            workspaceRoot: workspace,
            relativePath: '.kunsdd/plan/escape.md',
            planId: 'plan_escape'
          }
        })
      )

      expect(result).toMatchObject({ isError: true, output: { code: 'workspace_path_escape' } })
      expect(existsSync(join(outside, 'plan', 'escape.md'))).toBe(false)
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('rejects a legacy reserved path when drafting a new plan', async () => {
    const result = await executeCreatePlanTool(
      { markdown: '# legacy draft', operation: 'draft' },
      buildContext({
        threadMode: 'plan',
        workspace,
        guiPlan: {
          operation: 'draft',
          workspaceRoot: workspace,
          relativePath: '.deepseekgui/plan/login.md',
          planId: `${workspace}:.deepseekgui/plan/login.md`
        }
      })
    )
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.output)).toMatch(/legacy/)
  })

  it('uses the reserved session id when a draft has no generated title', async () => {
    const result = await executeCreatePlanTool(
      { markdown: '# fallback' },
      buildContext({
        threadId: 'thr_plan_fallback',
        threadMode: 'plan',
        workspace,
        guiPlan: {
          operation: 'draft',
          workspaceRoot: workspace,
          relativePath: '.kunsdd/plan/raw-user-message.md',
          planId: `${workspace}:.kunsdd/plan/raw-user-message.md`,
          sourceRequest: 'A long follow-up user message that should not become the filename'
        }
      })
    )

    expect(result.isError).toBeFalsy()
    expect(result.output).toMatchObject({
      relative_path: '.kunsdd/plan/thr-plan-fallback.md',
      plan_id: `${workspace}:.kunsdd/plan/thr-plan-fallback.md`
    })
  })

  it('overwrites an existing plan when the same reserved path is reused', async () => {
    const result = await executeCreatePlanTool(
      { markdown: '# refined', operation: 'refine' },
      buildContext({
        threadMode: 'plan',
        workspace,
        guiPlan: {
          operation: 'refine',
          workspaceRoot: workspace,
          relativePath: '.deepseekgui/plan/login.md',
          planId: `${workspace}:.deepseekgui/plan/login.md`
        }
      })
    )
    expect(result.isError).toBeFalsy()
    const persisted = await readFile(join(workspace, '.deepseekgui/plan/login.md'), 'utf8')
    expect(persisted).toBe('# refined')
  })

  it('self-allocates a non-colliding path when plan mode has no reserved context', async () => {
    const result = await executeCreatePlanTool(
      { markdown: '# fresh', operation: 'draft', title: 'login' },
      buildContext({ threadMode: 'plan', workspace })
    )
    expect(result.isError).toBeFalsy()
    const output = result.output as { relative_path: string; absolute_path: string }
    // `.kunsdd/plan/login.md` already exists in this workspace.
    expect(output.relative_path).toBe('.kunsdd/plan/login-2.md')
    const persisted = await readFile(output.absolute_path, 'utf8')
    expect(persisted).toBe('# fresh')
  })

  it('leaves the previous plan untouched when the abort signal fires before rename', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await executeCreatePlanTool(
      { markdown: '# new', operation: 'draft' },
      buildContext({
        threadMode: 'plan',
        workspace,
        abortSignal: controller.signal,
        guiPlan: {
          operation: 'draft',
          workspaceRoot: workspace,
          relativePath: '.kunsdd/plan/login.md',
          planId: `${workspace}:.kunsdd/plan/login.md`
        }
      })
    )
    expect(result.isError).toBe(true)
    const persisted = await readFile(join(workspace, '.kunsdd/plan/login.md'), 'utf8')
    expect(persisted).toBe(previousMarkdown)
  })
})

describe('create_plan tool: schema surface', () => {
  it('requires markdown and keeps operation optional in the stable JSON schema', () => {
    expect(CREATE_PLAN_INPUT_SCHEMA.type).toBe('object')
    expect((CREATE_PLAN_INPUT_SCHEMA as { required: string[] }).required).toEqual(['markdown'])
    const properties = (CREATE_PLAN_INPUT_SCHEMA as { properties: Record<string, { type?: string; enum?: string[] }> }).properties
    expect(properties.operation.enum).toEqual(['draft', 'refine'])
    expect(properties.markdown.type).toBe('string')
  })
})
