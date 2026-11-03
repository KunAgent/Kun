import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastContextRunScope } from '../../ports/tool-host.js'
import './local-tool-host.js'
import { createGlobLocalTool, createGrepLocalTool } from './builtin-search-tools.js'
import { RG_EXECUTABLE_CANDIDATES, type SourceCommandCapture } from './builtin-tool-types.js'
import { resolveRipgrepExecutable, spawnCapture } from './builtin-tool-utils.js'
import { clearFastContextFileIndexCache, getFastContextFileIndex } from './fast-context-file-index.js'
import { fastContextDefinitionScopes } from './fast-context-grep.js'
import { fastContextSearchBounds } from './fast-context-search-bounds.js'
import { clearFastContextSymbolIndexCache, warmFastContextSymbolIndex } from './fast-context-symbol-index.js'

const rg = resolveRipgrepExecutable({ candidates: RG_EXECUTABLE_CANDIDATES, allowPathFallback: false })
const bounds = fastContextSearchBounds({ fastContext: true })!

const FIXTURE: Record<string, string> = {
  'src/services/runtime-event-recorder.ts': 'export class RuntimeEventRecorder {}\n',
  'src/loop/use-recorder.ts': "import { RuntimeEventRecorder } from '../services/runtime-event-recorder'\nnew RuntimeEventRecorder()\n",
  '__tests__/a-recorder.test.ts': 'RuntimeEventRecorder\n'.repeat(40),
  'docs/recorder.md': 'RuntimeEventRecorder\n',
  'lib/other/x.ts': 'RuntimeEventRecorder\n'
}

async function writeFixture(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), content)
  }
}

function context(workspace: string, run: Partial<FastContextRunScope> = {}) {
  const scope: FastContextRunScope = { hintPaths: [], queryTerms: [], timedOutCommands: 0, ...run }
  return {
    workspace,
    threadId: 'thr_fc_grep',
    turnId: 'turn_fc_grep',
    approvalPolicy: 'auto' as const,
    sandboxMode: 'workspace-write' as const,
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow' as const,
    fastContext: true,
    fastContextRun: scope
  }
}

type Output = Record<string, unknown> & { matches?: Array<{ relative_path: string; line: number }> }
const files = (output: Output) => [...new Set((output.matches ?? []).map((match) => match.relative_path))]

