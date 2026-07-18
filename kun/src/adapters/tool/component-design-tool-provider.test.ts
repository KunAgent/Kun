import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mergeBuiltinSubagentProfiles } from '../../delegation/builtin-profiles.js'
import type { DelegationRuntime } from '../../delegation/delegation-runtime.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import {
  buildComponentDesignerPrompt,
  buildComponentDesignToolProviders,
  COMPONENT_DESIGN_PROFILE_NAME,
  COMPONENT_DESIGN_TOOL_NAME,
  hardenComponentPrototypeHtml
} from './component-design-tool-provider.js'

const workspaces: string[] = []

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })))
})

function context(workspace: string): ToolHostContext {
  return {
    threadId: 'thread_parent',
    turnId: 'turn_parent',
    workspace,
    approvalPolicy: 'auto',
    sandboxMode: 'workspace-write',
    model: {
      id: 'test-model',
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsToolCalling: true,
      messageParts: ['text']
    },
    modelProviderId: 'provider-test',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow'
  }
}

function validHtml(label = 'Date picker'): string {
  return `<!doctype html>
<html><head>
<meta name="kun-component-prototype" content="1">
<title>${label}</title>
<style>button { color: #123; }</style>
</head><body><main data-kun-component-root><button type="button">${label}</button></main></body></html>`
}

describe('component designer profile', () => {
  it('is built in with a narrow file-authoring allow-list', () => {
    const config = mergeBuiltinSubagentProfiles({
      enabled: true,
      maxParallel: 3,
      maxChildRuns: 12,
      defaultToolPolicy: 'inherit',
      profiles: {}
    })
    expect(config.profiles[COMPONENT_DESIGN_PROFILE_NAME]).toMatchObject({
      mode: 'subagent',
      toolPolicy: 'inherit',
      allowedTools: ['read', 'grep', 'find', 'ls', 'write', 'edit']
    })
    expect(config.profiles[COMPONENT_DESIGN_PROFILE_NAME]?.promptPreamble).toContain('data-kun-component-root')
  })
})

