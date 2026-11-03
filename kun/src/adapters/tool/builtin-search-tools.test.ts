import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import './local-tool-host.js'
import { createFindLocalTool, createGlobLocalTool, createGrepLocalTool } from './builtin-search-tools.js'

describe('grep input bounds', () => {
  it('skips oversized files in the in-process scan fallback', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-grep-bound-'))
    try {
      await writeFile(join(workspace, 'large.txt'), 'needle here\n', 'utf8')
      const tool = createGrepLocalTool({
        rgExecutableCandidates: [],
        maxFileBytes: 8,
        maxTotalBytes: 16
      })

      const result = await tool.execute(
        { pattern: 'needle', path: '.' },
        {
          workspace,
          threadId: 'thr_grep_bound',
          turnId: 'turn_grep_bound',
          approvalPolicy: 'auto',
          sandboxMode: 'workspace-write',
          abortSignal: new AbortController().signal,
          awaitApproval: async () => 'deny'
        }
      )

      expect(result.isError).toBeUndefined()
      expect(result.output).toMatchObject({
        backend: 'scan',
        matches: [],
        skipped_large_files: 1,
        scan_byte_limit_reached: false
      })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})

describe('source search pages', () => {
  const context = (workspace: string) => ({ workspace, threadId: 'thr', turnId: 'turn', approvalPolicy: 'auto' as const, sandboxMode: 'workspace-write' as const, sourceResultBudgetTokens: 32, abortSignal: new AbortController().signal, awaitApproval: async () => 'allow' as const })

  it('advertises glob while retaining find as an executable hidden alias', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-glob-page-'))
    try {
      await Promise.all(['a.ts', 'b.ts', 'c.ts'].map((name) => writeFile(join(workspace, name), name)))
      const glob = createGlobLocalTool({ fdExecutableCandidates: [], rgExecutableCandidates: [] })
      const find = createFindLocalTool()
      expect(glob.shouldAdvertise?.(context(workspace))).not.toBe(false)
      expect(find.modelAdvertised).toBe(false)
      const first = await glob.execute({ pattern: '*.ts', limit: 1 }, context(workspace))
      const out = first.output as Record<string, unknown>
      expect(out).toMatchObject({ has_more: true, next_cursor: expect.any(String) })
      const second = await glob.execute({ pattern: '*.ts', limit: 1, cursor: out.next_cursor }, context(workspace))
      expect((second.output as Record<string, unknown>).matches).not.toEqual(out.matches)
      await expect(find.execute({ pattern: '*.ts', limit: 1 }, context(workspace))).resolves.toBeDefined()
    } finally { await rm(workspace, { recursive: true, force: true }) }
  })

  it('does not apply the former default file-size skip to grep fallback', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-grep-large-'))
    try {
      await writeFile(join(workspace, 'large.txt'), `needle ${'x'.repeat(64)}`)
      const result = await createGrepLocalTool({ rgExecutableCandidates: [] }).execute({ pattern: 'needle' }, context(workspace))
      expect(result.output).toMatchObject({ matches: [expect.objectContaining({ line: 1 })], skipped_large_files: 0 })
    } finally { await rm(workspace, { recursive: true, force: true }) }
  })
})

