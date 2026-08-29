import { afterEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  ReviewOutputSchema,
  StartReviewRequest,
  TurnItem
} from '../src/contracts/index.js'
import { parseReviewOutput, renderReviewOutput } from '../src/review/review-output.js'
import { resolveReviewTargetPrompt } from '../src/review/git-review-target.js'
import { KUN_REVIEW_PROMPT } from '../src/review/review-prompt.js'

const execFileAsync = promisify(execFile)
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100
  })))
})

describe('review contracts', () => {
  it('accepts review start requests and persisted review items', () => {
    const request = StartReviewRequest.parse({
      target: { kind: 'baseBranch', branch: 'main' },
      model: 'deepseek-chat',
      reasoningEffort: 'max'
    })
    expect(request.target).toEqual({ kind: 'baseBranch', branch: 'main' })
    expect(request.reasoningEffort).toBe('max')

    const item = TurnItem.parse({
      id: 'item_review_1',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'assistant',
      status: 'completed',
      createdAt: '2026-06-04T00:00:00.000Z',
      finishedAt: '2026-06-04T00:00:01.000Z',
      kind: 'review',
      title: 'Review current changes',
      target: { kind: 'uncommittedChanges' },
      reviewText: 'No review findings.',
      output: {
        findings: [],
        overallCorrectness: 'patch is correct',
        overallExplanation: 'No blocking issues found.',
        overallConfidenceScore: 0.8
      }
    })
    expect(item.kind).toBe('review')
  })
})

describe('review output parsing', () => {
  it('parses Codex-style snake_case JSON and renders review text', () => {
    const output = parseReviewOutput(JSON.stringify({
      findings: [{
        title: '[P1] Missing bounds check',
        body: 'The new index can exceed the array length.',
        confidence_score: 0.9,
        priority: 1,
        code_location: {
          absolute_file_path: '/tmp/project/src/a.ts',
          line_range: { start: 10, end: 10 }
        }
      }],
      overall_correctness: 'patch is incorrect',
      overall_explanation: 'One correctness bug should be fixed.',
      overall_confidence_score: 0.85
    }))

    expect(ReviewOutputSchema.parse(output).findings).toHaveLength(1)
    expect(renderReviewOutput(output)).toContain('/tmp/project/src/a.ts:10-10')
  })

  it('falls back to plain text when the reviewer returns prose', () => {
    const output = parseReviewOutput('No obvious issues.')
    expect(output.findings).toEqual([])
    expect(output.overallExplanation).toBe('No obvious issues.')
  })
})