describe('design_component tool', () => {
  it('reserves an artifact, forwards bounded implementation context, and returns hardened metadata', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-component-design-'))
    workspaces.push(workspace)
    await writeFile(join(workspace, 'existing.tsx'), 'export function DatePicker() { return <button>Date</button> }')
    const prompts: Array<Record<string, unknown>> = []
    const runtime = {
      enabled: () => true,
      runChild: async (input: Record<string, unknown>) => {
        prompts.push(input)
        const prompt = String(input.prompt)
        const relativePath = /Required output path: ([^\n]+)/.exec(prompt)?.[1]?.trim()
        if (!relativePath) throw new Error('missing output path')
        await writeFile(join(String(input.workspace), relativePath), validHtml())
        ;(input.onStart as ((childId: string, profile?: string) => void) | undefined)?.(
          'child_component',
          COMPONENT_DESIGN_PROFILE_NAME
        )
        return {
          id: 'child_component',
          status: 'completed',
          summary: 'Added range hover and keyboard states.'
        }
      }
    } as unknown as Pick<DelegationRuntime, 'enabled' | 'runChild'>
    const provider = buildComponentDesignToolProviders(runtime)[0]
    const tool = provider?.tools.find((candidate) => candidate.name === COMPONENT_DESIGN_TOOL_NAME)
    expect(tool).toBeDefined()
    expect(tool!.shouldAdvertise?.(context(workspace))).toBe(true)
    expect(tool!.shouldAdvertise?.({ ...context(workspace), workspace: '' })).toBe(false)
    const updates: unknown[] = []
    const result = await tool!.execute({
      title: 'Date range picker',
      request: 'Preview the range while hovering an end date.',
      existingImplementation: '<DatePicker mode="range" />',
      sourceFiles: ['existing.tsx'],
      viewport: { width: 760, height: 520 }
    }, context(workspace), (update) => {
      updates.push(update.output)
    })

    expect(result.isError).not.toBe(true)
    const output = result.output as Record<string, unknown>
    const prototype = output.componentPrototype as Record<string, unknown>
    expect(prototype).toMatchObject({
      version: 1,
      status: 'completed',
      producer: 'component-designer',
      childId: 'child_component',
      profile: COMPONENT_DESIGN_PROFILE_NAME,
      viewport: { width: 760, height: 520 }
    })
    expect(String(prototype.relativePath)).toMatch(/^\.kun-design\/component-prototypes\/.+\/prototype\.html$/)
    expect(String(prototype.contentHash)).toMatch(/^[a-f0-9]{64}$/)
    expect(updates).toEqual(expect.arrayContaining([
      expect.objectContaining({ componentPrototype: expect.objectContaining({ status: 'preparing', producer: 'component-designer' }) }),
      expect.objectContaining({ componentPrototype: expect.objectContaining({ status: 'running', producer: 'component-designer', childId: 'child_component' }) })
    ]))
    expect(prompts[0]).toMatchObject({
      profile: COMPONENT_DESIGN_PROFILE_NAME,
      inheritedModel: 'test-model',
      inheritedProviderId: 'provider-test',
      approvalPolicy: 'auto',
      sandboxMode: 'workspace-write'
    })
    expect(String(prompts[0]?.workspace)).toMatch(/\.kun-design\/component-prototypes\/.+$/)
    expect(String(prompts[0]?.prompt)).toContain('Required output path: prototype.html')
    expect(String(prompts[0]?.prompt)).toContain('<DatePicker mode="range" />')
    expect(String(prompts[0]?.prompt)).toContain('export function DatePicker')
    const html = await readFile(join(workspace, String(prototype.relativePath)), 'utf8')
    expect(html).toContain('Content-Security-Policy')
    expect(html).toContain("connect-src 'none'")
  })

  it('fails closed when the child writes a remotely dependent prototype', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-component-design-invalid-'))
    workspaces.push(workspace)
    const runtime = {
      enabled: () => true,
      runChild: async (input: Record<string, unknown>) => {
        const relativePath = /Required output path: ([^\n]+)/.exec(String(input.prompt))?.[1]?.trim()
        if (!relativePath) throw new Error('missing output path')
        await writeFile(
          join(String(input.workspace), relativePath),
          validHtml().replace('</head>', '<script src="https://cdn.example.test/ui.js"></script></head>')
        )
        return { id: 'child_invalid', status: 'completed', summary: 'done' }
      }
    } as unknown as Pick<DelegationRuntime, 'enabled' | 'runChild'>
    const tool = buildComponentDesignToolProviders(runtime)[0]!.tools[0]!
    const result = await tool.execute({ request: 'Improve the button.' }, context(workspace))
    expect(result.isError).toBe(true)
    expect(result.output).toMatchObject({
      error: expect.stringContaining('remote resources'),
      componentPrototype: {
        status: 'failed',
        producer: 'component-designer',
        childId: 'child_invalid',
        relativePath: expect.stringMatching(/^\.kun-design\/component-prototypes\//),
        error: expect.stringContaining('remote resources')
      }
    })
  })

  it('preserves a replayable failed card when source context cannot be loaded', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-component-design-source-failure-'))
    workspaces.push(workspace)
    const runtime = {
      enabled: () => true,
      runChild: async () => {
        throw new Error('child must not run')
      }
    } as unknown as Pick<DelegationRuntime, 'enabled' | 'runChild'>
    const tool = buildComponentDesignToolProviders(runtime)[0]!.tools[0]!
    const result = await tool.execute({
      request: 'Improve the button.',
      sourceFiles: ['missing.tsx']
    }, context(workspace))

    expect(result.isError).toBe(true)
    expect(result.output).toMatchObject({
      status: 'failed',
      componentPrototype: {
        status: 'failed',
        producer: 'component-designer',
        relativePath: expect.stringMatching(/^\.kun-design\/component-prototypes\//),
        error: expect.any(String)
      }
    })
  })

  it('fails when the child writes anything outside the single-file artifact contract', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-component-design-extra-file-'))
    workspaces.push(workspace)
    const runtime = {
      enabled: () => true,
      runChild: async (input: Record<string, unknown>) => {
        await writeFile(join(String(input.workspace), 'prototype.html'), validHtml())
        await writeFile(join(String(input.workspace), 'notes.txt'), 'unexpected')
        return { id: 'child_extra_file', status: 'completed', summary: 'done' }
      }
    } as unknown as Pick<DelegationRuntime, 'enabled' | 'runChild'>
    const tool = buildComponentDesignToolProviders(runtime)[0]!.tools[0]!

    const result = await tool.execute({ request: 'Improve the button.' }, context(workspace))

    expect(result.isError).toBe(true)
    expect(result.output).toMatchObject({
      componentPrototype: {
        status: 'failed',
        producer: 'component-designer',
        childId: 'child_extra_file',
        error: expect.stringContaining('unexpected files')
      }
    })
  })

  it('publishes supplied HTML directly without requiring a delegation runtime', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-component-design-direct-'))
    workspaces.push(workspace)
    const tool = buildComponentDesignToolProviders(undefined)[0]!.tools[0]!
    const updates: unknown[] = []

    const result = await tool.execute({
      title: 'Inline filter',
      html: validHtml('Inline filter'),
      viewport: { width: 640, height: 360 }
    }, context(workspace), (update) => {
      updates.push(update.output)
    })

    expect(result.isError).not.toBe(true)
    const prototype = (result.output as Record<string, unknown>).componentPrototype as Record<string, unknown>
    expect(prototype).toMatchObject({
      version: 1,
      status: 'completed',
      producer: 'main-agent',
      title: 'Inline filter',
      viewport: { width: 640, height: 360 }
    })
    expect(prototype).not.toHaveProperty('profile')
    expect(prototype).not.toHaveProperty('childId')
    expect(updates).toEqual([
      expect.objectContaining({
        componentPrototype: expect.objectContaining({ status: 'preparing', producer: 'main-agent' })
      })
    ])
    const html = await readFile(join(workspace, String(prototype.relativePath)), 'utf8')
    expect(html).toContain('Content-Security-Policy')
    expect(html).toContain('Inline filter')
  })

  it('prefers supplied HTML over request delegation when both are present', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-component-design-direct-precedence-'))
    workspaces.push(workspace)
    const runChild = vi.fn()
    const runtime = {
      enabled: () => true,
      runChild
    } as unknown as Pick<DelegationRuntime, 'enabled' | 'runChild'>
    const tool = buildComponentDesignToolProviders(runtime)[0]!.tools[0]!

    const result = await tool.execute({
      request: 'Use a child to redesign this.',
      html: validHtml('Direct result')
    }, context(workspace))

    expect(result.isError).not.toBe(true)
    expect(runChild).not.toHaveBeenCalled()
    expect(result.output).toMatchObject({
      componentPrototype: {
        status: 'completed',
        producer: 'main-agent'
      }
    })
  })

  it('keeps the tool advertised and explains how to proceed when request delegation is disabled', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-component-design-disabled-'))
    workspaces.push(workspace)
    const provider = buildComponentDesignToolProviders({ enabled: () => false } as never)[0]!
    const tool = provider.tools[0]!

    expect(provider.kind).toBe('built-in')
    expect(tool.shouldAdvertise?.(context(workspace))).toBe(true)
    const result = await tool.execute({ request: 'Improve the button.' }, context(workspace))

    expect(result.isError).toBe(true)
    expect(result.output).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('provide complete HTML'),
      componentPrototype: {
        status: 'failed',
        producer: 'component-designer',
        profile: COMPONENT_DESIGN_PROFILE_NAME,
        error: expect.stringContaining('provide complete HTML')
      }
    })
  })

  it('fails closed for invalid directly supplied HTML and preserves its inline card', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-component-design-direct-invalid-'))
    workspaces.push(workspace)
    const tool = buildComponentDesignToolProviders(undefined)[0]!.tools[0]!

    const result = await tool.execute({
      html: validHtml().replace('</head>', '<script src="https://cdn.example.test/ui.js"></script></head>')
    }, context(workspace))

    expect(result.isError).toBe(true)
    expect(result.output).toMatchObject({
      componentPrototype: {
        status: 'failed',
        producer: 'main-agent',
        error: expect.stringContaining('remote resources')
      }
    })
  })
})