describe('Fast Context ranked grep', () => {
  let workspace: string
  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'kun-fc-grep-'))
    await writeFixture(workspace, FIXTURE)
  })
  afterEach(async () => {
    clearFastContextFileIndexCache()
    clearFastContextSymbolIndexCache()
    await rm(workspace, { recursive: true, force: true })
  })

  it.skipIf(!rg)('ranks the implementation ahead of tests and docs instead of path order', async () => {
    const result = await createGrepLocalTool().execute({ pattern: 'RuntimeEventRecorder', path: '.' }, context(workspace))
    const output = result.output as Output
    expect(output).toMatchObject({ backend: 'rg', ranking: 'relevance', scope: 'workspace', fast_context: true })
    expect(files(output)[0]).toBe('src/services/runtime-event-recorder.ts')
    expect(files(output)).toContain('__tests__/a-recorder.test.ts')
  })

  it.skipIf(!rg)('searches hint paths first when the path is omitted', async () => {
    const result = await createGrepLocalTool().execute(
      { pattern: 'RuntimeEventRecorder' },
      context(workspace, { hintPaths: ['src', '__tests__'] })
    )
    const output = result.output as Output
    expect(output.scope).toBe('hint_paths')
    expect(files(output)).not.toContain('docs/recorder.md')
    expect(files(output)).not.toContain('lib/other/x.ts')
  })

  it.skipIf(!rg)('scopes an identifier search to its defining package, unless path "." is explicit', async () => {
    await warmFastContextSymbolIndex(workspace, { rg, capture: spawnCapture, bounds })
    const scoped = (await createGrepLocalTool().execute({ pattern: 'RuntimeEventRecorder' }, context(workspace))).output as Output
    expect(scoped).toMatchObject({ scope: 'definition_scope', definition_files: 1, scope_hint: { reason: 'definition_scope', searched: 'src/services' } })
    expect(files(scoped)).toEqual(['src/services/runtime-event-recorder.ts'])
    const whole = (await createGrepLocalTool().execute({ pattern: 'RuntimeEventRecorder', path: '.' }, context(workspace))).output as Output
    expect(whole.scope).toBe('workspace')
    expect(files(whole)).toContain('lib/other/x.ts')
  })

  it.skipIf(!rg)('refuses unscoped root greps after repeated timeouts but allows a glob', async () => {
    const refused = await createGrepLocalTool().execute({ pattern: 'RuntimeEventRecorder' }, context(workspace, { timedOutCommands: 2 }))
    expect(refused).toMatchObject({ isError: true, output: { code: 'fast_context_scope_required', scope_hint: { reason: 'repeated_timeouts' } } })
    const globbed = await createGrepLocalTool().execute({ pattern: 'RuntimeEventRecorder', glob: '*.md' }, context(workspace, { timedOutCommands: 2 }))
    expect(files(globbed.output as Output)).toEqual(['docs/recorder.md'])
  })

  it('refuses unscoped root greps in a very large workspace and lists directories to scope to', async () => {
    const listing = Array.from({ length: 50_001 }, (_, index) => `pkg${index % 3}/file${index}.ts`).join('\n')
    const capture: SourceCommandCapture = async () => ({ stdout: listing, stderr: '', exitCode: 0, outputTruncated: false, timedOut: false })
    await getFastContextFileIndex(workspace, { rg: '/fake/rg', capture, bounds })
    const result = await createGrepLocalTool({ rgExecutableCandidates: [process.execPath], operations: { spawnCapture: capture } })
      .execute({ pattern: 'anything' }, context(workspace))
    expect(result).toMatchObject({
      isError: true,
      output: { code: 'fast_context_scope_required', scope_hint: { reason: 'large_workspace', directories: ['pkg0/', 'pkg1/', 'pkg2/'] } }
    })
  })

  it('reports a timed-out candidate scan with a scope hint and counts it for the run', async () => {
    const run: FastContextRunScope = { hintPaths: [], queryTerms: [], timedOutCommands: 0 }
    const calls: string[][] = []
    const capture: SourceCommandCapture = async (_file, args, options) => {
      calls.push(args)
      expect(options).toMatchObject({ lowPriority: true })
      return args.includes('--count')
        ? { stdout: '', stderr: '', exitCode: null, outputTruncated: false, timedOut: true }
        : { stdout: '', stderr: '', exitCode: 1, outputTruncated: false, timedOut: false }
    }
    const result = await createGrepLocalTool({ rgExecutableCandidates: [process.execPath], operations: { spawnCapture: capture } })
      .execute({ pattern: 'slow', path: '.' }, { ...context(workspace), fastContextRun: run })
    expect(result.output).toMatchObject({ command_timed_out: true, scope_hint: { reason: 'timeout' } })
    expect(run.timedOutCommands).toBe(1)
    expect(calls[0]).toEqual(expect.arrayContaining(['--count', '--max-filesize', '-e', 'slow']))
  })

  it('ranks the in-process scan fallback the same way when rg is unavailable', async () => {
    const result = await createGrepLocalTool({ rgExecutableCandidates: [] }).execute({ pattern: 'RuntimeEventRecorder', path: '.' }, context(workspace))
    const output = result.output as Output
    expect(output).toMatchObject({ backend: 'scan', ranking: 'relevance' })
    expect(files(output)[0]).toBe('src/services/runtime-event-recorder.ts')
  })

  it.skipIf(!rg)('answers globs from the index in relevance order and sees files created after it was built', async () => {
    const glob = createGlobLocalTool()
    const ranked = (await glob.execute({ pattern: '*recorder*' }, context(workspace, { queryTerms: ['runtime', 'event'] }))).output as Output
    expect(ranked).toMatchObject({ backend: 'index', index_backend: 'rg', ranking: 'relevance' })
    expect((ranked.matches ?? [])[0]?.relative_path).toBe('src/services/runtime-event-recorder.ts')
    await writeFixture(workspace, { 'src/new-widget.ts': '' })
    const fresh = (await glob.execute({ pattern: 'new-widget*' }, context(workspace))).output as Output
    expect(fresh).toMatchObject({ backend: 'rg', matches: [expect.objectContaining({ relative_path: 'src/new-widget.ts' })] })
  })
})

describe('Fast Context definition scopes', () => {
  it('uses package-level directories, collapses nesting, and gives up when spread too wide', () => {
    expect(fastContextDefinitionScopes(['kun/src/services/a.ts', 'kun/src/loop/b.ts'])).toEqual(['kun/src'])
    expect(fastContextDefinitionScopes(['src/a.ts', 'src/shared/b.ts'])).toEqual(['src'])
    expect(fastContextDefinitionScopes(['root.ts'])).toEqual(['root.ts'])
    expect(fastContextDefinitionScopes(['a/x/1.ts', 'b/x/2.ts', 'c/x/3.ts', 'd/x/4.ts', 'e/x/5.ts'])).toEqual([])
  })
})
