import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { normalizeAppSettings, type AppSettingsV1 } from '../../shared/app-settings'
import {
  buildCommitMessageUserText,
  collectCommitMessageContext,
  COMMIT_MESSAGE_SYSTEM_PROMPT,
  generateGitCommitMessage,
  sanitizeCommitMessage
} from './git-commit-message-service'
import {
  cleanupTestRepositories,
  createTestRepository,
  gitAvailable,
  isolateGitConfig
} from './git-test-repository'

beforeAll(isolateGitConfig)
afterEach(async () => {
  vi.unstubAllGlobals()
  await cleanupTestRepositories()
})

function settings(kun: Record<string, unknown> = {}): AppSettingsV1 {
  return normalizeAppSettings({ agents: { kun: { apiKey: 'sk-runtime', ...kun } } } as unknown as AppSettingsV1)
}

describe('commit message text', () => {
  it('strips reasoning, fences, labels and quotes', () => {
    expect(sanitizeCommitMessage('<think>hmm</think>\n```text\nfeat: add x\n\n\n\nBody.  \n```')).toBe('feat: add x\n\nBody.')
    expect(sanitizeCommitMessage('Commit message: "fix: y"')).toBe('fix: y')
    expect(sanitizeCommitMessage('提交信息：修复登录')).toBe('修复登录')
  })

  it('puts branch, recent subjects, stat and diff in the request', () => {
    const text = buildCommitMessageUserText({ branch: 'kun/x', subjects: ['feat(a): one'], stat: ' a.ts | 1 +', patch: '+x' })
    expect(text).toBe('Branch: kun/x\n\nRecent commit subjects:\n- feat(a): one\n\nFiles changed:\n a.ts | 1 +\n\nDiff:\n+x')
  })
})

describe.skipIf(!gitAvailable())('commit message context and generation', () => {
  it('describes the index, or every change including new files when the commit stages all', async () => {
    const repo = await createTestRepository()
    await repo.write('src/app.ts', 'export const a = 2\n')
    repo.git('add', 'src/app.ts')
    await repo.write('README.md', 'edited\n')
    await repo.write('fresh.txt', 'brand new\n')
    const staged = await collectCommitMessageContext(repo.root, false)
    expect(staged).toMatchObject({ branch: 'main', subjects: ['init'] })
    expect(staged?.patch).toContain('+export const a = 2')
    expect(staged?.patch).not.toContain('edited')
    const all = await collectCommitMessageContext(repo.root, true)
    expect(all?.patch).toContain('+edited')
    expect(all?.patch).toContain('+brand new')
    expect(all?.stat).toContain('fresh.txt (new file)')
  })

  it('asks the configured model and cleans its answer', async () => {
    const repo = await createTestRepository()
    await repo.write('src/app.ts', 'export const a = 2\n')
    repo.git('add', 'src/app.ts')
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '```\nfeat(app): bump a to 2\n```' } }]
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await generateGitCommitMessage(settings(), { workspaceRoot: repo.root })
    expect(result).toMatchObject({ ok: true, message: 'feat(app): bump a to 2' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.deepseek.com/v1/chat/completions')
    const body = JSON.parse(String(init.body)) as { messages: Array<{ role: string; content: string }> }
    expect(body.messages[0]).toEqual({ role: 'system', content: COMMIT_MESSAGE_SYSTEM_PROMPT })
    expect(body.messages[1].content).toContain('+export const a = 2')
  })

  it('reports a clean tree and model failures without committing anything', async () => {
    const repo = await createTestRepository()
    expect(await generateGitCommitMessage(settings(), { workspaceRoot: repo.root })).toMatchObject({ ok: false, reason: 'nothing_to_describe' })
    await repo.write('a.txt', 'a\n')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })))
    const result = await generateGitCommitMessage(settings(), { workspaceRoot: repo.root, stageAll: true })
    expect(result).toMatchObject({ ok: false, reason: 'model' })
    expect(repo.git('status', '--porcelain')).toBe('?? a.txt\n')
  })
})