describe('component prototype hardening', () => {
  it('replaces a supplied CSP with the offline policy', () => {
    const hardened = hardenComponentPrototypeHtml(
      validHtml().replace('<title>', '<meta http-equiv="Content-Security-Policy" content="default-src *"><title>')
    )
    expect(hardened.match(/Content-Security-Policy/g)).toHaveLength(1)
    expect(hardened).toContain("default-src 'none'")
  })

  it('replaces unquoted CSP declarations and rejects unquoted remote URLs', () => {
    const hardened = hardenComponentPrototypeHtml(
      validHtml().replace('<title>', '<meta http-equiv=content-security-policy content="default-src *"><title>')
    )
    expect(hardened.match(/Content-Security-Policy/g)).toHaveLength(1)
    expect(() => hardenComponentPrototypeHtml(
      validHtml().replace('</head>', '<script src=https://cdn.example.test/ui.js></script></head>')
    )).toThrow(/remote resources/)
  })

  it('requires one component marker root and rejects embedded documents', () => {
    expect(() => hardenComponentPrototypeHtml(validHtml().replace(' data-kun-component-root', '')))
      .toThrow(/exactly one/)
    expect(() => hardenComponentPrototypeHtml(validHtml().replace('</main>', '<iframe src="about:blank"></iframe></main>')))
      .toThrow(/forbidden embedded/)
  })

  it('rejects browser storage in otherwise standalone prototypes', () => {
    expect(() => hardenComponentPrototypeHtml(
      validHtml().replace('</body>', '<script>localStorage.setItem("state", "1")</script></body>')
    )).toThrow(/browser storage/)
  })
})

describe('component designer prompt', () => {
  it('keeps the task component-scoped and points at the reserved output', () => {
    const prompt = buildComponentDesignerPrompt({
      title: 'Search box',
      request: 'Add keyboard result navigation.',
      sourceFiles: [],
      viewport: { width: 720, height: 460 },
      relativePath: '.kun-design/component-prototypes/search/prototype.html',
      sourceContext: ''
    })
    expect(prompt).toContain('write exactly one file')
    expect(prompt).toContain('no site header, sidebar, page navigation')
    expect(prompt).toContain('data-kun-component-root')
  })
})