describe('review target prompt resolution', () => {
  it('resolves custom review instructions without requiring a git workspace', async () => {
    const resolved = await resolveReviewTargetPrompt({
      target: { kind: 'custom', instructions: 'Review src/auth.ts for regressions.' },
      workspace: '/tmp/not-a-git-workspace'
    })

    expect(resolved.title).toBe('Custom code review')
    expect(resolved.prompt).toContain('Review src/auth.ts for regressions.')
  })

  it('lets the isolated reviewer gather a single-repository diff with read-only tools', async () => {
    const workspace = await makeTemporaryDirectory('kun-review-single-repo-')
    await initRepository(workspace)
    await writeFile(join(workspace, 'changed.txt'), 'sensitive changed content\n', 'utf8')

    const resolved = await resolveReviewTargetPrompt({
      target: { kind: 'uncommittedChanges' },
      workspace
    })

    expect(resolved.prompt).toContain('git_inspect')
    expect(resolved.prompt).toContain('staged, unstaged, and untracked')
    expect(resolved.prompt).not.toContain('sensitive changed content')
  })

  it('aggregates staged and unstaged changes from independent repositories under a non-git workspace', async () => {
    const workspace = await makeTemporaryDirectory('kun-review-multi-repo-')
    const moduleA = join(workspace, 'module-a')
    const moduleB = join(workspace, 'module-b')
    await Promise.all([mkdir(moduleA), mkdir(moduleB)])
    await Promise.all([initRepository(moduleA), initRepository(moduleB)])
    await writeFile(join(moduleA, 'staged.txt'), 'staged change\n', 'utf8')
    await runGit(moduleA, ['add', 'staged.txt'])
    await writeFile(join(moduleB, 'unstaged.txt'), 'initial content\n', 'utf8')
    await runGit(moduleB, ['add', 'unstaged.txt'])
    await writeFile(join(moduleB, 'unstaged.txt'), 'unstaged change\n', 'utf8')

    const resolved = await resolveReviewTargetPrompt({
      target: { kind: 'uncommittedChanges' },
      workspace
    })

    expect(resolved.prompt).toContain('2 Git repositories discovered under the workspace (2 with changes)')
    expect(resolved.prompt).toContain('name="module-a"')
    expect(resolved.prompt).toContain('name="module-b"')
    expect(resolved.prompt).toContain('staged.txt')
    expect(resolved.prompt).toContain('unstaged.txt')
  })

  it('discovers linked worktrees whose .git marker is a file', async () => {
    const workspace = await makeTemporaryDirectory('kun-review-worktree-')
    const source = join(workspace, 'source')
    const linked = join(workspace, 'linked')
    await mkdir(source)
    await initRepository(source)
    await runGit(source, ['config', 'user.email', 'kun-review@example.test'])
    await runGit(source, ['config', 'user.name', 'Kun Review Test'])
    await writeFile(join(source, 'base.txt'), 'base\n', 'utf8')
    await runGit(source, ['add', 'base.txt'])
    await runGit(source, ['commit', '-m', 'test: seed review fixture'])
    await runGit(source, ['worktree', 'add', '-b', 'linked-review', linked])
    await writeFile(join(linked, 'linked.txt'), 'linked worktree change\n', 'utf8')

    const resolved = await resolveReviewTargetPrompt({
      target: { kind: 'uncommittedChanges' },
      workspace
    })

    expect(resolved.prompt).toContain('name="linked"')
    expect(resolved.prompt).toContain('linked-review')
    expect(resolved.prompt).toContain('linked.txt')
  })

  it('does not traverse ignored build trees or directory links outside the workspace', async () => {
    const workspace = await makeTemporaryDirectory('kun-review-boundary-')
    const included = join(workspace, 'packages', 'app')
    const ignored = join(workspace, 'node_modules', 'vendor')
    const outside = await makeTemporaryDirectory('kun-review-outside-')
    await Promise.all([
      mkdir(included, { recursive: true }),
      mkdir(ignored, { recursive: true })
    ])
    await Promise.all([
      initRepository(included),
      initRepository(ignored),
      initRepository(outside)
    ])
    await Promise.all([
      writeFile(join(included, 'included.txt'), 'include me\n', 'utf8'),
      writeFile(join(ignored, 'ignored.txt'), 'ignore me\n', 'utf8'),
      writeFile(join(outside, 'outside.txt'), 'outside\n', 'utf8')
    ])
    await symlink(
      outside,
      join(workspace, 'linked-outside'),
      process.platform === 'win32' ? 'junction' : 'dir'
    )

    const resolved = await resolveReviewTargetPrompt({
      target: { kind: 'uncommittedChanges' },
      workspace
    })

    expect(resolved.prompt).toContain('included.txt')
    expect(resolved.prompt).not.toContain('ignored.txt')
    expect(resolved.prompt).not.toContain('outside.txt')
  })

  it('redacts credentials from repository remotes and keeps truncated UTF-8 valid', async () => {
    const workspace = await makeTemporaryDirectory('kun-review-remote-')
    const repository = join(workspace, 'module')
    await mkdir(repository)
    await initRepository(repository)
    await runGit(repository, ['remote', 'add', 'origin', 'https://secret-token@example.test/acme/repo.git'])
    await writeFile(join(repository, '中文.txt'), '变更内容'.repeat(64), 'utf8')

    const resolved = await resolveReviewTargetPrompt({
      target: { kind: 'uncommittedChanges' },
      workspace,
      maxDiffBytes: 300
    })

    expect(resolved.prompt).not.toContain('secret-token')
    expect(resolved.prompt).not.toContain('\uFFFD')
    expect(resolved.prompt).toContain('Review input truncated')
  })
})

describe('review rubric', () => {
  it('requires findings to overlap the reviewed diff and use tight ranges', () => {
    expect(KUN_REVIEW_PROMPT).toContain('changed lines in the reviewed diff')
    expect(KUN_REVIEW_PROMPT).toContain('normally no more than 5-10 lines')
    expect(KUN_REVIEW_PROMPT).toContain('When tools are no longer available')
  })
})

async function initRepository(directory: string): Promise<void> {
  await runGit(directory, ['init'])
}

async function makeTemporaryDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix))
  temporaryDirectories.push(path)
  return path
}

async function runGit(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd })
}