describe('Fast Context source search bounds', () => {
  const context = (workspace: string, fastContext = false) => ({
    workspace,
    threadId: 'thr_fast_context',
    turnId: 'turn_fast_context',
    approvalPolicy: 'auto' as const,
    sandboxMode: 'workspace-write' as const,
    sourceResultBudgetTokens: 8_192,
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow' as const,
    ...(fastContext ? { fastContext: true } : {})
  })

  it('caps grep evidence and skips generated or dependency directories only in Fast Context', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-fast-context-grep-'))
    try {
      await Promise.all([
        mkdir(join(workspace, 'src'), { recursive: true }),
        mkdir(join(workspace, '.git'), { recursive: true }),
        mkdir(join(workspace, 'node_modules', 'pkg'), { recursive: true }),
        mkdir(join(workspace, 'dist'), { recursive: true })
      ])
      const source = [
        `needle ${'x'.repeat(400)}`,
        ...Array.from({ length: 34 }, (_, index) => `needle source ${index + 2}`)
      ].join('\n')
      await Promise.all([
        writeFile(join(workspace, 'src', 'source.ts'), source),
        writeFile(join(workspace, '.git', 'config.ts'), 'needle git'),
        writeFile(join(workspace, 'node_modules', 'pkg', 'index.ts'), 'needle dependency'),
        writeFile(join(workspace, 'dist', 'bundle.ts'), 'needle generated')
      ])
      const tool = createGrepLocalTool({
        rgExecutableCandidates: [],
        fastContext: { maxMatches: 500, maxTextCharacters: 500 }
      })

      const fast = await tool.execute({ pattern: 'needle', limit: 100 }, context(workspace, true))
      const fastOutput = fast.output as Record<string, unknown>
      const fastMatches = fastOutput.matches as Array<Record<string, unknown>>
      expect(fastOutput).toMatchObject({
        backend: 'scan',
        fast_context: true,
        match_limit_reached: 30,
        truncated: true,
        has_more: true,
        next_cursor: null
      })
      expect(fastMatches).toHaveLength(30)
      expect(fastMatches.every((match) => Array.from(String(match.text)).length <= 300)).toBe(true)
      expect(fastMatches.some((match) => match.text_truncated === true)).toBe(true)
      expect(fastMatches.some((match) => String(match.relative_path).includes('.git/'))).toBe(false)
      expect(fastMatches.some((match) => String(match.relative_path).includes('node_modules/'))).toBe(false)
      expect(fastMatches.some((match) => String(match.relative_path).includes('dist/'))).toBe(false)
      const continuation = await tool.execute(
        { pattern: 'needle', limit: 100, cursor: Buffer.from(JSON.stringify({ query: JSON.stringify({ pattern: 'needle', rawPath: '.', glob: null, ignoreCase: false, literal: false, context: 0, fastContext: true }), index: 30 })).toString('base64url') },
        context(workspace, true)
      )
      expect(continuation).toMatchObject({ isError: true, output: { code: 'fast_context_cursor_unsupported' } })

      const regular = await tool.execute({ pattern: 'needle', limit: 100 }, context(workspace))
      const regularMatches = (regular.output as Record<string, unknown>).matches as Array<Record<string, unknown>>
      expect(regularMatches.length).toBeGreaterThan(30)
      expect(regularMatches.some((match) => String(match.relative_path).includes('.git/'))).toBe(true)
      expect(regularMatches.some((match) => String(match.relative_path).includes('node_modules/'))).toBe(true)
      expect(regularMatches.some((match) => String(match.relative_path).includes('dist/'))).toBe(true)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('applies the same default directory exclusions to the glob scan fallback', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-fast-context-glob-'))
    try {
      await Promise.all([
        mkdir(join(workspace, 'src'), { recursive: true }),
        mkdir(join(workspace, '.cache'), { recursive: true }),
        mkdir(join(workspace, 'build'), { recursive: true })
      ])
      await Promise.all([
        writeFile(join(workspace, 'src', 'keep.ts'), ''),
        writeFile(join(workspace, '.cache', 'skip.ts'), ''),
        writeFile(join(workspace, 'build', 'skip.ts'), '')
      ])
      const tool = createGlobLocalTool({ fdExecutableCandidates: [], rgExecutableCandidates: [] })

      const fast = await tool.execute({ pattern: '*.ts', limit: 20 }, context(workspace, true))
      expect(fast.output).toMatchObject({
        backend: 'index',
        index_backend: 'scan',
        fast_context: true,
        matches: [expect.objectContaining({ relative_path: 'src/keep.ts' })]
      })
      expect((fast.output as Record<string, unknown>).matches).toHaveLength(1)

      const regular = await tool.execute({ pattern: '*.ts', limit: 20 }, context(workspace))
      expect((regular.output as Record<string, unknown>).matches).toEqual(expect.arrayContaining([
        expect.objectContaining({ relative_path: '.cache/skip.ts' }),
        expect.objectContaining({ relative_path: 'build/skip.ts' }),
        expect.objectContaining({ relative_path: 'src/keep.ts' })
      ]))
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('caps Fast Context glob pages and their serialized evidence payload', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-fast-context-glob-budget-'))
    try {
      const longPath = 'x'.repeat(10_000)
      const matches = Array.from({ length: 180 }, (_, index) => ({
        path: join(workspace, `src-${index}.ts`),
        relative_path: `src/${longPath}-${index}.ts`
      }))
      const glob = createGlobLocalTool({
        operations: { glob: async () => matches }
      })

      const result = await glob.execute({ pattern: '*.ts', limit: 10_000 }, context(workspace, true))
      const output = result.output as Record<string, unknown>
      const visible = output.matches as Array<Record<string, unknown>>
      expect(output).toMatchObject({ backend: 'custom', fast_context: true, has_more: true })
      expect(visible.length).toBeLessThanOrEqual(100)
      expect(Buffer.byteLength(JSON.stringify(output), 'utf8')).toBeLessThanOrEqual(512 * 1024)
      const continuation = await glob.execute({ pattern: '*.ts', cursor: Buffer.from(JSON.stringify({ query: '*.ts\u0000.\u0000fast-context', index: 100 })).toString('base64url') }, context(workspace, true))
      expect(continuation).toMatchObject({ isError: true, output: { code: 'fast_context_cursor_unsupported' } })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('reports index truncation and live rg timeouts as Fast Context uncertainty', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-fast-context-glob-command-'))
    try {
      const captureCalls: Array<{ args: string[]; options: Record<string, unknown> }> = []
      const cappedGlob = createGlobLocalTool({
        fdExecutableCandidates: [],
        rgExecutableCandidates: [process.execPath],
        fastContext: { maxOutputBytes: 512, timeoutMs: 1_000 },
        operations: { spawnCapture: async (_file, args, command) => {
          captureCalls.push({ args, options: command })
          return { stdout: 'a.ts\n', stderr: '', exitCode: null, outputTruncated: true, timedOut: false }
        } }
      })
      // The workspace index is built once from a truncated listing; the glob
      // still answers from it and reports the truncation.
      const capped = await cappedGlob.execute({ pattern: '*.ts' }, context(workspace, true))
      expect(capped.output).toMatchObject({
        backend: 'rg',
        index_backend: 'rg',
        matches: [expect.objectContaining({ relative_path: 'a.ts' })],
        command_output_truncated: true,
        command_timed_out: false
      })
      const timedOutGlob = createGlobLocalTool({
        fdExecutableCandidates: [],
        rgExecutableCandidates: [process.execPath],
        fastContext: { maxOutputBytes: 512, timeoutMs: 100 },
        operations: { spawnCapture: async (_file, args, command) => {
          captureCalls.push({ args, options: command })
          return { stdout: '', stderr: '', exitCode: null, outputTruncated: false, timedOut: true }
        } }
      })
      // No indexed file matches, so a live, scoped rg listing runs and times out.
      const timedOut = await timedOutGlob.execute({ pattern: 'slow' }, context(workspace, true))
      expect(timedOut.output).toMatchObject({ backend: 'rg', command_output_truncated: false, command_timed_out: true })
      const indexBuild = captureCalls.find((call) => call.args[0] === '--files' && call.args.includes('--threads'))
      expect(indexBuild?.options).toMatchObject({ cwd: workspace, lowPriority: true, maxLines: expect.any(Number) })
      const live = captureCalls.filter((call) => call.args.includes('slow'))
      expect(live.at(-1)?.options).toMatchObject({ cwd: workspace, maxOutputBytes: 512, timeoutMs: 100, lowPriority: true })
      expect(live.at(-1)?.args).toEqual(expect.arrayContaining(['--max-filesize', '-g', '!node_modules/']))
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})
